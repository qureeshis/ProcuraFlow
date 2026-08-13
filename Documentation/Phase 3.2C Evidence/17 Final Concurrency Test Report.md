# Final Concurrency Matrix

| Test | Status | Actual |
|---|---|---|
| Duplicate Vendor | PASS | HTTP 201/409; records=1; create_audits=1 |
| Approval Limit Race Snapshot | PASS | HTTP 200/400; PO=Approved; snapshot={"approval_value":9000,"approval_limit_used":10000,"approval_limit_source":"EMPLOYEE_MASTER","approval_limit_version":null,"approval_limit_effective_at":"2026-08-12T23:18:06.410Z","approver_employee_id":16,"approver_role":"PurchaseOfficer","workflow_level":"PurchaseOfficer"}; history_rows=0 |
| Warehouse Transfer 8+7 against 10 | PASS | HTTP 201/400; source=2; destination=8; FIFO=10; documents=1 |
| Issue vs Adjustment | PASS | create=201; race=201/403; stock=2; FIFO=2 |

The other six required cases remain PASS in the freshly rerun Phase 2/Phase 3.2 suites.
