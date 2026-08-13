# Concurrency Test Report

Audit evidence date: 11 August 2026

GRN over-receipt and document numbering are tested. Inventory issue, approval, and duplicate-master concurrency remain NOT TESTED.

| test_suite | test_name | report_api | expected_result | actual_result | status | evidence | executed_at |
|---|---|---|---|---|---|---|---|
| CONCURRENCY | Concurrent GRN over-receipt | POST /api/warehouse/grns | Only one succeeds; total <=10 | 201/400; accepted=8 | PASS | Immediate transaction rechecks outstanding quantity | 2026-08-12 02:05:09 |
| CONCURRENCY | Concurrent document numbering | nextDocNumber(PR) | 12 unique numbers | 12 returned; 12 unique | PASS | Immediate counter transaction | 2026-08-12 02:05:09 |

