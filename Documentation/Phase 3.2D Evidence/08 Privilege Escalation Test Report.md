# Privilege Escalation

| Group | Test | Status | Evidence |
|---|---|---|---|
| Privilege Escalation | Change own role | PASS | {"error":"This employee account is not assigned permission 'task.employees'"} |
| Privilege Escalation | Increase own PO limit | PASS | {"error":"This employee account is not assigned permission 'task.employees'"} |
| Privilege Escalation | Add own permission | PASS | {"error":"This employee account is not assigned permission 'task.employees'"} |
| Privilege Escalation | Create self delegation | PASS | {"error":"Role 'Storekeeper' is not permitted to perform this action"} |
