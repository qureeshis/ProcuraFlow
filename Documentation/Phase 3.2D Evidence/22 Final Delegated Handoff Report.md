# Delegated Handoff

| Group | Test | Status | Evidence |
|---|---|---|---|
| Regression | Finance authenticated API denied | PASS | This employee has no ProcuraFlow system access |
| Regression | Storekeeper delegated handoff denied | PASS | This employee account is not assigned permission 'task.invoices' |
| Regression | Client authority manipulation denied | PASS | A current, unrevoked Finance External Handoff delegation is required |
| Regression | Self delegation denied | PASS | Self-delegation is not permitted |
| Regression | Finance delegation denied | PASS | Finance employees cannot receive ProcuraFlow delegated authority |
| Regression | Storekeeper delegation denied | PASS | Delegate role is not eligible for Finance External Handoff authority |
| Regression | Re-delegation denied | PASS | Role 'PurchaseManager' is not permitted to perform this action |
| Regression | Future delegation created | PASS | success |
| Regression | Before-start handoff denied | PASS | A current, unrevoked Finance External Handoff delegation is required |
| Regression | Expired-period delegation created | PASS | success |
| Regression | After-expiry handoff denied | PASS | A current, unrevoked Finance External Handoff delegation is required |
| Regression | Wrong-scope delegation created | PASS | success |
| Regression | Wrong-scope handoff denied | PASS | A current, unrevoked Finance External Handoff delegation is required |
| Regression | Wrong-scope delegation revoked | PASS | REVOKED |
| Regression | Revocable delegation created | PASS | success |
| Regression | Delegation revoked immediately | PASS | REVOKED |
| Regression | Revoked handoff denied | PASS | A current, unrevoked Finance External Handoff delegation is required |
| Regression | Valid delegation created | PASS | success |
| Regression | Valid delegated handoff | PASS | Ready for Finance - External Process |
| Regression | Delegated action identifies actual employee and authority | PASS | role=PurchaseManager; delegation=5; employee=15 |
