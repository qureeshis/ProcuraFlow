# Updated Report Accuracy Verification

6/6 PASS at ≤0.01 tolerance.

| test_suite | test_name | expected_result | actual_result | status | evidence | executed_at |
| --- | --- | --- | --- | --- | --- | --- |
| REPORT_ACCURACY_PHASE3 | Bin Stock | 846315 | 846315 | PASS | {"name":"Bin Stock","endpoint":"bin-stock","http_status":200,"source_result":846315,"api_result":846315,"ui_result":846315,"export_result":846315,"difference":0,"allowed_tolerance":0.01,"status":"PASS"} | 2026-08-12 21:46:09 |
| REPORT_ACCURACY_PHASE3 | Invoice Register | 715 | 715 | PASS | {"name":"Invoice Register","endpoint":"invoice-register","http_status":200,"source_result":715,"api_result":715,"ui_result":715,"export_result":715,"difference":0,"allowed_tolerance":0.01,"status":"PASS"} | 2026-08-12 21:46:09 |
| REPORT_ACCURACY_PHASE3 | PO vs GRN | 3455 | 3455 | PASS | {"name":"PO vs GRN","endpoint":"po-vs-grn","http_status":200,"source_result":3455,"api_result":3455,"ui_result":3455,"export_result":3455,"difference":0,"allowed_tolerance":0.01,"status":"PASS"} | 2026-08-12 21:46:09 |
| REPORT_ACCURACY_PHASE3 | PO vs Invoice | 316990.99 | 316990.99 | PASS | {"name":"PO vs Invoice","endpoint":"po-vs-invoice","http_status":200,"source_result":316990.99,"api_result":316990.99,"ui_result":316990.99,"export_result":316990.99,"difference":0,"allowed_tolerance":0.01,"status":"PASS"} | 2026-08-12 21:46:09 |
| REPORT_ACCURACY_PHASE3 | GRN vs Invoice | 51170.82 | 51170.82 | PASS | {"name":"GRN vs Invoice","endpoint":"grn-vs-invoice","http_status":200,"source_result":51170.82,"api_result":51170.82,"ui_result":51170.82,"export_result":51170.82,"difference":0,"allowed_tolerance":0.01,"status":"PASS"} | 2026-08-12 21:46:09 |
| REPORT_ACCURACY_PHASE3 | Three-Way Match | 715 | 715 | PASS | {"name":"Three-Way Match","endpoint":"three-way-match","http_status":200,"source_result":715,"api_result":715,"ui_result":715,"export_result":715,"difference":0,"allowed_tolerance":0.01,"status":"PASS"} | 2026-08-12 21:46:09 |