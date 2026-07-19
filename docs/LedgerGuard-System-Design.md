# LedgerGuard — Enterprise Fraud Detection & Risk Scoring Platform

**System design document — portfolio edition**
Author: Principal Software Engineer, Barclays-style internal design review
Purpose: Software engineering internship portfolio piece

---

## 1. Framing: what this project actually demonstrates

Recruiters see hundreds of "ML fraud detection" repos with a Jupyter notebook and an 0.94 F1 score. That is not a backend project. LedgerGuard is deliberately scoped so that **90% of the engineering effort is backend systems work** and the model is a single, replaceable component behind an HTTP boundary.

What this project proves you can do:
- Design a multi-service system with clear ownership boundaries (not a monolith with folders)
- Move data reliably between services using an event log, not just synchronous REST calls
- Model a real banking domain in a relational schema with correct normalization and constraints
- Reason about consistency, idempotency, and failure modes in a distributed pipeline
- Secure an API surface with proper authentication/authorization
- Containerize and compose a multi-language, multi-service system
- Write API contracts (OpenAPI) and validate inputs at the boundary (Zod)

What it deliberately does **not** try to prove: that you are an ML researcher. The model is XGBoost on a well-known dataset with a fixed, non-negotiable feature set (V1–V28, Time, Amount). No feature engineering heroics, no deep learning. The interesting decisions live in the service boundaries, not the model.

---

## 2. Dataset constraint and what it means for the design

**Source**: Kaggle *Credit Card Fraud Detection* dataset (mlg-ulb/creditcardfraud) — 284,807 European cardholder transactions from September 2013, 492 labeled frauds (0.172%), 30 numeric features (`Time`, `Amount`, `V1`...`V28` — PCA-transformed, anonymized), binary `Class` label.

This constrains the design in ways worth calling out explicitly, because a reviewer will ask:

- **The features are already PCA-anonymized.** There is no merchant category, no device fingerprint, no geolocation in the raw data. So the **rule engine** (below) cannot use real-world rules like "transaction country ≠ home country." Instead the rule engine operates on the fields that *do* exist: `Amount` thresholds, `Time`-of-day derived buckets, and velocity (transaction count in a rolling window) computed from data as it streams in — which is realistic, since velocity is a genuinely bank-side computation independent of the anonymized features.
- **Severe class imbalance (0.17% positive)** is why risk scoring is expressed as a **continuous probability**, not a binary yes/no from the model alone. The Decision Service combines the model's probability with rule-engine flags using a weighted policy — this mirrors how real fraud systems work: no bank hard-codes a single model as judge, jury, and executioner.
- **The dataset is static and historical** — there is no live transaction stream from Kaggle. To exercise the real-time pipeline, a **transaction replay/simulator script** reads dataset rows and POSTs them to the Transaction Service at a configurable rate, tagging each with a synthetic account ID and timestamp offset. This is stated explicitly in the README so it's clear the "real-time" behavior is a simulation harness over historical data, not synthetic fraud data.

---

## 3. Tech stack — justified, not assumed

Every row below follows the same test: *what problem does this solve, what would happen without it, and what did I not pick instead.*

### 3.1 Node.js + Express (core services)

- **Problem it solves**: The pipeline is I/O-bound — services mostly wait on the network (DB queries, Kafka, Redis, downstream HTTP) rather than burn CPU. Node's single-threaded event loop with non-blocking I/O handles high concurrency on this kind of workload without the thread-per-request overhead of a blocking-I/O framework.
- **Alternatives considered**: Java/Spring Boot (the actual dominant choice at real banks — stronger typing, mature ecosystem, but much heavier boilerplate and slower iteration for a portfolio timeline); Go (excellent for this exact I/O-bound + concurrency profile, but smaller ecosystem for rapid REST/Kafka/ORM wiring). Express over a heavier framework like NestJS: NestJS's DI container is nice but adds a learning curve that doesn't map to "explain this in an interview" as cleanly as explicit, readable layering.
- **Why appropriate here**: Every service in the pipeline is a thin layer of validation + orchestration around a DB call or a Kafka publish. That's exactly Express's sweet spot, and it keeps the codebase readable for a reviewer skimming it in ten minutes.

