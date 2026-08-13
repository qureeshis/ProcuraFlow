# Updated Segregation of Duties Review

Confirmed operational rules are separated from high conflicts by the live SoD endpoint.

| conflict_key | user_id | permission_a | permission_b | conflict_description | risk | management_decision | status | approved_by |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| USER-7:task.po:task.grn | 7 | task.po | task.grn | PO + receipt | High unauthorized concentration risk |  | REQUIRES MANAGEMENT REVIEW |  |
| USER-7:task.material_issue:task.adjustments | 7 | task.material_issue | task.adjustments | Issue + adjustment | High unauthorized concentration risk |  | REQUIRES MANAGEMENT REVIEW |  |
| USER-8:task.suppliers:task.po | 8 | task.suppliers | task.po | Vendor + PO + PO approval | Management concentration - review |  | REQUIRES MANAGEMENT REVIEW |  |
| USER-8:task.po:task.grn | 8 | task.po | task.grn | PO + receipt | Management concentration - review |  | REQUIRES MANAGEMENT REVIEW |  |
| USER-8:task.grn:task.invoices | 8 | task.grn | task.invoices | Receipt + invoice verification | Management concentration - review |  | REQUIRES MANAGEMENT REVIEW |  |
| USER-8:task.material_issue:task.adjustments | 8 | task.material_issue | task.adjustments | Issue + adjustment | Management concentration - review |  | REQUIRES MANAGEMENT REVIEW |  |
| USER-9:task.po:task.grn | 9 | task.po | task.grn | PO + receipt | High unauthorized concentration risk |  | REQUIRES MANAGEMENT REVIEW |  |
| USER-10:task.suppliers:task.po | 10 | task.suppliers | task.po | Vendor + PO + PO approval | High unauthorized concentration risk |  | REQUIRES MANAGEMENT REVIEW |  |
| USER-12:task.suppliers:task.po | 12 | task.suppliers | task.po | Vendor + PO + PO approval | High unauthorized concentration risk |  | REQUIRES MANAGEMENT REVIEW |  |
| USER-13:task.po:task.grn | 13 | task.po | task.grn | PO + receipt | High unauthorized concentration risk |  | REQUIRES MANAGEMENT REVIEW |  |
| USER-14:task.po:task.grn | 14 | task.po | task.grn | PO + receipt | High unauthorized concentration risk |  | REQUIRES MANAGEMENT REVIEW |  |