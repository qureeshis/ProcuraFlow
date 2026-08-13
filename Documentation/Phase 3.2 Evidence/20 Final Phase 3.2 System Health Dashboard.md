# ProcuraFlow Phase 3.2 Executive Summary

Generated 2026-08-12T22:07:00.249Z

- Critical Open: 0
- High Open: 2
- Medium Open: 2
- Low Open: 0
- Legacy Ledger Reviewed: 0 / 52
- SoD Cases Approved: 0 / 7
- Purchase Officer Approval Tests: 6 / 6 PASS
- Storekeeper Material Issue Tests: 4 / 4 PASS
- Full PR-to-Finance Workflow: NOT TESTED
- Partial GRN: prior concurrency fixture PASS; required 40/35/25 workflow NOT TESTED
- New Phase 3.2 Concurrency: 3 / 4 PASS
- Full Security Matrix: INCOMPLETE
- Warehouse Authorization: 17 / 17 PASS
- Reports Verified: 6 / 6 PASS
- Accounting Period: PASS
- Document Revision: PASS
- Database Structural Integrity: PASS
- Stock/FIFO Integrity: PASS

Phase 3.2 Status: **INCOMPLETE**

Ready for Phase 3.3 Warehouse Structure Implementation: **NOT READY**

Management dispositions remain 0/52 and individual High SoD approvals remain outstanding. The full workflow, transfer/issue-adjustment/limit-race concurrency, and complete security matrix are not executed. Duplicate-master concurrency is recorded FAIL because both requests were rejected and the harness expected one surviving record. No status was forced to PASS.

## Current Evidence

