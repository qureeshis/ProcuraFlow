# ProcuraFlow Professional Edition

ProcuraFlow is a role-controlled procurement, warehouse, inventory, employee-accountability, supplier-performance, and audit management application. It connects PR, sourcing, PO approval, goods receipt, FIFO inventory, material issue, returns, transfers, cycle counting, three-way verification, dashboards, and executive reporting in one controlled workflow.

## Technology

- React, TypeScript, Tailwind CSS, Vite
- Python, FastAPI
- SQLite with WAL mode, foreign keys, transactional stock posting, permanent stock ledger, and FIFO layers

## Local startup

Prerequisites: Python 3.13 and Node.js 18 or later.

Backend:

```powershell
cd backend-python
Copy-Item .env.example .env
..\..\venv\Scripts\python.exe -m pip install -r requirements.txt
.\run.ps1
```

Frontend:

```powershell
cd frontend-js
npm install
npm run dev
```

Open `http://localhost:5173`. Sign in with an active employee login created through Employee Master Data. ProcuraFlow does not publish demo-account hints on the login screen or in this release guide.

## Release verification

```powershell
cd backend-python
..\..\venv\Scripts\python.exe -m pytest tests/test_smoke.py tests/test_database_bootstrap.py tests/test_tenant_registration_isolation.py

cd ..\frontend-js
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

## Demo Deployment

For a hosted feedback demo, keep all backend runtime data on Render's persistent
disk. The included `render.yaml` mounts that disk at `/var/data` and points the
database, tenants, uploads, and backups there:

- `DB_PATH=/var/data/procuraflow.db`
- `TENANT_DATA_DIR=/var/data/tenants`
- `UPLOADS_DIR=/var/data/uploads`
- `BACKUPS_DIR=/var/data/backups`

`ALLOW_MULTIPLE_COMPANIES=true` is set in `render.yaml` so different feedback
testers can register their own demo company workspaces. If you want everyone to
use one shared company login instead, set it to `false` after the first company
is registered.

On Vercel, add this frontend environment variable and redeploy:

```text
VITE_API_URL=https://your-render-backend-url.onrender.com/api
```

On Render, set `CORS_ORIGINS` to the deployed Vercel URL, for example:

```text
https://your-vercel-app.vercel.app
```

SQLite is fine for a light demo, but do not remove the Render disk or the saved
feedback data will be lost.

## Production configuration

Before deployment:

- Replace `JWT_SECRET` with a strong random secret.
- Set `DB_PATH`, `TENANT_DATA_DIR`, `UPLOADS_DIR`, and `BACKUPS_DIR` to approved
  persistent storage paths.
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
