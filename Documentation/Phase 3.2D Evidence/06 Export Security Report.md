# Export Security

| Group | Test | Status | Evidence |
|---|---|---|---|
| Export Sanitization | Sanitize =SUM(1,1) | PASS | '=SUM(1,1) |
| Export Sanitization | Sanitize +CMD | PASS | '+CMD |
| Export Sanitization | Sanitize -1+2 | PASS | '-1+2 |
| Export Sanitization | Sanitize @evil | PASS | '@evil |
| Export Sanitization | Sanitize <script>alert(1)</ | PASS | &lt;script&gt;alert(1)&lt;/script&gt; |
| Export Sanitization | Sanitize A&B "quoted" | PASS | A&amp;B &quot;quoted&quot; |
| Export Authorization | Unauthorized report API | PASS | {"error":"This employee account is not assigned permission 'report.procurement'"} |
| Export Authorization | Warehouse report tampering scoped | PASS | [{"item_code":"ITM-001","description":"Safety Gloves","warehouse_name":"Main Warehouse","quantity":1635},{"item_code":"ITM-001","description":"Safety Gloves","warehouse_name":"Main |
| Export Authorization | Direct nonexistent export endpoint | PASS | <!DOCTYPE html> <html lang="en"> <head> <meta charset="utf-8"> <title>Error</title> </head> <body> <pre>Cannot GET /api/reports/export/po-register</pre> </body> </html>  |