### 3.2 PostgreSQL

- **Problem it solves**: Financial data is inherently relational — accounts have transactions, transactions have risk scores, risk scores have audit trails. It needs ACID guarantees (a transaction record and its ledger entry must not partially commit) and strong constraint enforcement (foreign keys, check constraints on amounts).
- **Alternatives considered**: MongoDB (schema flexibility is not a virtue here — a transaction schema should *not* be flexible; document databases also make cross-entity joins for reporting/audit painful); DynamoDB (excellent for pure key-value access patterns at massive scale, wrong fit when the access pattern is "join transactions to accounts to risk scores to audit events" for a dashboard).
- **Why appropriate here**: Regulatory/audit requirements in banking mean every write needs to be traceable and consistent. Postgres's transactional guarantees plus mature indexing (partial indexes on `status = 'FLAGGED'`, for example) map directly onto that requirement.

### 3.3 Kafka

- **Problem it solves**: Decouples transaction ingestion from fraud analysis. Without a broker, the Transaction Service would call the Fraud Detection Service synchronously — meaning a slow or down fraud service blocks the customer's transaction, and a burst of transactions overwhelms downstream services with no buffering.
- **Alternatives considered**: RabbitMQ (simpler, fine for this exact volume, but Kafka's durable log + consumer-group replay model is closer to what real fraud pipelines use, and it's the more valuable skill to demonstrate — you can rebuild derived state, like a rolling risk model, by replaying the log); direct synchronous HTTP calls (no buffering, no replay, tight coupling — the anti-pattern this design exists to avoid).
- **Why appropriate here**: The pipeline is naturally event-shaped — "a transaction happened" is a fact that multiple independent consumers (fraud detection, audit, notification) each want to react to without knowing about each other. That's the textbook Kafka use case, not a forced fit.

### 3.4 Redis

