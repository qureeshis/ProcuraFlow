# Warehouse Access Verification

17/17 PASS.

| test_suite | test_name | expected_result | actual_result | status | evidence | is_current | superseded_by | executed_at |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
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