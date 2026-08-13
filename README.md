# ProcuraFlow Professional Edition

ProcuraFlow is a role-controlled procurement, warehouse, inventory, employee-accountability, supplier-performance, and audit management application. It connects PR, sourcing, PO approval, goods receipt, FIFO inventory, material issue, returns, transfers, cycle counting, three-way verification, dashboards, and executive reporting in one controlled workflow.

## Technology

- React, TypeScript, Tailwind CSS, Vite
- Node.js, Express, TypeScript
- SQLite with WAL mode, foreign keys, transactional stock posting, permanent stock ledger, and FIFO layers

## Local startup

Prerequisite: Node.js 18 or later.

Backend:

```powershell
cd backend
Copy-Item .env.example .env
npm install
npm run dev
```

Frontend:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Sign in with an active employee login created through Employee Master Data. ProcuraFlow does not publish demo-account hints on the login screen or in this release guide.

## Release verification

```powershell
cd backend
npm run build
npm run audit:db

cd ..\frontend
npm run build
```

The database audit checks SQLite integrity, foreign keys, negative stock, FIFO-to-stock agreement by physical BIN, invalid receipt splits, excess returns, duplicate document and master codes, transaction quantities and prices, PO totals, PO receipt closure, employee-login linkage, warehouse assignments, and imported inventory dates.

If a legacy database reports FIFO inconsistencies caused by repeated historical opening-balance imports, create a controlled repair backup and reconcile only untracked legacy layers:

```powershell
cd backend
npm run repair:inventory
npm run audit:db
```

The repair command automatically creates a timestamped database backup in `backend/backups` before changing data.

## Production configuration

Before deployment:

- Replace `JWT_SECRET` with a strong random secret.
- Set `DB_PATH=./procuraflow.db` or an approved absolute data path.
- Set `LICENSED_COMPANY_NAME` and `LICENSED_HOSTNAMES` for the purchased company installation.
- Set a strict `CORS_ORIGINS` allowlist.
- Terminate traffic through HTTPS and protect backups and uploaded evidence using operating-system access controls.
- Create named employee accounts and remove or deactivate any test data before go-live.

## Core controls

- Unique PR, PO, GRN, issue, transfer, adjustment, and approval references
- Role and individual permission enforcement in both the UI and API
- Warehouse assignment enforcement for stock operations
- Segregation of duties with the approved Supply Chain Manager exception
- External management evidence for POs above delegated authority
- Posted-document immutability and permanent audit history
- Transactional FIFO receipt, issue, return, transfer, and adjustment processing
- Partial receipt tracking and automatic PO closure only after full accepted receipt
- Company-controlled currency, fiscal year, identity, logo, document branding, and report output
- Password expiry, temporary lock, access restoration, activity monitoring, backup, restore staging, and fiscal close controls
