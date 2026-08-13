# Delegation Security

| Test | Status | Actual |
|---|---|---|
| Finance authenticated API denied | PASS | This employee has no ProcuraFlow system access |
| Storekeeper delegated handoff denied | PASS | This employee account is not assigned permission 'task.invoices' |
| Client authority manipulation denied | PASS | A current, unrevoked Finance External Handoff delegation is required |
| Self delegation denied | PASS | Self-delegation is not permitted |
| Finance delegation denied | PASS | Finance employees cannot receive ProcuraFlow delegated authority |
| Storekeeper delegation denied | PASS | Delegate role is not eligible for Finance External Handoff authority |
| Re-delegation denied | PASS | Role 'PurchaseManager' is not permitted to perform this action |
| Future delegation created | PASS | success |
| Before-start handoff denied | PASS | A current, unrevoked Finance External Handoff delegation is required |
| Expired-period delegation created | PASS | success |
| After-expiry handoff denied | PASS | A current, unrevoked Finance External Handoff delegation is required |
| Wrong-scope delegation created | PASS | success |
| Wrong-scope handoff denied | PASS | A current, unrevoked Finance External Handoff delegation is required |
| Wrong-scope delegation revoked | PASS | REVOKED |
| Revocable delegation created | PASS | success |
| Delegation revoked immediately | PASS | REVOKED |
| Revoked handoff denied | PASS | A current, unrevoked Finance External Handoff delegation is required |
| Valid delegation created | PASS | success |
| Valid delegated handoff | PASS | Ready for Finance - External Process |
| Delegated action identifies actual employee and authority | PASS | role=PurchaseManager; delegation=5; employee=15 |
