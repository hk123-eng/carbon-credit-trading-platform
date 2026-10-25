# 🌱 Carbon Credit Trading Platform

A full-stack web application for carbon credit trading, built with a Node.js/Express backend and a vanilla HTML/CSS/JS frontend, connected to PostgreSQL. Companies are verified (KYC), issue and trade credits through an order book with wallet escrow, retire credits with certificates, and report Scope 1–3 emissions against reduction targets.

**Live app:** not deployed — the project runs locally (see [Quick Start](#quick-start)).

---

## Prerequisites

- **Node.js** v22 or higher → https://nodejs.org
- **PostgreSQL** 13 or higher (pgAdmin 4 recommended)

---

## Database Setup

**New installation** — [`database/schema.sql`](database/schema.sql) creates every table, view and constraint and loads demo data.

1. Create a database named `carbon_credit_platform` (pgAdmin → Databases → Create).
2. Open the Query Tool on that database, load `database/schema.sql` and run it, or from a terminal:

```bash
psql -U postgres -d carbon_credit_platform -f database/schema.sql
```

> ⚠️ `schema.sql` drops and recreates the `auth`, `registry`, `trading` and `compliance` schemas.

**Upgrading a Review 1 database** — keep your data and apply only the new migration (safe to run more than once):

```bash
psql -U postgres -d carbon_credit_platform -f database/migrations/002_review2.sql
```

`schema.sql` is generated from the files in `database/migrations/` by `database/build-schema.sh`.

---

## Quick Start

### Step 1 — Install backend dependencies

```bash
cd backend
npm install
```

### Step 2 — Create your .env file

Copy the example file and fill in your own values:

```bash
cp backend/.env.example backend/.env      # Windows: copy backend\.env.example backend\.env
```

`.env` is git-ignored — never commit it. No real keys are stored in this repository.

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `DB_HOST` | no | `localhost` | PostgreSQL host |
| `DB_PORT` | no | `5432` | PostgreSQL port |
| `DB_NAME` | no | `carbon_credit_platform` | Database name |
| `DB_USER` | no | `postgres` | Database user |
| `DB_PASSWORD` | **yes** | — | Your PostgreSQL password |
| `JWT_SECRET` | **yes** | — | Long random string used to sign login tokens |
| `JWT_EXPIRES_IN` | no | `24h` | Login token lifetime |
| `PORT` | no | `3001` | Port the server listens on |
| `FRONTEND_URL` | no | `http://localhost:3001` | Allowed CORS origin |
| `APP_URL` | no | address of the request | Base address used in e-mail links |
| `UPLOAD_DIR` | no | `backend/uploads/kyc` | Where KYC documents are stored |
| `ORDER_EXPIRY_INTERVAL_MS` | no | `60000` | How often expired orders are closed |
| `RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_MAX` | no | `200` / `20` | Requests allowed per 15 minutes (API / login) |
| `MAIL_LOG` | no | on | Set to `off` to stop printing e-mails to the console |
| `NODE_ENV` | no | — | Set to `production` to hide the dev verification link |

Generate a JWT secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Step 3 — Start the server

```bash
cd backend
npm start
```

Or use the launcher in the project root, which installs dependencies on first run: `start.bat` (Windows) or `./start.sh` (macOS/Linux).

### Step 4 — Open in browser

Go to: **http://localhost:3001**

---

## Login Credentials (from seed data)

| Role   | Email                          | Password     |
|--------|-------------------------------|--------------|
| Admin  | admin@carbonplatform.io        | Admin@1234   |
| Buyer  | cfo@steelcorp.com             | Buyer@1234   |
| Seller | ops@greenterra.io             | Seller@1234  |
| Buyer  | sustainability@airlogix.com   | Buyer@1234   |
| Seller | projects@solarverde.org       | Seller@1234  |

The buyer companies start with a sandbox wallet balance of $500,000.

**New accounts** must verify their e-mail before registering a company. There is no e-mail server in development, so the verification link is shown on screen after registering (and printed in the server console). Messages are also stored in `auth.outbox_emails`.

---

## Features by Role

### 🛒 Buyer
- Dashboard with portfolio value, available funds and recent trades
- Browse market and filter credits by project type, location, vintage and verification standard; price-history chart per credit
- Place buy/sell orders (optional expiry) — matched automatically by price-time priority
- **Wallet**: add or withdraw sandbox funds; buy orders hold quantity × price in escrow
- Portfolio with P&L; sell or **retire** held credits and get a numbered **retirement certificate**
- Emissions reports (retired credits are counted automatically) and reduction targets, with on-track / off-track status
- Company profile with **KYC document upload**
- **Notifications** for trades, expiries, approvals and security events
- **Security**: e-mail verification and **two-factor login** (authenticator app)

### 🌿 Seller
- All buyer features +
- Create carbon projects and issue credits on approved projects (serial number, vintage and cap are checked)

### ⚙️ Admin
- Platform overview (trades, fees, retirements, wallet funds)
- Review KYC with the uploaded documents; approve/reject/suspend projects
- Review emissions reports, manage users, see all trades and retirement certificates
- Run the order-expiry job on demand
- Full audit log

### 🌐 Anyone
- Check that a retirement certificate is genuine by its number (Retirements page or `GET /api/market/certificates/:number`)

---

## Security

- Passwords hashed with bcrypt (12 rounds); optional TOTP two-factor login (RFC 6238)
- JWT authentication with role-based access (buyer / seller / admin)
- Account locked for 15 minutes after 5 consecutive failed logins (wrong password or wrong code)
- E-mail verification with single-use, 24-hour tokens (only a SHA-256 hash is stored)
- KYC uploads: PDF/PNG/JPEG only, checked by file signature, 5 MB limit, stored under random names
- Rate limiting on the API and login endpoint; parameterised SQL everywhere
- Audit log of logins and data changes; all user-supplied text is HTML-escaped in the browser

---

## How Trading Works

1. A seller issues credits on an admin-approved project.
2. A KYC-approved company places a **buy** or **sell** order.
3. Buy orders first move quantity × limit price from the wallet into **escrow**; sell orders are limited to credits the company holds (issued + bought − sold − retired − already listed).
4. The order is matched against the best-priced opposite orders (oldest first at equal price). Trades execute at the resting order's price.
5. Each trade settles immediately: the buyer pays from escrow (any price improvement is returned) and the seller receives the value minus a 0.5% platform fee.
6. Unmatched quantity stays open until it is matched, cancelled or expires; cancelled and expired buy orders return their escrow.

---

## Tests

The automated suite (47 tests) creates throw-away databases from `schema.sql`, so it never touches your data. PostgreSQL must be running and `backend/.env` must contain the database password.

```bash
cd backend
npm test
```

GitHub Actions runs the same suite on every push (`.github/workflows/ci.yml`).

---

## Docker (optional)

```bash
JWT_SECRET=change-me DB_PASSWORD=change-me docker compose up --build
```

This starts PostgreSQL (loading `schema.sql` on first start) and the app on http://localhost:3001. The Docker files have not been tested on the development machine, which has no Docker installed.

---

## Project Structure

```
carbon_credit_platform/
├── database/
│   ├── schema.sql              # Complete fresh install (generated)
│   ├── build-schema.sh         # Rebuilds schema.sql from migrations/
│   └── migrations/             # 001 initial schema, 002 Review 2, demo seed
├── backend/
│   ├── server.js               # Express app + order-expiry scheduler
│   ├── db/index.js             # PostgreSQL pool + audit logger
│   ├── middleware/auth.js      # JWT and role checks
│   ├── lib/                    # wallet (escrow), totp, notify, mailer, registry-rules
│   ├── jobs/order-expiry.js    # Closes expired orders and returns escrow
│   ├── routes/                 # auth, market, trading, companies, compliance, wallet, notifications, admin
│   └── test/                   # node:test suite
├── frontend/
│   ├── index.html
│   ├── css/main.css
│   └── js/                     # api, auth, router, charts + pages/
├── docs/                       # Design diagrams (draw.io / StarUML)
├── Dockerfile, docker-compose.yml
└── .github/workflows/ci.yml
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | Register (sends verification e-mail) |
| GET  | /api/auth/verify-email?token= | Verify e-mail (also `/verify-email` link) |
| POST | /api/auth/resend-verification | Send a new verification e-mail |
| POST | /api/auth/login | Login (`mfa_code` when two-factor is on) |
| GET  | /api/auth/me | Current user profile |
| POST | /api/auth/mfa/setup · /enable · /disable | Two-factor login |
| GET  | /api/market · /api/market/credits | Market overview and listings |
| GET  | /api/market/prices/:creditId | Price history |
| GET  | /api/market/certificates/:number | Public certificate check |
| GET/POST | /api/trading/orders | My orders · place order (escrow + matching) |
| DELETE | /api/trading/orders/:id | Cancel order (returns escrow) |
| GET  | /api/trading/trades · /api/trading/portfolio | Trade history · holdings |
| POST | /api/trading/retire | Retire credits, issue certificate |
| GET  | /api/trading/retirements[/:id] | My certificates |
| POST | /api/trading/execute | Manually match two orders (admin) |
| GET  | /api/wallet | Balance, escrow, ledger |
| POST | /api/wallet/deposit · /withdraw | Sandbox funds |
| GET  | /api/notifications | Notifications + unread count |
| POST | /api/notifications/:id/read · /read-all | Mark as read |
| GET/POST | /api/companies/my · /api/companies | My company · register company |
| GET/POST | /api/companies/documents | KYC documents (upload as base64 JSON) |
| GET  | /api/companies/documents/:id/download | Download (owner or admin) |
| GET/POST | /api/companies/projects · /api/companies/credits | Projects · issue credits |
| GET/POST | /api/compliance/reports · /targets | Emissions reports · targets |
| GET  | /api/admin/stats · /api/admin/retirements | Admin overview · all certificates |
| POST | /api/admin/jobs/expire-orders | Run the expiry job now |
| GET  | /api/health | Health check |

---

## Troubleshooting

**"Account temporarily locked"** — 5 failed attempts lock an account for 15 minutes. Wait, or reset it in SQL: `UPDATE auth.users SET failed_login_count = 0, locked_until = NULL WHERE email = '...';`

**"Please verify your e-mail address"** — open the verification link shown after registering, or use Security → *Send verification e-mail again*.

**"This company has not uploaded any KYC documents yet"** — the company must upload at least one document (Company page) before an admin can approve it.

**"Insufficient funds"** — add sandbox funds on the Wallet page; open buy orders keep their money in escrow.

**"Cannot connect to database"** — make sure PostgreSQL is running and the password in `backend/.env` is correct.

**"Port already in use"** — change `PORT=3001` in `backend/.env`.
