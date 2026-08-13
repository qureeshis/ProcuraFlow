# Final Concurrency Test Report

| test_suite | test_name | expected_result | actual_result | status | evidence | is_current | superseded_by | executed_at |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CONCURRENCY | Concurrent GRN over-receipt | Only one succeeds; total <=10 | 201/400; accepted=8 | PASS | Immediate transaction rechecks outstanding quantity | 1 |  | 2026-08-12 02:05:09 |
| CONCURRENCY | Concurrent document numbering | 12 unique numbers | 12 returned; 12 unique | PASS | Immediate counter transaction | 1 |  | 2026-08-12 02:05:09 |
| CONCURRENCY_PHASE32 | Final-stock Material Issue 8 + 7 against 10 | One succeeds; stock nonnegative; FIFO equals stock | HTTP 201/400; stock=2; FIFO=2 | PASS | Isolated API DB C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE31_TEST.db | 1 |  | 2026-08-12 22:05:15 |
| CONCURRENCY_PHASE32 | PO Approve + Approve | One 200, one conflict, one approval | HTTP 200/409; approvals=1 | PASS | Isolated API DB C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE31_TEST.db | 1 |  | 2026-08-12 22:05:15 |
| CONCURRENCY_PHASE32 | PO Approve + Reject | One transition, one final state | HTTP 200/403; final=Approved; decisions=1 | PASS | Isolated API DB C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE31_TEST.db | 1 |  | 2026-08-12 22:05:15 |
| CONCURRENCY_PHASE32 | Duplicate Item master | One active record | HTTP 409/409; records=0 | FAIL | Isolated API DB C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE31_TEST.db | 1 |  | 2026-08-12 22:05:15 |