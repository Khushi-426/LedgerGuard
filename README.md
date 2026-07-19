# LedgerGuard — Enterprise Fraud Detection & Risk Scoring Platform

A backend-engineering portfolio project: a small but realistic slice of a
bank's fraud pipeline. See `docs/LedgerGuard-System-Design.md` for the full
architecture write-up (why each service exists, why each technology was
chosen, database and Kafka topic design, security model).

## Architecture at a glance

```
client -> API Gateway -> Auth Service
                       -> Transaction Service -> Kafka(transactions)
                                                        |
                                    Fraud Detection Service (consumer)
                                       -> Rule Engine (Redis velocity)
                                       -> ML Prediction Service (FastAPI/XGBoost)
                                       -> Decision -> Kafka(fraud.decisions)
                                                        |
                                    Audit Service (consumer) -> Postgres
                                    Notification Service (consumer) -> WebSocket -> React dashboard
```

## Prerequisites

- Docker + Docker Compose
- The Kaggle "Credit Card Fraud Detection" dataset, downloaded manually
  (Kaggle's terms require an authenticated download, so this repo does not
  fetch it for you):
  https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud

## 1. Train the ML model (one-time, before first boot)

```bash
cd services/ml-prediction-service
mkdir -p data
# place the downloaded creditcard.csv into ./data/creditcard.csv
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python train_model.py
# produces model.joblib in this directory, which the Docker build will pick up
```

## 2. Boot the stack

```bash
cp .env.example .env   # edit JWT_SECRET etc. for anything beyond local use
docker compose up --build
```

Services and ports:

| Service | Port |
|---|---|
| React dashboard | http://localhost:3000 |
| API Gateway | http://localhost:8080 |
| Auth Service | http://localhost:4001 |
| Transaction Service | http://localhost:4002 |
| Audit Service | http://localhost:4003 |
| Notification Service (WS) | ws://localhost:4004 |
| ML Prediction Service | http://localhost:5001 |
| Postgres | localhost:5432 |
| Redis | localhost:6379 |
| Kafka | localhost:9092 |

## 3. Create a user and an account

The simulator can now create the required account automatically if it does not exist.

```bash
curl -X POST http://localhost:8080/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@ledgerguard.dev","password":"Password123!","role":"analyst"}'
```

If you want to seed an account manually, this SQL command still works:

```bash
docker exec -it lg-postgres psql -U ledgerguard -d ledgerguard -c \
  "INSERT INTO accounts (user_id, account_number) SELECT id, '1234567890' FROM users WHERE email='demo@ledgerguard.dev' RETURNING id;"
```

Copy the returned account `id` if you choose the manual option.

## 4. Replay the dataset as live traffic

```bash
cd simulator
npm install
API_BASE_URL=http://localhost:8080 \
EMAIL=demo@ledgerguard.dev PASSWORD=Password123! \
CSV_PATH=../services/ml-prediction-service/data/creditcard.csv \
RATE_PER_SECOND=5 \
node replay.js
```

The simulator now defaults to the demo credentials above when `EMAIL` and `PASSWORD` are not explicitly provided.

If `ACCOUNT_ID` is not provided, `replay.js` will:
- register the demo user if needed,
- look up or create a matching account in Postgres,
- print the account UUID it uses.

If you already have an account UUID from manual seeding, you may still pass `ACCOUNT_ID=<uuid>`.

## 5. Watch it work

Open http://localhost:3000, sign in with the same credentials, and watch
transactions and live fraud alerts stream in as the simulator runs.

## Repo layout

```
ledgerguard/
├── docker-compose.yml
├── db/init.sql                    # Postgres schema
├── shared/schemas.js              # canonical Zod contracts (see file header)
├── services/
│   ├── api-gateway/                # routing, JWT verification, rate limiting
│   ├── auth-service/                # clean-architecture layering example
│   ├── transaction-service/         # system of record, Kafka producer
│   ├── fraud-detection-service/     # Kafka consumer: rule engine + ML + decision
│   ├── ml-prediction-service/       # FastAPI + XGBoost
│   ├── audit-service/                # append-only Kafka consumer + read API
│   └── notification-service/         # Kafka consumer + WebSocket broadcast
├── frontend/                       # React + Vite + MUI + Chart.js
└── simulator/                      # Kaggle dataset replay harness
```

## Known scope limits (deliberate, see design doc section 9)

- No Kubernetes/Helm — Docker Compose is the right ceiling for this scale.
- No real identity provider — hand-rolled JWT is more instructive here.
- No accounts REST endpoint yet — accounts are seeded via SQL for this
  portfolio cut; a real build would add an Accounts Service or endpoint.
- The "real-time" pipeline runs on historical data via the replay
  simulator, not a live feed — the dataset itself is static.
