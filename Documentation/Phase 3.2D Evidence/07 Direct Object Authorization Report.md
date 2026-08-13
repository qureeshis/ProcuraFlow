# Direct Object Authorization

| Group | Test | Status | Evidence |
|---|---|---|---|
| Direct Object | Cross-warehouse GRN direct ID | PASS | {"error":"GRN not found"} |
| Direct Object | Cross-warehouse attachment list | PASS | {"error":"Document not found"} |
| Direct Object | Unauthorized employee object | PASS | {"error":"This employee account is not assigned permission 'task.employees'"} |
| Direct Object | Unauthorized delegation object | PASS | {"error":"Role 'Storekeeper' is not permitted to perform this action"} |
