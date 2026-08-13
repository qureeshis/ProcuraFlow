# ProcuraFlow Technical Change Log

Audit date: 11 August 2026

| Issue | Severity | Module | Root cause | Change made | Database change | UI change | Security impact | Testing | Status |
|---|---|---|---|---|---|---|---|---|---|
| Attachment access did not validate the parent transaction scope | HIGH | Attachments/API | Authentication and role checks existed, but warehouse scope was not checked against the related GRN | Added parent-document authorization and assigned-warehouse validation for attachment list, upload, and download | None | None | Prevents cross-warehouse attachment IDOR | Backend build; authenticated report/API smoke tests | Corrected |
| GRN detail endpoint did not enforce assigned warehouse scope | HIGH | Warehouse/API | List query was scoped but detail query trusted a direct record ID | Added assigned-warehouse existence check before returning GRN details | None | None | Prevents direct-ID access to another warehouse's GRN | Backend build; database integrity audit | Corrected |
| Spreadsheet export accepted formula-leading and HTML-active values | HIGH | Reports/Export | Dynamic values were interpolated directly into Excel-compatible HTML | Added HTML encoding and formula-prefix neutralization to all exported cells and metadata | None | Yes | Reduces spreadsheet formula injection and exported HTML injection risk | Frontend TypeScript and production build | Corrected |
| No consolidated administrator integrity reports | MEDIUM | Reports/Controls | Integrity checks existed only as a command-line audit | Added System Integrity, Inventory Integrity, Duplicate Master Data, and Segregation-of-Duties reports | None | Yes | Improves continuous control monitoring | Backend/frontend builds; authenticated 200-response tests | Corrected |
| Legacy ledger totals differ from current balances for 52 item/warehouse rows | HIGH | Inventory history | Historical opening balances/FIFO data predate complete ledger coverage | Added visible Inventory Integrity warnings; no historical values were changed | None | Yes | Makes unexplained legacy differences transparent | Stock/FIFO reconciliation passes; report returns 52 warnings | Open – investigate |
| Seven non-management accounts have potentially conflicting permission combinations | HIGH | Access governance | Role defaults combine operational responsibilities that may require compensating review | Added Segregation-of-Duties Conflict Report | None | Yes | Provides review evidence; no permissions removed automatically | Authenticated report returned 7 HIGH rows | Open – management review |
| Warehouse operational reports are role-protected but several aggregate queries are not consistently filtered by assigned warehouse | HIGH | Reports/API | Warehouse scoping is applied in transaction routes but not uniformly in legacy report SQL | Documented for controlled remediation; no report was silently restricted without regression testing | None | None | Potential cross-warehouse information exposure | Static route review | Open |
| Automated regression suite is not present | MEDIUM | Quality assurance | Project relies on build checks, database audit, and manual/API smoke tests | Retained existing audit command and documented required test backlog | None | None | Limits proof of concurrency and workflow regression behavior | Build and audit commands pass | Open |

## Phase 2 – 11 August 2026

| Issue | Severity | Module | Change and evidence | Status |
|---|---|---|---|---|
| Warehouse report assignment scoping | HIGH | Reports/API | Applied authenticated employee warehouse scope to 15 report families and dashboard alerts; 17/17 isolated bypass tests passed | Resolved |
| Tool warehouse ownership absent | HIGH | Tools/API | Added warehouse ownership and enforcement to CRUD, direct record, checkout/check-in, calibration alerts, and report access | Resolved |
| GRN concurrent over-receipt race | CRITICAL | GRN | Added immediate write transaction and in-lock outstanding-quantity recheck; concurrent 8 + 7 against 10 resulted in 201/400 and accepted 8 | Resolved |
| Document counter concurrency | HIGH | Numbering | Changed allocation to an immediate transaction; 12 concurrent PR allocations returned 12 unique numbers | Resolved |
| Legacy ledger warnings lacked permanent review register | HIGH | Inventory Controls | Added 52-row immutable warning register with technical root-cause profile and controlled disposition fields; no historical transaction changed | In progress – management evidence required |
| SoD findings lacked disposition history | HIGH | Access Controls | Added permanent SoD review register with justification, decision, compensating control, expiry, and status fields | In progress – 7 reviews required |
| Backup did not evidence full-package restore | HIGH | Recovery | Created database/uploads/configuration package with SHA-256 manifest; isolated restore, counts, files, FK, integrity, and 48-control audit passed | Resolved |
| Control monitoring fragmented | MEDIUM | Administration UI | Added Audit & Control Center cards and drill-down reports plus finding, backup, ledger, warehouse, and SoD registers | Resolved |
| Report accuracy unverified | MEDIUM | Reports | Independently verified 12 API/source totals; six report families remain not tested | In progress |
# Phase 3 control hardening — 2026-08-11

- Added management-controlled legacy ledger disposition and SoD decision APIs; historical stock and ledger rows remain unchanged.
- Added accounting periods with open, soft-closed, closed, override-reason, reopen, and audit-log handling.
- Applied posting-period checks to GRN, issue, return, transfer, adjustment, invoice, and finance submission paths.
- Added immutable approved-PO amendment snapshots with mandatory reapproval and receipt-stage lockout.
- Added six Phase 3 comparison report APIs and UI entries.
- Formalized the report comparison tolerance at 0.01 in transaction currency.
- Phase 3 control verification passed 7/7; the six remaining report families passed 6/6.
- Created the 17-file Phase 3 evidence package and a fresh validated backup/restore package.
- Phase 3 remains INCOMPLETE pending real management dispositions and the unexecuted full workflow/concurrency/security matrices.
# Phase 3.1 management rules and limit controls — 2026-08-12

- Implemented independent Purchase Officer PO approval within authoritative employee limits; creator auto-approval was removed.
- Added backend limit, role, sequence, active-account, self-approval, replay, and client-tampering controls.
- Added employee/warehouse Material Issue limits with value, quantity, category, dates, currency, approval, and audit evidence.
- Added granular PO, vendor, GRN, issue, and adjustment permissions and updated SoD classification.
- Added atomic PO approval/rejection transitions for concurrency safety.
- Phase 3.1 limit API matrix passed 10/10; prior warehouse, report, period, revision, database, and backup controls remain passing.
- Phase 3.1 remains incomplete pending real ledger/SoD management decisions and the full workflow, concurrency, and security suites.
# Phase 3.2 partial closure and exit testing — 2026-08-12

- Added two-person controlled ledger batch review while preserving every warning record.
- Added current/superseded evidence metadata without deleting historical test rows.
- Executed final-stock issue and PO approval race tests successfully.
- Duplicate-master concurrency remains recorded as FAIL because the fixture expected one survivor but both requests were rejected.
- Preserved warehouse, limit, report, period, revision, database, and backup controls.
- Phase 3.2 remains INCOMPLETE; Phase 3.3 is NOT READY because management decisions and required technical suites remain outstanding.
