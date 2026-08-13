# Accounting Period Tests

| test_suite | test_name | expected_result | actual_result | status | evidence | is_current | superseded_by | executed_at |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ACCOUNTING_PERIOD | Open period permits routine posting | Controlled transition enforced | OPEN | PASS | Isolated database: C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE3_TEST.db | 1 |  | 2026-08-12 22:05:46 |
| ACCOUNTING_PERIOD | Soft close denies routine user | Controlled transition enforced | 403 denied | PASS | Isolated database: C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE3_TEST.db | 1 |  | 2026-08-12 22:05:46 |
| ACCOUNTING_PERIOD | Soft close requires manager reason | Controlled transition enforced | 400 reason required | PASS | Isolated database: C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE3_TEST.db | 1 |  | 2026-08-12 22:05:46 |
| ACCOUNTING_PERIOD | Soft close manager override with reason | Controlled transition enforced | SOFT CLOSED | PASS | Isolated database: C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE3_TEST.db | 1 |  | 2026-08-12 22:05:46 |
| ACCOUNTING_PERIOD | Closed period denies all posting | Controlled transition enforced | 409 denied | PASS | Isolated database: C:\Users\quree\Downloads\pmms-professional-edition\ProcuraFlow\backend\test-artifacts\ProcuraFlow_PHASE3_TEST.db | 1 |  | 2026-08-12 22:05:46 |