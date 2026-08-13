# Full Security Regression

| Group | Test | Status | Evidence |
|---|---|---|---|
| Authentication | Valid login | PASS | {"token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTUsInVzZXJuYW1lIjoidDMyZFZhbGlkMTc4NjU3NzcxOTc3NSIsInJvbGUiOiJQdXJjaGFzZU1hbmFnZXIiLCJmdWxsX25hbWUiOiJQaGFzZTMyRCBWYWxpZCIsI |
| Authentication | Invalid password | PASS | {"error":"Invalid username or password"} |
| Authentication | Invalid token | PASS | {"error":"Invalid or expired token"} |
| Authentication | Expired token | PASS | {"error":"Invalid or expired token"} |
| Authentication | Malformed token | PASS | {"error":"Invalid or expired token"} |
| Authentication | Inactive user | PASS | {"error":"Account is inactive or no longer available"} |
| Authentication | Disabled employee | PASS | {"error":"This employee has no ProcuraFlow system access"} |
| Authentication | Nonexistent user token | PASS | {"error":"Account is inactive or no longer available"} |
| Authentication | Nonexistent login | PASS | {"error":"Invalid username or password"} |
| Authentication | Password expiry | PASS | {"error":"Password expired. Contact the Supply Chain Manager to restore access."} |
| Finance Exclusion | Finance Dashboard denied | PASS | {"error":"This employee has no ProcuraFlow system access"} |
| Finance Exclusion | Finance PR denied | PASS | {"error":"This employee has no ProcuraFlow system access"} |
| Finance Exclusion | Finance PO denied | PASS | {"error":"This employee has no ProcuraFlow system access"} |
| Finance Exclusion | Finance GRN denied | PASS | {"error":"This employee has no ProcuraFlow system access"} |
| Finance Exclusion | Finance Invoice denied | PASS | {"error":"This employee has no ProcuraFlow system access"} |
| Finance Exclusion | Finance Inventory denied | PASS | {"error":"This employee has no ProcuraFlow system access"} |
| Finance Exclusion | Finance Reports denied | PASS | {"error":"This employee has no ProcuraFlow system access"} |
| Finance Exclusion | Finance Attachments denied | PASS | {"error":"This employee has no ProcuraFlow system access"} |
| Finance Exclusion | Finance Audit denied | PASS | {"error":"This employee has no ProcuraFlow system access"} |
| Finance Exclusion | Finance Admin denied | PASS | {"error":"This employee has no ProcuraFlow system access"} |
| Direct Object | Cross-warehouse GRN direct ID | PASS | {"error":"GRN not found"} |
| Direct Object | Cross-warehouse attachment list | PASS | {"error":"Document not found"} |
| Direct Object | Unauthorized employee object | PASS | {"error":"This employee account is not assigned permission 'task.employees'"} |
| Direct Object | Unauthorized delegation object | PASS | {"error":"Role 'Storekeeper' is not permitted to perform this action"} |
| Privilege Escalation | Change own role | PASS | {"error":"This employee account is not assigned permission 'task.employees'"} |
| Privilege Escalation | Increase own PO limit | PASS | {"error":"This employee account is not assigned permission 'task.employees'"} |
| Privilege Escalation | Add own permission | PASS | {"error":"This employee account is not assigned permission 'task.employees'"} |
| Privilege Escalation | Create self delegation | PASS | {"error":"Role 'Storekeeper' is not permitted to perform this action"} |
| Attachments | Authorized attachment upload | PASS | {"id":6,"original_name":"evidence.pdf","url":"/uploads/documents/b37d774cd3db9936c1548e86caabca9c"} |
| Attachments | MIME mismatch denied | PASS | {"error":"File content does not match the declared PDF, JPG, or PNG type"} |
| Attachments | Unsupported extension/type denied | PASS | {"error":"A PDF, JPG, or PNG file is required (maximum 15 MB)"} |
| Attachments | Unsafe filename handled | PASS | {"id":7,"original_name":"unsafe.pdf","url":"/uploads/documents/fd57a55f69a7effc1e2c26707f6f3486"} |
| Attachments | Authorized direct attachment | PASS | %PDF-1.4 %%EOF |
| Attachments | Path traversal document type denied | PASS | {"error":"Invalid document type"} |
| Attachments | Unauthorized replacement absent | PASS | <!DOCTYPE html> <html lang="en"> <head> <meta charset="utf-8"> <title>Error</title> </head> <body> <pre>Cannot PUT /api/attachments/file/6</pre> </body> </html>  |
| Attachments | Unauthorized delete absent | PASS | <!DOCTYPE html> <html lang="en"> <head> <meta charset="utf-8"> <title>Error</title> </head> <body> <pre>Cannot DELETE /api/attachments/file/6</pre> </body> </html>  |
| Export Sanitization | Sanitize =SUM(1,1) | PASS | '=SUM(1,1) |
| Export Sanitization | Sanitize +CMD | PASS | '+CMD |
| Export Sanitization | Sanitize -1+2 | PASS | '-1+2 |
| Export Sanitization | Sanitize @evil | PASS | '@evil |
| Export Sanitization | Sanitize <script>alert(1)</ | PASS | &lt;script&gt;alert(1)&lt;/script&gt; |
| Export Sanitization | Sanitize A&B "quoted" | PASS | A&amp;B &quot;quoted&quot; |
| Export Authorization | Unauthorized report API | PASS | {"error":"This employee account is not assigned permission 'report.procurement'"} |
| Export Authorization | Warehouse report tampering scoped | PASS | [{"item_code":"ITM-001","description":"Safety Gloves","warehouse_name":"Main Warehouse","quantity":1635},{"item_code":"ITM-001","description":"Safety Gloves","warehouse_name":"Main |
| Export Authorization | Direct nonexistent export endpoint | PASS | <!DOCTYPE html> <html lang="en"> <head> <meta charset="utf-8"> <title>Error</title> </head> <body> <pre>Cannot GET /api/reports/export/po-register</pre> </body> </html>  |
| Delegation Fresh Regression | Finance authenticated API denied | PASS | This employee has no ProcuraFlow system access |
| Delegation Fresh Regression | Storekeeper delegated handoff denied | PASS | This employee account is not assigned permission 'task.invoices' |
| Delegation Fresh Regression | Client authority manipulation denied | PASS | A current, unrevoked Finance External Handoff delegation is required |
| Delegation Fresh Regression | Self delegation denied | PASS | Self-delegation is not permitted |
| Delegation Fresh Regression | Finance delegation denied | PASS | Finance employees cannot receive ProcuraFlow delegated authority |
| Delegation Fresh Regression | Storekeeper delegation denied | PASS | Delegate role is not eligible for Finance External Handoff authority |
| Delegation Fresh Regression | Re-delegation denied | PASS | Role 'PurchaseManager' is not permitted to perform this action |
| Delegation Fresh Regression | Future delegation created | PASS | success |
| Delegation Fresh Regression | Before-start handoff denied | PASS | A current, unrevoked Finance External Handoff delegation is required |
| Delegation Fresh Regression | Expired-period delegation created | PASS | success |
| Delegation Fresh Regression | After-expiry handoff denied | PASS | A current, unrevoked Finance External Handoff delegation is required |
| Delegation Fresh Regression | Wrong-scope delegation created | PASS | success |
| Delegation Fresh Regression | Wrong-scope handoff denied | PASS | A current, unrevoked Finance External Handoff delegation is required |
| Delegation Fresh Regression | Wrong-scope delegation revoked | PASS | REVOKED |
| Delegation Fresh Regression | Revocable delegation created | PASS | success |
| Delegation Fresh Regression | Delegation revoked immediately | PASS | REVOKED |
| Delegation Fresh Regression | Revoked handoff denied | PASS | A current, unrevoked Finance External Handoff delegation is required |
| Delegation Fresh Regression | Valid delegation created | PASS | success |
| Delegation Fresh Regression | Valid delegated handoff | PASS | Ready for Finance - External Process |
| Delegation Fresh Regression | Delegated action identifies actual employee and authority | PASS | role=PurchaseManager; delegation=5; employee=15 |
