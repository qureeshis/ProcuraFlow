# Segregation of Duties Review

Audit evidence date: 11 August 2026

Non-management conflicts requiring review: **7**. No permission was removed without a management decision.

| id | employee_code | employee_name | role | warehouse_name | permission_a | permission_b | conflict_description | risk | business_justification | recommended_action | management_decision | compensating_control | review_date | expiry_date | status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 9 | EMP-0006 | Muzamil Khan | PurchaseManager |  | task.suppliers | task.po | Vendor + PO + PO approval | High unauthorized concentration risk |  | Confirm documented authorization and compensating independent review |  |  |  |  | REQUIRES MANAGEMENT REVIEW |
| 8 | EMP_003 | Haider Ali | PurchaseOfficer |  | task.suppliers | task.po | Vendor + PO + PO approval | High unauthorized concentration risk |  | Confirm documented authorization and compensating independent review |  |  |  |  | REQUIRES MANAGEMENT REVIEW |
| 11 | EMP-0008 | David Jhonson | Storekeeper | Main Warehouse | task.po | task.grn | PO + receipt | High unauthorized concentration risk |  | Confirm documented authorization and compensating independent review |  |  |  |  | REQUIRES MANAGEMENT REVIEW |
| 7 | EMP_002 | Musa Ali | Storekeeper | Main Warehouse | task.po | task.grn | PO + receipt | High unauthorized concentration risk |  | Confirm documented authorization and compensating independent review |  |  |  |  | REQUIRES MANAGEMENT REVIEW |
| 3 | EMP_001 | Ali Qureshi | SupplyChainManager |  | task.suppliers | task.po | Vendor + PO + PO approval | Management concentration - review |  | Confirm documented authorization and compensating independent review |  |  |  |  | REQUIRES MANAGEMENT REVIEW |
| 4 | EMP_001 | Ali Qureshi | SupplyChainManager |  | task.po | task.grn | PO + receipt | Management concentration - review |  | Confirm documented authorization and compensating independent review |  |  |  |  | REQUIRES MANAGEMENT REVIEW |
| 5 | EMP_001 | Ali Qureshi | SupplyChainManager |  | task.grn | task.invoices | Receipt + invoice verification | Management concentration - review |  | Confirm documented authorization and compensating independent review |  |  |  |  | REQUIRES MANAGEMENT REVIEW |
| 6 | EMP_001 | Ali Qureshi | SupplyChainManager |  | task.material_issue | task.adjustments | Issue + adjustment | Management concentration - review |  | Confirm documented authorization and compensating independent review |  |  |  |  | REQUIRES MANAGEMENT REVIEW |
| 10 | EMP-0007 | Hassam Ahmed | WarehouseManager |  | task.po | task.grn | PO + receipt | High unauthorized concentration risk |  | Confirm documented authorization and compensating independent review |  |  |  |  | REQUIRES MANAGEMENT REVIEW |
| 1 | EMP-0004 | Hamza Khan | WarehouseSupervisor | Main Warehouse | task.po | task.grn | PO + receipt | High unauthorized concentration risk |  | Confirm documented authorization and compensating independent review |  |  |  |  | REQUIRES MANAGEMENT REVIEW |
| 2 | EMP-0004 | Hamza Khan | WarehouseSupervisor | Main Warehouse | task.material_issue | task.adjustments | Issue + adjustment | High unauthorized concentration risk |  | Confirm documented authorization and compensating independent review |  |  |  |  | REQUIRES MANAGEMENT REVIEW |

