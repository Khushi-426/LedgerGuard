-- LedgerGuard schema
-- Runs automatically on first postgres container start via docker-entrypoint-initdb.d

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()

CREATE TYPE user_role AS ENUM ('admin', 'analyst', 'customer');
CREATE TYPE txn_status AS ENUM ('PENDING', 'APPROVED', 'REVIEW', 'BLOCKED');
CREATE TYPE decision_type AS ENUM ('APPROVE', 'REVIEW', 'BLOCK');
CREATE TYPE audit_actor AS ENUM ('system', 'analyst', 'ml_model');
CREATE TYPE notification_channel AS ENUM ('websocket', 'email', 'sms');
CREATE TYPE notification_status AS ENUM ('queued', 'sent', 'failed');

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'customer',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    account_number TEXT UNIQUE NOT NULL,
    balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    idempotency_key TEXT UNIQUE,
    amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- raw feature vector from the Kaggle dataset (Time, V1..V28, Amount) kept for reproducibility
    source_features JSONB NOT NULL DEFAULT '{}'::jsonb,
    status txn_status NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_account_time ON transactions (account_id, occurred_at DESC);
CREATE INDEX idx_transactions_review_pending ON transactions (status) WHERE status IN ('PENDING', 'REVIEW');

CREATE TABLE risk_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE RESTRICT,
    ml_probability NUMERIC(6, 5) NOT NULL,
    rule_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
    final_score NUMERIC(6, 5) NOT NULL,
    decision decision_type NOT NULL,
    model_version TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
    actor audit_actor NOT NULL,
    action TEXT NOT NULL,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_transaction ON audit_logs (transaction_id, created_at);

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
    channel notification_channel NOT NULL,
    status notification_status NOT NULL DEFAULT 'queued',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- seed a demo user (password: "Password123!" - bcrypt hash generated at build time in README)
-- left empty here on purpose; use POST /auth/register instead of seeding credentials in source control.

-- least-privilege note (see design doc section 8):
-- in a real deployment, create a dedicated `audit_writer` role granted INSERT/SELECT only
-- (no UPDATE/DELETE) on audit_logs, and have the audit-service connect as that role.
