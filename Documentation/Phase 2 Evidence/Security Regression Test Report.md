# Security Regression Test Report

Audit evidence date: 11 August 2026

Cross-warehouse report/GRN/attachment tests are also evidenced in the Warehouse report.

| test_suite | test_name | report_api | expected_result | actual_result | status | evidence | executed_at |
|---|---|---|---|---|---|---|---|
| SECURITY_REGRESSION | Role bypass to administrator report | Authenticated API | 403 | 403 | PASS | Executed against running backend | 2026-08-12 02:06:06 |
| SECURITY_REGRESSION | Inactive/nonexistent account token | Authenticated API | 401 | 401 | PASS | Executed against running backend | 2026-08-12 02:06:06 |
| SECURITY_REGRESSION | Expired session | Authenticated API | 401 | 401 | PASS | Executed against running backend | 2026-08-12 02:06:06 |
| SECURITY_REGRESSION | Cross-warehouse GRN IDOR | Authenticated API | Test fixture | No other-warehouse GRN | NOT TESTED | Executed against running backend | 2026-08-12 02:06:06 |
| SECURITY_REGRESSION | Unsupported attachment type | Authenticated API | 400 | 400 | PASS | Executed against running backend | 2026-08-12 02:06:06 |

