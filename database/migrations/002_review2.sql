-- ════════════════════════════════════════════════════════════════════════════
--  Migration 002 (Review 2): wallets & escrow settlement, credit retirement,
--  notifications, KYC documents, e-mail verification and two-factor login.
--
--  Safe to run on an existing Review 1 database: it only adds objects and
--  back-fills wallets from the existing trade history. Re-running it is a no-op.
--    psql -U postgres -d carbon_credit_platform -f database/migrations/002_review2.sql
-- ════════════════════════════════════════════════════════════════════════════

-- ── auth: two-factor login, e-mail verification, notifications ──────────────
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS mfa_secret  VARCHAR(64);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS auth.email_verifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash  CHAR(64) NOT NULL UNIQUE,          -- SHA-256 of the token; the token itself is never stored
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Outgoing e-mail. In development the platform has no SMTP server, so messages
-- are written here (and to the server console) instead of being sent.
CREATE TABLE IF NOT EXISTS auth.outbox_emails (
  id          BIGSERIAL PRIMARY KEY,
  to_address  VARCHAR(255) NOT NULL,
  subject     VARCHAR(255) NOT NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth.notifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind        VARCHAR(30)  NOT NULL,
  title       VARCHAR(200) NOT NULL,
  body        TEXT,
  link_page   VARCHAR(30),
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON auth.notifications (user_id, is_read, created_at DESC);

-- ── registry: KYC documents and credit retirements ──────────────────────────
CREATE TABLE IF NOT EXISTS registry.kyc_documents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES registry.companies(id) ON DELETE CASCADE,
  doc_type       VARCHAR(40) NOT NULL CHECK (doc_type IN
                 ('certificate_of_incorporation','tax_registration','address_proof','authorised_signatory_id','other')),
  original_name  VARCHAR(255) NOT NULL,
  mime_type      VARCHAR(100) NOT NULL CHECK (mime_type IN ('application/pdf','image/png','image/jpeg')),
  size_bytes     INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  sha256         CHAR(64) NOT NULL,
  storage_path   TEXT NOT NULL,
  uploaded_by    UUID REFERENCES auth.users(id),
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS registry.retirement_cert_seq START 1;

CREATE TABLE IF NOT EXISTS registry.retirements (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_number  VARCHAR(30) NOT NULL UNIQUE,
  company_id          UUID NOT NULL REFERENCES registry.companies(id),
  credit_id           UUID NOT NULL REFERENCES registry.carbon_credits(id),
  quantity            NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  beneficiary         VARCHAR(200) NOT NULL,
  reason              TEXT,
  report_year         INTEGER NOT NULL CHECK (report_year BETWEEN 2000 AND 2100),
  retired_by          UUID REFERENCES auth.users(id),
  retired_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_retirements_company_year ON registry.retirements (company_id, report_year);
CREATE INDEX IF NOT EXISTS idx_retirements_credit ON registry.retirements (credit_id, company_id);

-- ── trading: wallets, ledger and escrow on buy orders ───────────────────────
CREATE TABLE IF NOT EXISTS trading.wallets (
  company_id  UUID PRIMARY KEY REFERENCES registry.companies(id) ON DELETE CASCADE,
  balance     NUMERIC(18,2) NOT NULL DEFAULT 0,   -- total funds held by the company
  reserved    NUMERIC(18,2) NOT NULL DEFAULT 0,   -- part of balance locked by open buy orders (escrow)
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (reserved >= 0),
  CHECK (balance >= reserved)                     -- available = balance − reserved can never go negative
);

CREATE TABLE IF NOT EXISTS trading.wallet_ledger (
  id              BIGSERIAL PRIMARY KEY,
  company_id      UUID NOT NULL REFERENCES registry.companies(id) ON DELETE CASCADE,
  entry_type      VARCHAR(20) NOT NULL CHECK (entry_type IN ('deposit','withdrawal','purchase','sale','hold','release')),
  amount          NUMERIC(18,2) NOT NULL,
  balance_after   NUMERIC(18,2) NOT NULL,
  reserved_after  NUMERIC(18,2) NOT NULL,
  reference_id    UUID,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_company ON trading.wallet_ledger (company_id, created_at DESC);

ALTER TABLE trading.orders ADD COLUMN IF NOT EXISTS reserved_amount NUMERIC(18,2) NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE trading.orders ADD CONSTRAINT orders_reserved_amount_check CHECK (reserved_amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Back-fill wallets for existing companies (runs only once) ───────────────
-- Every buyer company receives a sandbox opening deposit of 500,000; then the
-- existing trade history is settled and open buy orders are put into escrow.
DO $$
DECLARE
  c RECORD;
  t RECORD;
  bal NUMERIC(18,2);
  res NUMERIC(18,2);
BEGIN
  IF EXISTS (SELECT 1 FROM trading.wallets) THEN
    RETURN;
  END IF;
  FOR c IN SELECT id, company_type FROM registry.companies LOOP
    bal := CASE WHEN c.company_type IN ('buyer','both') THEN 500000 ELSE 0 END;
    INSERT INTO trading.wallets (company_id, balance, reserved) VALUES (c.id, 0, 0);
    IF bal > 0 THEN
      INSERT INTO trading.wallet_ledger (company_id, entry_type, amount, balance_after, reserved_after, note)
      VALUES (c.id, 'deposit', bal, bal, 0, 'Sandbox opening deposit');
    END IF;
    -- replay historical trades into the ledger
    FOR t IN SELECT id, buyer_company_id, total_value, net_value FROM trading.trades
             WHERE buyer_company_id = c.id OR seller_company_id = c.id ORDER BY executed_at LOOP
      IF t.buyer_company_id = c.id THEN
        bal := bal - t.total_value;
        INSERT INTO trading.wallet_ledger (company_id, entry_type, amount, balance_after, reserved_after, reference_id, note)
        VALUES (c.id, 'purchase', -t.total_value, bal, 0, t.id, 'Historical trade');
      ELSE
        bal := bal + t.net_value;
        INSERT INTO trading.wallet_ledger (company_id, entry_type, amount, balance_after, reserved_after, reference_id, note)
        VALUES (c.id, 'sale', t.net_value, bal, 0, t.id, 'Historical trade');
      END IF;
    END LOOP;
    -- escrow for buy orders that are still open
    UPDATE trading.orders
       SET reserved_amount = ROUND((quantity - filled_qty) * price_per_unit, 2)
     WHERE company_id = c.id AND order_type = 'buy' AND status IN ('open','partially_filled');
    res := COALESCE((SELECT SUM(reserved_amount) FROM trading.orders
                     WHERE company_id = c.id AND order_type = 'buy' AND status IN ('open','partially_filled')), 0);
    IF bal < res THEN
      INSERT INTO trading.wallet_ledger (company_id, entry_type, amount, balance_after, reserved_after, note)
      VALUES (c.id, 'deposit', res - bal, res, 0, 'Sandbox top-up to cover open buy orders');
      bal := res;
    END IF;
    UPDATE trading.wallets SET balance = bal, reserved = res WHERE company_id = c.id;
    IF res > 0 THEN
      INSERT INTO trading.wallet_ledger (company_id, entry_type, amount, balance_after, reserved_after, note)
      VALUES (c.id, 'hold', res, bal, res, 'Escrow for open buy orders');
    END IF;
  END LOOP;
END $$;

-- ── Views (re-created to include retirements, wallets and target trajectory) ─
DROP VIEW IF EXISTS trading.v_portfolio;
CREATE VIEW trading.v_portfolio AS
WITH legs AS (
  SELECT buyer_company_id AS company_id, credit_id, quantity AS bought, 0::NUMERIC AS sold, 0::NUMERIC AS retired,
         quantity * trade_price AS cost, executed_at AS acquired_at
  FROM trading.trades
  UNION ALL
  SELECT seller_company_id, credit_id, 0, quantity, 0, 0, NULL
  FROM trading.trades
  UNION ALL
  SELECT company_id, credit_id, 0, 0, quantity, 0, NULL
  FROM registry.retirements
), positions AS (
  SELECT company_id, credit_id,
         SUM(bought) AS bought_qty, SUM(sold) AS sold_qty, SUM(retired) AS retired_qty, SUM(cost) AS bought_cost,
         MIN(acquired_at) AS first_acquired_at
  FROM legs GROUP BY company_id, credit_id
), priced AS (
  SELECT p.*, p.bought_qty - p.sold_qty - p.retired_qty AS quantity_held,
         p.bought_cost / NULLIF(p.bought_qty, 0) AS avg_price,
         COALESCE(latest.price, cc.price_per_unit) AS current_price,
         cc.serial_number, cc.vintage_year,
         cp.name AS project_name, cp.project_type, cp.verification_standard
  FROM positions p
  JOIN registry.carbon_credits cc ON p.credit_id = cc.id
  JOIN registry.carbon_projects cp ON cc.project_id = cp.id
  LEFT JOIN LATERAL (SELECT price FROM trading.market_prices
                     WHERE credit_id = p.credit_id ORDER BY recorded_at DESC LIMIT 1) latest ON TRUE
)
SELECT company_id, credit_id, serial_number, vintage_year, project_name, project_type, verification_standard,
       quantity_held,
       retired_qty AS quantity_retired,
       ROUND(avg_price, 4) AS avg_purchase_price,
       current_price,
       ROUND(quantity_held * avg_price, 2) AS total_cost_basis,
       ROUND(quantity_held * (current_price - avg_price), 2) AS unrealised_pnl,
       ROUND((current_price - avg_price) / NULLIF(avg_price, 0) * 100, 2) AS return_pct,
       first_acquired_at
FROM priced
WHERE quantity_held > 0;

-- Net emissions use only retirements recorded on the platform for the report
-- year. A report is "on track" when net emissions stay within the straight-line
-- path from the baseline to the nearest target:
--   allowed(Y) = E0 × (1 − r/100 × min(1, max(0, (Y − B) / (T − B))))
DROP VIEW IF EXISTS compliance.v_emissions_dashboard;
CREATE VIEW compliance.v_emissions_dashboard AS
SELECT r.id, r.company_id, c.legal_name, r.report_year,
       r.scope1_tonnes, r.scope2_tonnes, r.scope3_tonnes, r.total_tonnes,
       r.credits_purchased,
       COALESCE(ret.retired, 0) AS credits_retired,
       COALESCE(ret.retired, 0) AS offset_tonnes,
       r.total_tonnes - COALESCE(ret.retired, 0) AS net_emissions,
       tgt.target_year, tgt.reduction_pct,
       ROUND(c.annual_emissions_baseline * (1 - tgt.reduction_pct / 100 *
             LEAST(1, GREATEST(0, (r.report_year - tgt.baseline_year)::NUMERIC
                                  / NULLIF(tgt.target_year - tgt.baseline_year, 0)))), 2) AS allowed_emissions,
       CASE
         WHEN r.total_tonnes - COALESCE(ret.retired, 0) <= 0 THEN 'net_zero'
         WHEN tgt.reduction_pct IS NULL OR c.annual_emissions_baseline IS NULL THEN 'no_target'
         WHEN r.total_tonnes - COALESCE(ret.retired, 0)
              <= c.annual_emissions_baseline * (1 - tgt.reduction_pct / 100 *
                 LEAST(1, GREATEST(0, (r.report_year - tgt.baseline_year)::NUMERIC
                                      / NULLIF(tgt.target_year - tgt.baseline_year, 0)))) THEN 'on_track'
         ELSE 'off_track'
       END AS compliance_status,
       r.status AS report_status,
       r.methodology, r.third_party_verified, r.verifier_name, r.submitted_at, r.reviewed_at
FROM compliance.emissions_reports r
JOIN registry.companies c ON r.company_id = c.id
LEFT JOIN LATERAL (SELECT SUM(quantity) AS retired FROM registry.retirements x
                   WHERE x.company_id = r.company_id AND x.report_year = r.report_year) ret ON TRUE
LEFT JOIN LATERAL (SELECT baseline_year, target_year, reduction_pct FROM compliance.emission_targets t
                   WHERE t.company_id = r.company_id AND t.target_year >= r.report_year
                   ORDER BY t.target_year ASC LIMIT 1) tgt ON TRUE;

DROP VIEW IF EXISTS registry.v_admin_company_overview;
CREATE VIEW registry.v_admin_company_overview AS
SELECT c.id, c.legal_name, c.company_type, c.country, c.industry_sector, c.kyc_status,
       c.reliability_score, c.created_at, u.email, u.full_name, u.is_verified AS email_verified,
       (SELECT COUNT(*) FROM registry.carbon_projects p WHERE p.company_id = c.id) AS total_projects,
       (SELECT COUNT(*) FROM registry.kyc_documents k WHERE k.company_id = c.id) AS kyc_documents,
       (SELECT COALESCE(SUM(t.total_value), 0) FROM trading.trades t
        WHERE t.buyer_company_id = c.id OR t.seller_company_id = c.id) AS lifetime_trade_value,
       w.balance AS wallet_balance
FROM registry.companies c
JOIN auth.users u ON c.user_id = u.id
LEFT JOIN trading.wallets w ON w.company_id = c.id;
