# Storekeeper Issue Limit Tests

| test_suite | test_name | expected_result | actual_result | status | evidence | is_current | superseded_by | executed_at |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| STOREKEEPER_ISSUE_LIMIT | Within limit 3000 | 201 Posted | HTTP 201: Posted | PASS | Isolated API database C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE31_TEST.db | 1 |  | 2026-08-12 22:06:00 |
| STOREKEEPER_ISSUE_LIMIT | At limit 5000 | 201 Posted | HTTP 201: Posted | PASS | Isolated API database C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE31_TEST.db | 1 |  | 2026-08-12 22:06:00 |
| STOREKEEPER_ISSUE_LIMIT | Above limit 7000 | 201 PendingApproval | HTTP 201: PendingApproval | PASS | Isolated API database C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE31_TEST.db | 1 |  | 2026-08-12 22:06:00 |
| STOREKEEPER_ISSUE_LIMIT | Insufficient stock | 400 denied | HTTP 400: Insufficient stock at the selected Bin: requested 150, available 120 | PASS | Isolated API database C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE31_TEST.db | 1 |  | 2026-08-12 22:06:00 |