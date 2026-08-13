# Final Concurrency Test Report

| test_suite | test_name | expected_result | actual_result | status | evidence | executed_at |
| --- | --- | --- | --- | --- | --- | --- |
| CONCURRENCY | Concurrent GRN over-receipt | Only one succeeds; total <=10 | 201/400; accepted=8 | PASS | Immediate transaction rechecks outstanding quantity | 2026-08-12 02:05:09 |
| CONCURRENCY | Concurrent document numbering | 12 unique numbers | 12 returned; 12 unique | PASS | Immediate counter transaction | 2026-08-12 02:05:09 |

GRN over-receipt and numbering remain PASS. Final-stock issue, approval race, duplicate-master race, transfer race, and issue/adjustment race are not all executed.