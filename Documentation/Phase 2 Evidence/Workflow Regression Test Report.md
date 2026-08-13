# Workflow Regression Test Report

Audit evidence date: 11 August 2026

Full PR-to-Finance mutation workflow is not complete; only isolated post-test database integrity is evidenced.

| test_suite | test_name | report_api | expected_result | actual_result | status | evidence | executed_at |
|---|---|---|---|---|---|---|---|
| WORKFLOW_REGRESSION | Isolated database integrity | SQLite | ok / 0 FK | ok / 0 | PASS | Post-test isolated DB validation | 2026-08-12 02:05:09 |

