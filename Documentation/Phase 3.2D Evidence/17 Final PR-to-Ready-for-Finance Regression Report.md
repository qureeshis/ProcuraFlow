# PR to Ready for Finance

| Group | Test | Status | Evidence |
|---|---|---|---|
| Regression | PR created | PASS | success |
| Regression | PR approved | PASS | Submitted |
| Regression | RFQ created | PASS | success |
| Regression | Quotation A | PASS | success |
| Regression | Quotation B | PASS | success |
| Regression | Quotation comparison | PASS | success |
| Regression | Vendor selected | PASS | success |
| Regression | PO created | PASS | PendingApproval |
| Regression | PO approved independently | PASS | success |
| Regression | GRN 1 quantity 40 | PASS | Posted |
| Regression | GRN 2 quantity 35 | PASS | Posted |
| Regression | GRN 3 quantity 25 | PASS | Posted |
| Regression | Receipt after full quantity denied | PASS | GRN can only be created against an approved PO |
| Regression | Partial GRN 40/35/25 state | PASS | PO=Closed; stock=100; FIFO=100; ledger=100 |
| Regression | Supplier invoice exact match | PASS | Matched |
| Regression | Duplicate invoice denied | PASS | Duplicate supplier invoice number |
| Regression | Three-way match transaction | PASS | Matched |
| Regression | Finance package complete | PASS | success |
| Regression | SCM external handoff | PASS | Ready for Finance - External Process |
| Regression | Immutable handoff and audit evidence | PASS | handoff=true; audit=1 |
