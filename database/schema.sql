-- ════════════════════════════════════════════════════════════════════════════
--  Carbon Credit Trading Platform — PostgreSQL schema + seed data
--
--  Usage (PostgreSQL 13+):
--    createdb carbon_credit_platform
--    psql -U postgres -d carbon_credit_platform -f database/schema.sql
--  or open this file in pgAdmin's Query Tool on the carbon_credit_platform
--  database and run it.
--
--  WARNING: drops and recreates the auth, registry, trading and compliance
--  schemas. All data in them is lost.
-- ════════════════════════════════════════════════════════════════════════════

DROP SCHEMA IF EXISTS compliance CASCADE;
DROP SCHEMA IF EXISTS trading    CASCADE;
DROP SCHEMA IF EXISTS registry   CASCADE;
DROP SCHEMA IF EXISTS auth       CASCADE;

CREATE SCHEMA auth;
CREATE SCHEMA registry;
CREATE SCHEMA trading;
CREATE SCHEMA compliance;

-- Shared trigger: keep updated_at current
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── auth ─────────────────────────────────────────────────────────────────────

CREATE TABLE auth.users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email               VARCHAR(255) NOT NULL UNIQUE CHECK (email = LOWER(email)),
  password_hash       VARCHAR(255) NOT NULL CHECK (LENGTH(password_hash) >= 60),  -- bcrypt only
  role                VARCHAR(20)  NOT NULL CHECK (role IN ('buyer','seller','admin')),
  full_name           VARCHAR(150) NOT NULL,
  phone               VARCHAR(30),
  is_verified         BOOLEAN NOT NULL DEFAULT FALSE,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  failed_login_count  INTEGER NOT NULL DEFAULT 0,
  locked_until        TIMESTAMPTZ,
  last_login_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE auth.audit_log (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action       VARCHAR(30)  NOT NULL,   -- INSERT, UPDATE, DELETE, LOGIN, LOGIN_FAILED
  schema_name  VARCHAR(50)  NOT NULL,
  table_name   VARCHAR(100) NOT NULL,
  record_id    TEXT,
  logged_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_log_logged_at ON auth.audit_log (logged_at DESC);

-- ── registry ─────────────────────────────────────────────────────────────────

CREATE TABLE registry.companies (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  legal_name                 VARCHAR(200) NOT NULL,
  trade_name                 VARCHAR(200),
  company_type               VARCHAR(10)  NOT NULL CHECK (company_type IN ('buyer','seller','both')),
  registration_number        VARCHAR(100) NOT NULL UNIQUE,
  country                    CHAR(2)      NOT NULL,
  industry_sector            VARCHAR(50)  NOT NULL,
  annual_revenue_usd         NUMERIC(18,2) CHECK (annual_revenue_usd >= 0),
  employee_count             INTEGER CHECK (employee_count >= 0),
  primary_pollution_sources  TEXT[] NOT NULL DEFAULT '{}',
  annual_emissions_baseline  NUMERIC(18,4) CHECK (annual_emissions_baseline >= 0),
  emissions_unit             VARCHAR(10) NOT NULL DEFAULT 'tCO2e',
  founded_year               INTEGER CHECK (founded_year BETWEEN 1800 AND 2100),
  kyc_status                 VARCHAR(20) NOT NULL DEFAULT 'pending'
                             CHECK (kyc_status IN ('pending','under_review','approved','rejected','suspended')),
  kyc_reviewed_by            UUID REFERENCES auth.users(id),
  kyc_reviewed_at            TIMESTAMPTZ,
  kyc_rejection_reason       TEXT,
  reliability_score          NUMERIC(5,2) NOT NULL DEFAULT 50 CHECK (reliability_score BETWEEN 0 AND 100),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON registry.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE registry.carbon_projects (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             UUID NOT NULL REFERENCES registry.companies(id) ON DELETE CASCADE,
  name                   VARCHAR(200) NOT NULL,
  description            TEXT NOT NULL,
  project_type           VARCHAR(30) NOT NULL CHECK (project_type IN
                         ('forestry','solar','wind','hydro','methane_capture','energy_efficiency','ocean','direct_air_capture','other')),
  verification_standard  VARCHAR(100) NOT NULL,
  verification_body      VARCHAR(150) NOT NULL,
  country                CHAR(2) NOT NULL,
  total_credits_cap      NUMERIC(18,4) NOT NULL CHECK (total_credits_cap > 0),
  start_date             DATE NOT NULL,
  end_date               DATE NOT NULL CHECK (end_date > start_date),
  status                 VARCHAR(20) NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','active','rejected','suspended','completed')),
  approved_by            UUID REFERENCES auth.users(id),
  approved_at            TIMESTAMPTZ,
  admin_notes            TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE registry.carbon_credits (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           UUID NOT NULL REFERENCES registry.carbon_projects(id) ON DELETE CASCADE,
  serial_number        VARCHAR(100) NOT NULL UNIQUE,
  vintage_year         INTEGER NOT NULL CHECK (vintage_year BETWEEN 1990 AND 2100),
  quantity             NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  price_per_unit       NUMERIC(12,2) NOT NULL CHECK (price_per_unit > 0),
  unit                 VARCHAR(10) NOT NULL DEFAULT 'tCO2e',
  co2_methodology      VARCHAR(150),
  additional_benefits  TEXT[],
  status               VARCHAR(20) NOT NULL DEFAULT 'available'
                       CHECK (status IN ('available','retired','suspended','expired')),
  issued_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── trading ──────────────────────────────────────────────────────────────────

CREATE TABLE trading.orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES registry.companies(id),
  credit_id       UUID NOT NULL REFERENCES registry.carbon_credits(id),
  order_type      VARCHAR(4) NOT NULL CHECK (order_type IN ('buy','sell')),
  quantity        NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  price_per_unit  NUMERIC(12,2) NOT NULL CHECK (price_per_unit > 0),
  filled_qty      NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (filled_qty >= 0),
  status          VARCHAR(20) NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','partially_filled','filled','cancelled','expired')),
  order_expiry    TIMESTAMPTZ,
  notes           TEXT,
  placed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (filled_qty <= quantity)
);
CREATE INDEX idx_orders_book ON trading.orders (credit_id, order_type, status, price_per_unit, placed_at);

CREATE TABLE trading.trades (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buy_order_id       UUID NOT NULL REFERENCES trading.orders(id),
  sell_order_id      UUID NOT NULL REFERENCES trading.orders(id),
  credit_id          UUID NOT NULL REFERENCES registry.carbon_credits(id),
  buyer_company_id   UUID NOT NULL REFERENCES registry.companies(id),
  seller_company_id  UUID NOT NULL REFERENCES registry.companies(id),
  quantity           NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  trade_price        NUMERIC(12,2) NOT NULL CHECK (trade_price > 0),
  platform_fee       NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_value        NUMERIC(20,2) GENERATED ALWAYS AS (quantity * trade_price) STORED,
  net_value          NUMERIC(20,2) GENERATED ALWAYS AS (quantity * trade_price - platform_fee) STORED,
  executed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (buyer_company_id <> seller_company_id)
);

CREATE TABLE trading.market_prices (
  id           BIGSERIAL PRIMARY KEY,
  credit_id    UUID NOT NULL REFERENCES registry.carbon_credits(id) ON DELETE CASCADE,
  price        NUMERIC(12,2) NOT NULL,
  volume_24h   NUMERIC(18,4) NOT NULL DEFAULT 0,
  high_24h     NUMERIC(12,2),
  low_24h      NUMERIC(12,2),
  open_price   NUMERIC(12,2),
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX idx_market_prices_credit ON trading.market_prices (credit_id, recorded_at DESC);

-- ── compliance ───────────────────────────────────────────────────────────────

CREATE TABLE compliance.emissions_reports (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID NOT NULL REFERENCES registry.companies(id) ON DELETE CASCADE,
  report_year           INTEGER NOT NULL CHECK (report_year BETWEEN 2000 AND 2100),
  scope1_tonnes         NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (scope1_tonnes >= 0),
  scope2_tonnes         NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (scope2_tonnes >= 0),
  scope3_tonnes         NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (scope3_tonnes >= 0),
  total_tonnes          NUMERIC(18,4) GENERATED ALWAYS AS (scope1_tonnes + scope2_tonnes + scope3_tonnes) STORED,
  credits_purchased     NUMERIC(18,4) NOT NULL DEFAULT 0,
  credits_retired       NUMERIC(18,4) NOT NULL DEFAULT 0,
  methodology           VARCHAR(50) NOT NULL DEFAULT 'GHG Protocol',
  third_party_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  verifier_name         VARCHAR(150),
  status                VARCHAR(20) NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','submitted','under_review','approved','rejected')),
  submitted_at          TIMESTAMPTZ,
  reviewed_by           UUID REFERENCES auth.users(id),
  reviewed_at           TIMESTAMPTZ,
  review_notes          TEXT,
  UNIQUE (company_id, report_year)
);

CREATE TABLE compliance.emission_targets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES registry.companies(id) ON DELETE CASCADE,
  baseline_year  INTEGER NOT NULL,
  target_year    INTEGER NOT NULL,
  reduction_pct  NUMERIC(5,2) NOT NULL CHECK (reduction_pct > 0 AND reduction_pct <= 100),
  target_type    VARCHAR(20) NOT NULL CHECK (target_type IN ('absolute','intensity','net_zero','science_based')),
  description    TEXT,
  is_public      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (target_year > baseline_year)
);

-- ── Views ────────────────────────────────────────────────────────────────────

-- Latest and previous price per credit
CREATE VIEW trading.v_market_overview AS
SELECT cc.id AS credit_id, cc.id, cc.serial_number, cc.vintage_year, cc.quantity,
       cp.name AS project_name, cp.project_type, cp.verification_standard, cp.country AS project_country,
       comp.legal_name AS seller_name,
       COALESCE(latest.price, cc.price_per_unit) AS current_price,
       prev.price AS previous_price,
       CASE WHEN prev.price > 0
            THEN ROUND((latest.price - prev.price) / prev.price * 100, 2) END AS price_change_pct,
       latest.volume_24h
FROM registry.carbon_credits cc
JOIN registry.carbon_projects cp ON cc.project_id = cp.id
JOIN registry.companies comp ON cp.company_id = comp.id
LEFT JOIN LATERAL (SELECT price, volume_24h FROM trading.market_prices
                   WHERE credit_id = cc.id ORDER BY recorded_at DESC LIMIT 1) latest ON TRUE
LEFT JOIN LATERAL (SELECT price FROM trading.market_prices
                   WHERE credit_id = cc.id ORDER BY recorded_at DESC OFFSET 1 LIMIT 1) prev ON TRUE
WHERE cc.status = 'available';

-- Holdings per company and credit, derived from executed trades
CREATE VIEW trading.v_portfolio AS
WITH legs AS (
  SELECT buyer_company_id AS company_id, credit_id, quantity AS bought, 0::NUMERIC AS sold,
         quantity * trade_price AS cost, executed_at AS acquired_at
  FROM trading.trades
  UNION ALL
  SELECT seller_company_id, credit_id, 0, quantity, 0, NULL
  FROM trading.trades
), positions AS (
  SELECT company_id, credit_id,
         SUM(bought) AS bought_qty, SUM(sold) AS sold_qty, SUM(cost) AS bought_cost,
         MIN(acquired_at) AS first_acquired_at
  FROM legs GROUP BY company_id, credit_id
), priced AS (
  SELECT p.*, p.bought_qty - p.sold_qty AS quantity_held,
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
       ROUND(avg_price, 4) AS avg_purchase_price,
       current_price,
       ROUND(quantity_held * avg_price, 2) AS total_cost_basis,
       ROUND(quantity_held * (current_price - avg_price), 2) AS unrealised_pnl,
       ROUND((current_price - avg_price) / NULLIF(avg_price, 0) * 100, 2) AS return_pct,
       first_acquired_at
FROM priced
WHERE quantity_held > 0;

CREATE VIEW trading.v_transaction_history AS
SELECT t.id AS trade_id, t.executed_at, t.quantity, t.trade_price, t.total_value, t.platform_fee, t.net_value,
       cc.serial_number, cp.name AS project_name, cp.project_type,
       buyer.legal_name AS buyer_name, seller.legal_name AS seller_name
FROM trading.trades t
JOIN registry.carbon_credits cc ON t.credit_id = cc.id
JOIN registry.carbon_projects cp ON cc.project_id = cp.id
JOIN registry.companies buyer ON t.buyer_company_id = buyer.id
JOIN registry.companies seller ON t.seller_company_id = seller.id
ORDER BY t.executed_at DESC;

CREATE VIEW registry.v_admin_company_overview AS
SELECT c.id, c.legal_name, c.company_type, c.country, c.industry_sector, c.kyc_status,
       c.reliability_score, c.created_at, u.email, u.full_name,
       (SELECT COUNT(*) FROM registry.carbon_projects p WHERE p.company_id = c.id) AS total_projects,
       (SELECT COALESCE(SUM(t.total_value), 0) FROM trading.trades t
        WHERE t.buyer_company_id = c.id OR t.seller_company_id = c.id) AS lifetime_trade_value
FROM registry.companies c
JOIN auth.users u ON c.user_id = u.id;

-- Net emissions after retired credits, checked against the company's nearest
-- reduction target (baseline × (1 − reduction %)).
CREATE VIEW compliance.v_emissions_dashboard AS
SELECT r.id, r.company_id, c.legal_name, r.report_year,
       r.scope1_tonnes, r.scope2_tonnes, r.scope3_tonnes, r.total_tonnes,
       r.credits_purchased, r.credits_retired,
       r.credits_retired AS offset_tonnes,
       r.total_tonnes - r.credits_retired AS net_emissions,
       CASE
         WHEN r.total_tonnes - r.credits_retired <= 0 THEN 'net_zero'
         WHEN tgt.reduction_pct IS NULL OR c.annual_emissions_baseline IS NULL THEN 'no_target'
         WHEN r.total_tonnes - r.credits_retired
              <= c.annual_emissions_baseline * (1 - tgt.reduction_pct / 100) THEN 'on_track'
         ELSE 'off_track'
       END AS compliance_status,
       r.status AS report_status,
       r.methodology, r.third_party_verified, r.verifier_name, r.submitted_at, r.reviewed_at
FROM compliance.emissions_reports r
JOIN registry.companies c ON r.company_id = c.id
LEFT JOIN LATERAL (SELECT reduction_pct FROM compliance.emission_targets t
                   WHERE t.company_id = r.company_id AND t.target_year >= r.report_year
                   ORDER BY t.target_year ASC LIMIT 1) tgt ON TRUE;

-- ════════════════════════════════════════════════════════════════════════════
--  Seed data  (passwords: Admin@1234 / Buyer@1234 / Seller@1234)
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO auth.users (id, email, password_hash, role, full_name, is_verified) VALUES
('a0000000-0000-0000-0000-000000000001','admin@carbonplatform.io','$2a$12$MkSvsD4JHOVxxjA8GzVteuxgZZ8gl12rufvCgNYo2ma5d65AOtSLu','admin','Platform Admin',TRUE),
('a0000000-0000-0000-0000-000000000002','cfo@steelcorp.com','$2a$12$qcKhHIMAl4RWS/ktlIga4.c9NLskZ7hoSJy2HIgaT5DFW8VZf5GE6','buyer','Ananya Mehta',TRUE),
('a0000000-0000-0000-0000-000000000003','ops@greenterra.io','$2a$12$gAUvhTxmBBRc/cP3hmEq3OYBcEq2OREq.QLGnn5jPW6vtZqp0rYyC','seller','Lucas Ferreira',TRUE),
('a0000000-0000-0000-0000-000000000004','sustainability@airlogix.com','$2a$12$qcKhHIMAl4RWS/ktlIga4.c9NLskZ7hoSJy2HIgaT5DFW8VZf5GE6','buyer','Sarah Collins',TRUE),
('a0000000-0000-0000-0000-000000000005','projects@solarverde.org','$2a$12$gAUvhTxmBBRc/cP3hmEq3OYBcEq2OREq.QLGnn5jPW6vtZqp0rYyC','seller','Marta Ruiz',TRUE);

INSERT INTO registry.companies (id, user_id, legal_name, company_type, registration_number, country, industry_sector,
  annual_revenue_usd, employee_count, primary_pollution_sources, annual_emissions_baseline, founded_year,
  kyc_status, kyc_reviewed_by, kyc_reviewed_at, reliability_score) VALUES
('c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','SteelCorp India Ltd','buyer','SC-IN-2003-00812','IN','manufacturing',
  850000000,12000,'{blast_furnace,coal_combustion,transport}',420000,2003,'approved','a0000000-0000-0000-0000-000000000001',NOW(),78),
('c0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000003','GreenTerra Carbon S.A.','seller','GT-BR-2012-55310','BR','agriculture',
  42000000,310,'{}',NULL,2012,'approved','a0000000-0000-0000-0000-000000000001',NOW(),88),
('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000004','AirLogix Freight Inc','buyer','AL-US-2009-77120','US','transport',
  310000000,2400,'{jet_fuel,diesel_fleet}',185000,2009,'approved','a0000000-0000-0000-0000-000000000001',NOW(),72),
('c0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000005','SolarVerde Energía S.L.','seller','SV-ES-2015-30419','ES','energy',
  65000000,180,'{}',NULL,2015,'approved','a0000000-0000-0000-0000-000000000001',NOW(),84);

INSERT INTO registry.carbon_projects (id, company_id, name, description, project_type, verification_standard, verification_body,
  country, total_credits_cap, start_date, end_date, status, approved_by, approved_at) VALUES
('b0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002','Amazon Basin Reforestation',
  'Restoration of 12,000 hectares of degraded pasture in Pará with native species, protecting watershed and biodiversity.',
  'forestry','Verra VCS','SCS Global Services','BR',500000,'2019-01-01','2049-12-31','active','a0000000-0000-0000-0000-000000000001',NOW()),
('b0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000002','Minas Gerais Landfill Methane Capture',
  'Capture and flaring of landfill gas at a municipal site, converting methane to electricity for the local grid.',
  'methane_capture','Gold Standard','Bureau Veritas','BR',200000,'2020-06-01','2030-05-31','active','a0000000-0000-0000-0000-000000000001',NOW()),
('b0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000004','Andalucía Utility-Scale Solar',
  '150 MW photovoltaic plant displacing gas-fired generation on the Spanish grid.',
  'solar','Gold Standard','TÜV SÜD','ES',300000,'2021-03-01','2041-02-28','active','a0000000-0000-0000-0000-000000000001',NOW()),
('b0000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-000000000004','Gujarat Coastal Wind Farm',
  'Proposed 80 MW onshore wind farm on the Gujarat coast, awaiting registry validation.',
  'wind','American Carbon Registry','DNV','IN',250000,'2025-01-01','2045-12-31','pending',NULL,NULL);

INSERT INTO registry.carbon_credits (id, project_id, serial_number, vintage_year, quantity, price_per_unit, co2_methodology, additional_benefits) VALUES
('d0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','VCS-2022-000101',2022,50000,18.50,'VM0047 ARR','{biodiversity,water_quality}'),
('d0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000001','VCS-2023-000102',2023,40000,21.00,'VM0047 ARR','{biodiversity}'),
('d0000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000002','GS-2023-004410',2023,25000,14.75,'AMS-III.G','{local_employment}'),
('d0000000-0000-0000-0000-000000000004','b0000000-0000-0000-0000-000000000003','GS-2024-007731',2024,30000,12.40,'ACM0002','{energy_access}');

INSERT INTO trading.market_prices (credit_id, price, volume_24h, high_24h, low_24h, open_price, recorded_at) VALUES
('d0000000-0000-0000-0000-000000000001',18.00,0,18.00,18.00,18.00,NOW() - INTERVAL '2 days'),
('d0000000-0000-0000-0000-000000000001',18.50,1000,18.50,18.00,18.00,NOW() - INTERVAL '1 day'),
('d0000000-0000-0000-0000-000000000002',21.00,0,21.00,21.00,21.00,NOW() - INTERVAL '1 day'),
('d0000000-0000-0000-0000-000000000003',14.75,0,14.75,14.75,14.75,NOW() - INTERVAL '1 day'),
('d0000000-0000-0000-0000-000000000004',12.40,0,12.40,12.40,12.40,NOW() - INTERVAL '1 day');

-- Open sell orders from the project owners, plus one completed trade
INSERT INTO trading.orders (id, company_id, credit_id, order_type, quantity, price_per_unit, filled_qty, status, placed_at) VALUES
('e0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','sell',5000,18.50,1000,'partially_filled',NOW() - INTERVAL '3 days'),
('e0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','buy', 1000,18.50,1000,'filled',NOW() - INTERVAL '1 day'),
('e0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000003','sell',3000,14.75,0,'open',NOW() - INTERVAL '1 day'),
('e0000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000004','sell',4000,12.40,0,'open',NOW() - INTERVAL '1 day'),
('e0000000-0000-0000-0000-000000000005','c0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000002','sell',2500,21.00,0,'open',NOW() - INTERVAL '1 day');

INSERT INTO trading.trades (id, buy_order_id, sell_order_id, credit_id, buyer_company_id, seller_company_id, quantity, trade_price, platform_fee, executed_at) VALUES
('f0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001',
 'c0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002',1000,18.50,92.50,NOW() - INTERVAL '1 day');

INSERT INTO compliance.emissions_reports (company_id, report_year, scope1_tonnes, scope2_tonnes, scope3_tonnes,
  credits_purchased, credits_retired, third_party_verified, verifier_name, status, submitted_at, reviewed_by, reviewed_at) VALUES
('c0000000-0000-0000-0000-000000000001',2024,250000,95000,60000,1000,1000,TRUE,'Bureau Veritas','approved',NOW() - INTERVAL '60 days','a0000000-0000-0000-0000-000000000001',NOW() - INTERVAL '30 days'),
('c0000000-0000-0000-0000-000000000003',2024,120000,15000,40000,0,0,FALSE,NULL,'submitted',NOW() - INTERVAL '10 days',NULL,NULL);

INSERT INTO compliance.emission_targets (company_id, baseline_year, target_year, reduction_pct, target_type, description) VALUES
('c0000000-0000-0000-0000-000000000001',2020,2030,30,'absolute','Cut absolute Scope 1+2 emissions 30% by 2030 vs 2020.'),
('c0000000-0000-0000-0000-000000000001',2020,2050,100,'net_zero','Net-zero across all scopes by 2050.');


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


-- ════════════════════════════════════════════════════════════════════════════
--  Review 2 demo data (fresh installs only): SteelCorp retires 400 of its
--  purchased credits against its 2024 emissions report.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO registry.retirements (certificate_number, company_id, credit_id, quantity, beneficiary, reason, report_year, retired_by, retired_at)
VALUES ('RET-2024-' || LPAD(nextval('registry.retirement_cert_seq')::TEXT, 6, '0'),
        'c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 400,
        'SteelCorp India Ltd', 'Offset of part of the 2024 Scope 1 emissions', 2024,
        'a0000000-0000-0000-0000-000000000002', NOW() - INTERVAL '20 days');
UPDATE compliance.emissions_reports SET credits_retired = 400
WHERE company_id = 'c0000000-0000-0000-0000-000000000001' AND report_year = 2024;
