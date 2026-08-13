# Concurrency Regression

10/10 PASS across duplicate item, duplicate vendor, transfers, issue/adjustment, and approval-limit snapshots.

| Group | Test | Status | Evidence |
|---|---|---|---|
| Regression | Warehouse Transfer 8+7 against 10 | PASS | HTTP 201/400; source=2; destination=8; FIFO=10; documents=1 |
| Regression | Issue vs Adjustment | PASS | create=201; race=201/403; stock=2; FIFO=2 |