| test_suite | test_name | expected_result | actual_result | status | evidence | is_current | superseded_by | executed_at |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ACCOUNTING_PERIOD | Open period permits routine posting | Controlled transition enforced | OPEN | PASS | Isolated database: C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE3_TEST.db | 1 |  | 2026-08-12 22:05:46 |
| ACCOUNTING_PERIOD | Soft close denies routine user | Controlled transition enforced | 403 denied | PASS | Isolated database: C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE3_TEST.db | 1 |  | 2026-08-12 22:05:46 |
| ACCOUNTING_PERIOD | Soft close requires manager reason | Controlled transition enforced | 400 reason required | PASS | Isolated database: C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE3_TEST.db | 1 |  | 2026-08-12 22:05:46 |
| ACCOUNTING_PERIOD | Soft close manager override with reason | Controlled transition enforced | SOFT CLOSED | PASS | Isolated database: C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE3_TEST.db | 1 |  | 2026-08-12 22:05:46 |
| ACCOUNTING_PERIOD | Closed period denies all posting | Controlled transition enforced | 409 denied | PASS | Isolated database: C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE3_TEST.db | 1 |  | 2026-08-12 22:05:46 |
| BACKUP_RESTORE | Full package isolated restore | Integrity, counts, files and deterministic audit pass | integrity=ok; fk=0; counts=true; files=true; audit=0 | PASS | C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\validated-backups\procuraflow-validated-2026-08-12T02-05-10-270Z | 1 |  | 2026-08-12 02:05:15 |
| BACKUP_RESTORE | Full package isolated restore | Integrity, counts, files and deterministic audit pass | integrity=ok; fk=0; counts=true; files=true; audit=0 | PASS | C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\validated-backups\procuraflow-validated-2026-08-12T02-43-29-236Z | 1 |  | 2026-08-12 02:43:38 |
| BACKUP_RESTORE | Full package isolated restore | Integrity, counts, files and deterministic audit pass | integrity=ok; fk=0; counts=true; files=true; audit=0 | PASS | C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\validated-backups\procuraflow-validated-2026-08-12T21-47-30-441Z | 1 |  | 2026-08-12 21:47:38 |
| CONCURRENCY | Concurrent GRN over-receipt | Only one succeeds; total <=10 | 201/400; accepted=8 | PASS | Immediate transaction rechecks outstanding quantity | 1 |  | 2026-08-12 02:05:09 |
| CONCURRENCY | Concurrent document numbering | 12 unique numbers | 12 returned; 12 unique | PASS | Immediate counter transaction | 1 |  | 2026-08-12 02:05:09 |
| CONCURRENCY_PHASE32 | Final-stock Material Issue 8 + 7 against 10 | One succeeds; stock nonnegative; FIFO equals stock | HTTP 201/400; stock=2; FIFO=2 | PASS | Isolated API DB C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE31_TEST.db | 1 |  | 2026-08-12 22:05:15 |
| CONCURRENCY_PHASE32 | PO Approve + Approve | One 200, one conflict, one approval | HTTP 200/409; approvals=1 | PASS | Isolated API DB C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE31_TEST.db | 1 |  | 2026-08-12 22:05:15 |
| CONCURRENCY_PHASE32 | PO Approve + Reject | One transition, one final state | HTTP 200/403; final=Approved; decisions=1 | PASS | Isolated API DB C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE31_TEST.db | 1 |  | 2026-08-12 22:05:15 |
| CONCURRENCY_PHASE32 | Duplicate Item master | One active record | HTTP 409/409; records=0 | FAIL | Isolated API DB C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE31_TEST.db | 1 |  | 2026-08-12 22:05:15 |
| DOCUMENT_REVISION | Immutable approved-document snapshot | Controlled transition enforced | Revision 1; reapproval required | PASS | Isolated database: C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE3_TEST.db | 1 |  | 2026-08-12 22:05:46 |
| PO_APPROVAL_LIMIT | Below limit 8000 | 200 | HTTP 200: success | PASS | Isolated API database C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE31_TEST.db | 1 |  | 2026-08-12 22:06:00 |
| PO_APPROVAL_LIMIT | At limit 10000 | 200 | HTTP 200: success | PASS | Isolated API database C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE31_TEST.db | 1 |  | 2026-08-12 22:06:00 |
| PO_APPROVAL_LIMIT | Above limit 10001 | 403 | HTTP 403: Approval is currently assigned to the nearest available Purchase Manager | PASS | Isolated API database C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE31_TEST.db | 1 |  | 2026-08-12 22:06:00 |
| PO_APPROVAL_LIMIT | Client limit tampering ignored | 403 | HTTP 403: Approval is currently assigned to the nearest available Purchase Manager | PASS | Isolated API database C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE31_TEST.db | 1 |  | 2026-08-12 22:06:00 |
| PO_APPROVAL_LIMIT | Replay approved PO | 409 | HTTP 409: PO is Approved and can no longer be amended or approved | PASS | Isolated API database C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE31_TEST.db | 1 |  | 2026-08-12 22:06:00 |
| PO_APPROVAL_LIMIT | Own limit change denied | 403 | HTTP 403: This employee account is not assigned permission 'task.employees' | PASS | Isolated API database C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE31_TEST.db | 1 |  | 2026-08-12 22:06:00 |
| REPORT_ACCURACY | Inventory Balance | 846315 | 846315 | PASS | {"name":"Inventory Balance","endpoint":"stock-balance","source_total":846315,"api_total":846315,"export_basis":"Export uses the identical API row set after selected UI filters","status":"PASS"} | 1 |  | 2026-08-12 02:36:29 |
| REPORT_ACCURACY | Inventory Valuation | 766493.31 | 766493.32 | PASS | {"name":"Inventory Valuation","endpoint":"fifo-valuation","source_total":766493.31,"api_total":766493.32,"export_basis":"Export uses the identical API row set after selected UI filters","status":"PASS"} | 1 |  | 2026-08-12 02:36:29 |
| REPORT_ACCURACY | Stock Ledger | 410282.84 | 410282.83 | PASS | {"name":"Stock Ledger","endpoint":"stock-ledger","source_total":410282.84,"api_total":410282.83,"export_basis":"Export uses the identical API row set after selected UI filters","status":"PASS"} | 1 |  | 2026-08-12 02:36:29 |
| REPORT_ACCURACY | Purchase Register | 316990.99 | 316991 | PASS | {"name":"Purchase Register","endpoint":"po-register","source_total":316990.99,"api_total":316991,"export_basis":"Export uses the identical API row set after selected UI filters","status":"PASS"} | 1 |  | 2026-08-12 02:36:29 |
| REPORT_ACCURACY | Open Purchase Orders | 316245.17 | 316245.18 | PASS | {"name":"Open Purchase Orders","endpoint":"open-po","source_total":316245.17,"api_total":316245.18,"export_basis":"Export uses the identical API row set after selected UI filters","status":"PASS"} | 1 |  | 2026-08-12 02:36:29 |
| REPORT_ACCURACY | GRN Register | 43231 | 43231 | PASS | {"name":"GRN Register","endpoint":"grn-register","source_total":43231,"api_total":43231,"export_basis":"Export uses the identical API row set after selected UI filters","status":"PASS"} | 1 |  | 2026-08-12 02:36:29 |
| REPORT_ACCURACY | Material Issues | 48.44 | 48.44 | PASS | {"name":"Material Issues","endpoint":"daily-issues","source_total":48.44,"api_total":48.44,"export_basis":"Export uses the identical API row set after selected UI filters","status":"PASS"} | 1 |  | 2026-08-12 02:36:29 |
| REPORT_ACCURACY | Material Returns | 0 | 0 | PASS | {"name":"Material Returns","endpoint":"returns-report","source_total":0,"api_total":0,"export_basis":"Export uses the identical API row set after selected UI filters","status":"PASS"} | 1 |  | 2026-08-12 02:36:29 |
| REPORT_ACCURACY | Warehouse Transfers | 0 | 0 | PASS | {"name":"Warehouse Transfers","endpoint":"transfers-report","source_total":0,"api_total":0,"export_basis":"Export uses the identical API row set after selected UI filters","status":"PASS"} | 1 |  | 2026-08-12 02:36:29 |
| REPORT_ACCURACY | Employee Consumption | 48.44 | 48.44 | PASS | {"name":"Employee Consumption","endpoint":"consumption-by-employee","source_total":48.44,"api_total":48.44,"export_basis":"Export uses the identical API row set after selected UI filters","status":"PASS"} | 1 |  | 2026-08-12 02:36:29 |
| REPORT_ACCURACY | Department Consumption | 48.44 | 48.44 | PASS | {"name":"Department Consumption","endpoint":"consumption-by-department","source_total":48.44,"api_total":48.44,"export_basis":"Export uses the identical API row set after selected UI filters","status":"PASS"} | 1 |  | 2026-08-12 02:36:29 |
| REPORT_ACCURACY | Vendor Purchases | 316990.99 | 316990.99 | PASS | {"name":"Vendor Purchases","endpoint":"supplier-purchase-analysis","source_total":316990.99,"api_total":316990.99,"export_basis":"Export uses the identical API row set after selected UI filters","status":"PASS"} | 1 |  | 2026-08-12 02:36:29 |
| REPORT_ACCURACY_PHASE3 | Bin Stock | 846315 | 846315 | PASS | {"name":"Bin Stock","endpoint":"bin-stock","http_status":200,"source_result":846315,"api_result":846315,"ui_result":846315,"export_result":846315,"difference":0,"allowed_tolerance":0.01,"status":"PASS"} | 1 |  | 2026-08-12 22:05:53 |
| REPORT_ACCURACY_PHASE3 | Invoice Register | 715 | 715 | PASS | {"name":"Invoice Register","endpoint":"invoice-register","http_status":200,"source_result":715,"api_result":715,"ui_result":715,"export_result":715,"difference":0,"allowed_tolerance":0.01,"status":"PASS"} | 1 |  | 2026-08-12 22:05:53 |
| REPORT_ACCURACY_PHASE3 | PO vs GRN | 3455 | 3455 | PASS | {"name":"PO vs GRN","endpoint":"po-vs-grn","http_status":200,"source_result":3455,"api_result":3455,"ui_result":3455,"export_result":3455,"difference":0,"allowed_tolerance":0.01,"status":"PASS"} | 1 |  | 2026-08-12 22:05:53 |
| REPORT_ACCURACY_PHASE3 | PO vs Invoice | 316990.99 | 316990.99 | PASS | {"name":"PO vs Invoice","endpoint":"po-vs-invoice","http_status":200,"source_result":316990.99,"api_result":316990.99,"ui_result":316990.99,"export_result":316990.99,"difference":0,"allowed_tolerance":0.01,"status":"PASS"} | 1 |  | 2026-08-12 22:05:53 |
| REPORT_ACCURACY_PHASE3 | GRN vs Invoice | 51170.82 | 51170.82 | PASS | {"name":"GRN vs Invoice","endpoint":"grn-vs-invoice","http_status":200,"source_result":51170.82,"api_result":51170.82,"ui_result":51170.82,"export_result":51170.82,"difference":0,"allowed_tolerance":0.01,"status":"PASS"} | 1 |  | 2026-08-12 22:05:53 |
| REPORT_ACCURACY_PHASE3 | Three-Way Match | 715 | 715 | PASS | {"name":"Three-Way Match","endpoint":"three-way-match","http_status":200,"source_result":715,"api_result":715,"ui_result":715,"export_result":715,"difference":0,"allowed_tolerance":0.01,"status":"PASS"} | 1 |  | 2026-08-12 22:05:53 |
| SECURITY_REGRESSION | Role bypass to administrator report | 403 | 403 | PASS | Executed against running backend | 1 |  | 2026-08-12 02:06:06 |
| SECURITY_REGRESSION | Inactive/nonexistent account token | 401 | 401 | PASS | Executed against running backend | 1 |  | 2026-08-12 02:06:06 |
| SECURITY_REGRESSION | Expired session | 401 | 401 | PASS | Executed against running backend | 1 |  | 2026-08-12 02:06:06 |
| SECURITY_REGRESSION | Cross-warehouse GRN IDOR | Test fixture | No other-warehouse GRN | NOT TESTED | Executed against running backend | 1 |  | 2026-08-12 02:06:06 |
| SECURITY_REGRESSION | Unsupported attachment type | 400 | 400 | PASS | Executed against running backend | 1 |  | 2026-08-12 02:06:06 |
| STOREKEEPER_ISSUE_LIMIT | Within limit 3000 | 201 Posted | HTTP 201: Posted | PASS | Isolated API database C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE31_TEST.db | 1 |  | 2026-08-12 22:06:00 |
| STOREKEEPER_ISSUE_LIMIT | At limit 5000 | 201 Posted | HTTP 201: Posted | PASS | Isolated API database C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE31_TEST.db | 1 |  | 2026-08-12 22:06:00 |
| STOREKEEPER_ISSUE_LIMIT | Above limit 7000 | 201 PendingApproval | HTTP 201: PendingApproval | PASS | Isolated API database C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE31_TEST.db | 1 |  | 2026-08-12 22:06:00 |
| STOREKEEPER_ISSUE_LIMIT | Insufficient stock | 400 denied | HTTP 400: Insufficient stock at the selected Bin: requested 150, available 120 | PASS | Isolated API database C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE31_TEST.db | 1 |  | 2026-08-12 22:06:00 |
| WAREHOUSE_ACCESS | Scope stock-balance | No Yard Storage data | 200; 71 rows | PASS | Tampered warehouse_id query ignored; server assignment applied | 1 |  | 2026-08-12 02:05:09 |
| WAREHOUSE_ACCESS | Scope fifo-valuation | No Yard Storage data | 200; 36 rows | PASS | Tampered warehouse_id query ignored; server assignment applied | 1 |  | 2026-08-12 02:05:09 |
| WAREHOUSE_ACCESS | Scope grn-register | No Yard Storage data | 200; 6 rows | PASS | Tampered warehouse_id query ignored; server assignment applied | 1 |  | 2026-08-12 02:05:09 |
| WAREHOUSE_ACCESS | Scope daily-receiving | No Yard Storage data | 200; 6 rows | PASS | Tampered warehouse_id query ignored; server assignment applied | 1 |  | 2026-08-12 02:05:09 |
| WAREHOUSE_ACCESS | Scope daily-issues | No Yard Storage data | 200; 5 rows | PASS | Tampered warehouse_id query ignored; server assignment applied | 1 |  | 2026-08-12 02:05:09 |
| WAREHOUSE_ACCESS | Scope returns-report | No Yard Storage data | 200; 0 rows | PASS | Tampered warehouse_id query ignored; server assignment applied | 1 |  | 2026-08-12 02:05:09 |
| WAREHOUSE_ACCESS | Scope transfers-report | No Yard Storage data | 200; 0 rows | PASS | Tampered warehouse_id query ignored; server assignment applied | 1 |  | 2026-08-12 02:05:09 |
| WAREHOUSE_ACCESS | Scope adjustments-report | No Yard Storage data | 200; 0 rows | PASS | Tampered warehouse_id query ignored; server assignment applied | 1 |  | 2026-08-12 02:05:09 |
| WAREHOUSE_ACCESS | Scope stock-ledger | No Yard Storage data | 200; 46 rows | PASS | Tampered warehouse_id query ignored; server assignment applied | 1 |  | 2026-08-12 02:05:09 |
| WAREHOUSE_ACCESS | Scope batch-report | No Yard Storage data | 200; 73 rows | PASS | Tampered warehouse_id query ignored; server assignment applied | 1 |  | 2026-08-12 02:05:09 |
| WAREHOUSE_ACCESS | Scope cycle-count-accuracy | No Yard Storage data | 200; 0 rows | PASS | Tampered warehouse_id query ignored; server assignment applied | 1 |  | 2026-08-12 02:05:09 |
| WAREHOUSE_ACCESS | Scope outstanding-returnables | No Yard Storage data | 200; 0 rows | PASS | Tampered warehouse_id query ignored; server assignment applied | 1 |  | 2026-08-12 02:05:09 |
| WAREHOUSE_ACCESS | Scope tool-condition | No Yard Storage data | 200; 0 rows | PASS | Tampered warehouse_id query ignored; server assignment applied | 1 |  | 2026-08-12 02:05:09 |
| WAREHOUSE_ACCESS | Scope consumption-by-employee | No Yard Storage data | 200; 4 rows | PASS | Tampered warehouse_id query ignored; server assignment applied | 1 |  | 2026-08-12 02:05:09 |
| WAREHOUSE_ACCESS | Scope consumption-by-department | No Yard Storage data | 200; 2 rows | PASS | Tampered warehouse_id query ignored; server assignment applied | 1 |  | 2026-08-12 02:05:09 |
| WAREHOUSE_ACCESS | Direct denied GRN | 404/403 | 404 | PASS | Direct ID outside assigned warehouse rejected | 1 |  | 2026-08-12 02:05:09 |
| WAREHOUSE_ACCESS | Denied attachment list | 404/403 | 404 | PASS | Direct ID outside assigned warehouse rejected | 1 |  | 2026-08-12 02:05:09 |
| WORKFLOW_REGRESSION | Isolated database integrity | ok / 0 FK | ok / 0 | PASS | Post-test isolated DB validation | 1 |  | 2026-08-12 02:05:09 |