# Updated SoD Review

Granular effective actions are evaluated; PO view + GRN post and issue post + adjustment create are not automatically High.

| conflict_key | permission_a | permission_b | conflict_description | risk | management_decision | status | approved_by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| USER-7:task.po:task.grn | task.po | task.grn | PO + receipt | High unauthorized concentration risk |  | REQUIRES MANAGEMENT REVIEW |  |
| USER-7:task.material_issue:task.adjustments | task.material_issue | task.adjustments | Issue + adjustment | High unauthorized concentration risk |  | REQUIRES MANAGEMENT REVIEW |  |
| USER-8:task.suppliers:task.po | task.suppliers | task.po | Vendor + PO + PO approval | Management concentration - review |  | REQUIRES MANAGEMENT REVIEW |  |
| USER-8:task.po:task.grn | task.po | task.grn | PO + receipt | Management concentration - review |  | REQUIRES MANAGEMENT REVIEW |  |
| USER-8:task.grn:task.invoices | task.grn | task.invoices | Receipt + invoice verification | Management concentration - review |  | REQUIRES MANAGEMENT REVIEW |  |
| USER-8:task.material_issue:task.adjustments | task.material_issue | task.adjustments | Issue + adjustment | Management concentration - review |  | REQUIRES MANAGEMENT REVIEW |  |
| USER-9:task.po:task.grn | task.po | task.grn | PO + receipt | High unauthorized concentration risk |  | REQUIRES MANAGEMENT REVIEW |  |
| USER-10:task.suppliers:task.po | task.suppliers | task.po | Vendor + PO + PO approval | High unauthorized concentration risk |  | REQUIRES MANAGEMENT REVIEW |  |
| USER-12:task.suppliers:task.po | task.suppliers | task.po | Vendor + PO + PO approval | High unauthorized concentration risk |  | REQUIRES MANAGEMENT REVIEW |  |
| USER-13:task.po:task.grn | task.po | task.grn | PO + receipt | High unauthorized concentration risk |  | REQUIRES MANAGEMENT REVIEW |  |
| USER-14:task.po:task.grn | task.po | task.grn | PO + receipt | High unauthorized concentration risk |  | REQUIRES MANAGEMENT REVIEW |  |