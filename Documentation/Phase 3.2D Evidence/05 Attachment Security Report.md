# Attachment Security

| Group | Test | Status | Evidence |
|---|---|---|---|
| Attachments | Authorized attachment upload | PASS | {"id":6,"original_name":"evidence.pdf","url":"/uploads/documents/b37d774cd3db9936c1548e86caabca9c"} |
| Attachments | MIME mismatch denied | PASS | {"error":"File content does not match the declared PDF, JPG, or PNG type"} |
| Attachments | Unsupported extension/type denied | PASS | {"error":"A PDF, JPG, or PNG file is required (maximum 15 MB)"} |
| Attachments | Unsafe filename handled | PASS | {"id":7,"original_name":"unsafe.pdf","url":"/uploads/documents/fd57a55f69a7effc1e2c26707f6f3486"} |
| Attachments | Authorized direct attachment | PASS | %PDF-1.4 %%EOF |
| Attachments | Path traversal document type denied | PASS | {"error":"Invalid document type"} |
| Attachments | Unauthorized replacement absent | PASS | <!DOCTYPE html> <html lang="en"> <head> <meta charset="utf-8"> <title>Error</title> </head> <body> <pre>Cannot PUT /api/attachments/file/6</pre> </body> </html>  |
| Attachments | Unauthorized delete absent | PASS | <!DOCTYPE html> <html lang="en"> <head> <meta charset="utf-8"> <title>Error</title> </head> <body> <pre>Cannot DELETE /api/attachments/file/6</pre> </body> </html>  |
