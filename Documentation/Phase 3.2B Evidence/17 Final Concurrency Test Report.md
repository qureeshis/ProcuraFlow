# Final Concurrency Test Report

## Authoritative passing suite

| Test | Result | Actual |
|---|---|---|
| Final-stock Material Issue 8 + 7 against 10 | PASS | HTTP 201/400; stock=2; FIFO=2 |
| PO Approve + Approve | PASS | HTTP 200/409; approvals=1 |
| PO Approve + Reject | PASS | HTTP 200/403; final=Approved; decisions=1 |
| Duplicate Item master | PASS | HTTP 201/409; records=1 |

## New remaining matrix

| Test | Result | Actual |
|---|---|---|
| Duplicate Vendor concurrency | FAIL | HTTP 403/403; records=0 |
| Warehouse Transfer 8+7 against 10 | FAIL | HTTP 403/403; source=10; destination=0; FIFO=10 |
| Material Issue vs Adjustment concurrency | PASS | HTTP 201/404; stock=2; FIFO=2 |
| Approval Limit race deterministic history | FAIL | HTTP 200/403; PO=Approved; current_limit=10000; historical_limit_captured=false |

Failures are retained and PF-2026-008 remains open.