- **Problem it solves**: Two specific, narrow jobs — (1) caching account-level velocity counters (e.g., "transactions in the last 5 minutes for account X") so the rule engine doesn't hit Postgres on every single event, and (2) short-TTL caching of ML prediction results for identical feature vectors during backtesting/replay bursts.
- **Alternatives considered**: In-memory caching inside each Node process (doesn't work — velocity counters must be shared across service instances, and Fraud Detection Service will be horizontally scaled); Postgres materialized views for velocity (too slow for a sub-100ms per-transaction budget).
- **Why appropriate here**: Velocity checks are the one part of the rule engine that's genuinely latency-sensitive and read-heavy on the same small keys repeatedly — the canonical Redis use case.

### 3.5 Python + FastAPI + XGBoost (ML service)

- **Problem it solves**: Isolates the one component of the system with a different runtime and dependency footprint (numpy/pandas/xgboost) behind a stable HTTP contract, so the Node services never need to know it's Python.
- **Alternatives considered**: Running the model in-process inside a Node service via an ONNX runtime (removes the network hop, but couples model retraining/redeployment to the Node service's deploy cycle, and this project wants to *demonstrate* polyglot service boundaries, not hide them); Flask (FastAPI's built-in Pydantic validation and auto-generated OpenAPI schema is a better match for a project that already leans on typed contracts everywhere else).
- **Why appropriate here**: XGBoost is the right model class for this dataset — tabular, imbalanced, feature-engineering-light — and is what the actual Kaggle leaderboard for this dataset converges on (gradient-boosted trees beat deep nets here). FastAPI gives async I/O for the prediction endpoint and typed request/response models "for free."

### 3.6 Zod

- **Problem it solves**: Runtime validation at the API boundary. TypeScript types disappear at runtime — a malformed request body from a client (or a compromised upstream service) will silently propagate bad data into the pipeline without Zod enforcing shape and constraints (positive amount, valid ISO currency code, etc.) before it ever reaches a handler.
- **Alternatives considered**: Joi (older, less TypeScript-native — no static type inference from schema); manual `if` validation (unmaintainable, easy to miss a field, no single source of truth for the contract).
- **Why appropriate here**: A single Zod schema per endpoint doubles as documentation and as the actual runtime guard — and its inferred TS type can be reused directly in the OpenAPI generation step, so the contract, the validator, and the type are never allowed to drift apart.

### 3.7 JWT

- **Problem it solves**: Stateless authentication across independently scaled services. Any service that receives a request can verify the token's signature locally without a round-trip to the Auth Service on every call.
- **Alternatives considered**: Server-side sessions in Redis (works, but reintroduces a shared-state dependency on every request path, exactly what JWT avoids); OAuth2/OIDC via a full identity provider like Keycloak (the more "correct" real-bank answer, and worth naming in interviews as the production upgrade path, but adds infrastructure that doesn't teach anything new for a portfolio-scale project).
- **Why appropriate here**: The API Gateway is the only service that needs to *issue* trust; every downstream service just *verifies* a signature. That single-verification-point property is exactly what a gateway-fronted microservice layout wants.

### 3.8 Docker / Docker Compose

- **Problem it solves**: Nine-plus independently-versioned services (Node × 5, Python × 1, Postgres, Kafka + Zookeeper/KRaft, Redis, React) need to run together reproducibly on any machine, including a recruiter's laptop, without a manual "install these 8 things" README.
- **Alternatives considered**: Kubernetes (the real production target for this shape of system, but overkill for local/portfolio scale and adds operational surface area that doesn't add engineering signal at this stage); running services with local process managers like `pm2`/`concurrently` (no isolation, dependency conflicts between the Node and Python stacks).
- **Why appropriate here**: Compose is the right ceiling for "prove I can containerize and orchestrate a multi-service system" without the multi-week detour into Helm charts and cluster ops. The design doc explicitly calls out the K8s migration path so it's clear this is a conscious scoping decision, not a skill gap.

### 3.9 React + Vite + MUI + Chart.js

- **Problem it solves**: A fraud analyst-facing dashboard needs live-updating tables (flagged transactions), charts (risk score distribution, fraud rate over time), and forms (manual review actions) — standard data-dense enterprise UI. Vite gives fast local iteration; MUI gives production-looking data tables/forms without hand-rolling component primitives; Chart.js is lightweight and sufficient for the handful of charts needed (no need for D3-level customization here).
- **Alternatives considered**: Next.js (server-rendering and routing complexity this project doesn't need — it's a single authenticated dashboard, not a public multi-page site); Recharts (comparable choice to Chart.js, either is defensible — Chart.js chosen for broader familiarity and canvas-based performance with streaming data).

### 3.10 Swagger / OpenAPI

- **Problem it solves**: Documents the actual contract between the API Gateway and every client (frontend, replay simulator, future third-party integrator), generated from the same Zod schemas so it can't silently drift from what the code enforces.

---

## 4. Service inventory — why each one exists as a separate service

A service earns its existence in this design if it has **its own reason to scale independently, its own failure domain, or its own deployment cadence.** That's the bar applied below — this is not "microservices for their own sake."

| Service | Why it's separate | What breaks if it isn't |
|---|---|---|
| **API Gateway** | Single entry point for routing, rate limiting, and JWT verification. Centralizes cross-cutting concerns so business services don't each reimplement auth/rate-limiting. | Every service duplicates auth logic; no single place to rate-limit or observe all inbound traffic. |
| **Authentication Service** | Owns user/credential storage and token issuance — a distinct security boundary and data domain (user PII, password hashes) from transaction data. | Credential handling logic gets copy-pasted or, worse, transaction data and auth data share a schema/blast radius. |
| **Transaction Service** | Owns the write path for transactions — the system of record. Needs to scale independently under transaction-volume load, separate from the analytical/fraud path. | A slow fraud check would block the customer-facing write path; transaction ingestion and fraud analysis would compete for the same process's resources. |
| **Fraud Detection Service** | Orchestrates the rule engine and the ML call, then produces a risk score. This is a CPU/IO-bound consumer of the Kafka topic, scaled by consumer-group partitions independently of ingestion volume. | Fraud logic changes would require redeploying the transaction write path, increasing blast radius of every fraud-rule tweak. |
| **ML Prediction Service** | Different runtime (Python), different scaling profile (batched inference benefits from its own resource limits), and a separate deployment cadence — model retraining/redeploy shouldn't require a Node service redeploy. | Polyglot boundary disappears; you'd need FFI or an embedded Python runtime inside Node, which is a worse engineering answer for this problem. |
| **Audit Service** | Append-only, regulatory-grade log of every decision made in the pipeline. Needs write-heavy, failure-isolated persistence — an audit write must never be lost even if notification or dashboard updates fail. | Audit records become an afterthought scattered across other services' write paths, with no single durable source of truth for compliance. |
| **Notification Service** | Owns delivery to external channels (email/SMS/websocket push to the dashboard) — a different failure mode (third-party API flakiness) that must not affect the core decision pipeline. | A flaky notification provider (e.g., an email API timeout) could stall or crash the decision path if it's inline rather than event-driven. |

Two services are intentionally **not** separate microservices in this design, and that's a decision worth defending in review:
- **Decision Service** is implemented as a module inside the Fraud Detection Service (not a standalone service) because it's a pure function of the rule-engine output + ML score with no independent scaling need — splitting it out would be premature decomposition.
- **Risk Score Calculation** is a function, not a service, for the same reason.

---

## 5. End-to-end flow

1. **Client** (React dashboard or the replay simulator) sends a transaction request to the **API Gateway**.
2. Gateway verifies the **JWT** (issued earlier by the Authentication Service), applies rate limiting, and routes to the **Transaction Service**.
3. **Transaction Service** validates the payload (Zod), writes the transaction row to **PostgreSQL** with status `PENDING`, and publishes a `transaction.created` event to the **Kafka `transactions` topic**.
4. **Fraud Detection Service** (a Kafka consumer group) picks up the event:
   - **Rule Engine** runs fast, deterministic checks (amount thresholds, velocity via Redis counters, time-of-day anomaly).
   - It calls the **ML Prediction Service** (FastAPI/XGBoost) over HTTP with the transaction's feature vector and gets back a fraud probability.
   - **Decision logic** combines rule flags + ML probability into a final risk score and a decision (`APPROVE` / `REVIEW` / `BLOCK`).
5. The decision and score are written back to Postgres (updating the transaction's status) and published to a `fraud.decisions` Kafka topic.
6. **Audit Service** consumes `fraud.decisions` (and the original `transactions` topic) and writes an immutable audit record — who/what/when/why for every decision.
7. **Notification Service** consumes `fraud.decisions`, and for `REVIEW`/`BLOCK` outcomes pushes a WebSocket event to the connected dashboard and (optionally) queues an email/SMS.
8. **React dashboard** receives the WebSocket push and updates the flagged-transactions table and charts in real time; it also polls REST endpoints on the Transaction/Audit services for historical views.

---

## 6. Database design (PostgreSQL)

Core entities, normalized to 3NF with explicit constraints — this is deliberately not over-normalized into a snowflake, since a fraud-decision pipeline benefits from a small number of well-indexed tables over a large join graph.

**users** — id (PK, uuid), email (unique), password_hash, role (enum: `admin`, `analyst`, `customer`), created_at

**accounts** — id (PK, uuid), user_id (FK → users), account_number (unique), balance (numeric(14,2)), currency, created_at

**transactions** — id (PK, uuid), account_id (FK → accounts), amount (numeric(14,2), check > 0), currency, occurred_at, source_features (jsonb — holds the V1–V28/Time/Amount vector from the dataset for reproducibility), status (enum: `PENDING`, `APPROVED`, `REVIEW`, `BLOCKED`), created_at
  - Index: partial index on `status` where `status IN ('REVIEW','PENDING')` — the dashboard's hottest query.
  - Index: `(account_id, occurred_at)` — supports velocity lookups and account history.

**risk_scores** — id (PK), transaction_id (FK → transactions, unique — one score per transaction), ml_probability (numeric(5,4)), rule_flags (jsonb — which rules fired), final_score (numeric(5,4)), decision (enum: `APPROVE`,`REVIEW`,`BLOCK`), model_version, created_at

**audit_logs** — id (PK), transaction_id (FK → transactions), actor (enum: `system`,`analyst`,`ml_model`), action, detail (jsonb), created_at
  - Append-only by convention (no UPDATE/DELETE grants for the app role — enforced at the DB role level, not just application logic).

**notifications** — id (PK), transaction_id (FK → transactions), channel (enum: `websocket`,`email`,`sms`), status (enum: `queued`,`sent`,`failed`), created_at

Foreign keys cascade on read paths but use `ON DELETE RESTRICT` everywhere — a financial audit trail should never silently lose rows because a parent record was deleted.

---

## 7. Kafka topic design

| Topic | Producer | Consumers | Key | Why this partition key |
|---|---|---|---|---|
| `transactions` | Transaction Service | Fraud Detection Service, Audit Service | `account_id` | Guarantees per-account ordering, which the velocity/rule engine depends on. |
| `fraud.decisions` | Fraud Detection Service | Audit Service, Notification Service | `transaction_id` | Each decision is independent; keying by transaction spreads load evenly across partitions. |

Both topics are consumed by independent consumer groups per downstream service, so Audit and Notification each get their own copy of every event without coordinating with each other — the core benefit of pub/sub over point-to-point calls.

---

## 8. Security model

- **Transport**: all inter-service and client traffic over TLS in any real deployment (local Compose uses plaintext for simplicity, called out explicitly as a local-only shortcut).
- **AuthN**: Authentication Service issues short-lived JWT access tokens + refresh tokens; passwords hashed with bcrypt.
- **AuthZ**: role claim embedded in the JWT (`admin`, `analyst`, `customer`); API Gateway performs coarse-grained route authorization, individual services re-validate role for sensitive actions (defense in depth — never trust the gateway alone).
- **Input validation**: every service boundary validates with Zod before touching the database.
- **Least privilege at the DB layer**: separate Postgres roles per service where feasible; Audit Service's role has no UPDATE/DELETE grant.
- **Secrets**: environment-variable injection via Docker Compose `.env`, never committed; documented upgrade path to a real secrets manager (Vault/AWS Secrets Manager) for production.

---

## 9. Non-functional considerations (and honest limits)

- **Idempotency**: Transaction Service accepts a client-supplied idempotency key to avoid double-processing on client retries — a real requirement in payments systems.
- **Backpressure**: Kafka naturally buffers bursts from the replay simulator; Fraud Detection Service consumer can be scaled horizontally (more instances = more partition consumers) if lag grows.
- **Observability**: structured JSON logging per service, correlation ID propagated from the Gateway through Kafka message headers so a single transaction's path is traceable end-to-end. (Full distributed tracing via OpenTelemetry is named as a next step, not built initially — scoped out deliberately.)
- **What's explicitly out of scope for v1**, and why: Kubernetes/Helm (operational overkill for portfolio scale), multi-region/DR (no real SLA to protect), a real identity provider (JWT-from-scratch is the more instructive exercise at this stage), true real-time market/account data (dataset is static, hence the replay simulator).

---

## 10. Suggested repo layout

```
ledgerguard/
├── docker-compose.yml
├── services/
│   ├── api-gateway/
│   ├── auth-service/
│   ├── transaction-service/
│   ├── fraud-detection-service/
│   ├── ml-prediction-service/        # Python/FastAPI
│   ├── audit-service/
│   └── notification-service/
├── frontend/                         # React + Vite + MUI
├── simulator/                        # Kaggle dataset replay script
├── shared/                           # shared Zod schemas / TS types
└── docs/
    ├── LedgerGuard-System-Design.md  # this document
    └── openapi/
```

Each service under `services/` follows the same internal clean-architecture layering: `routes` → `controllers` → `services` (business logic) → `repositories` (DB access), with `domain` types kept framework-free.

---

## 11. What to say in an interview about this project

The strongest framing: *"I built a small but realistic slice of a bank's fraud pipeline to practice the distributed-systems and data-modeling problems that don't show up in a single-service CRUD app — event-driven decoupling with Kafka, a relational schema with real audit/compliance constraints, and a clean boundary around the one ML component so it can be swapped or retrained without touching the rest of the system."* That sentence is the whole pitch; everything in this document backs it up.
