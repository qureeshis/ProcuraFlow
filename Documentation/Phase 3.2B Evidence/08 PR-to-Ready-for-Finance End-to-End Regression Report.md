# End-to-End Regression

| Test | Result | Actual |
|---|---|---|
| PR created | PASS | success |
| PR approved | PASS | Submitted |
| RFQ created | PASS | success |
| Quotation A | PASS | success |
| Quotation B | PASS | success |
| Quotation comparison | PASS | success |
| Vendor selected | PASS | success |
| PO created | PASS | PendingApproval |
| PO approved independently | PASS | success |
| GRN 1 quantity 40 | PASS | Posted |
| GRN 2 quantity 35 | PASS | Posted |
| GRN 3 quantity 25 | PASS | Posted |
| Receipt after full quantity denied | PASS | GRN can only be created against an approved PO |
| Partial GRN 40/35/25 state | PASS | PO=Closed; stock=100; FIFO=100; ledger=100 |
| Supplier invoice exact match | PASS | Matched |
| Duplicate invoice denied | PASS | Duplicate supplier invoice number |
| Three-way match transaction | PASS | Matched |
| Finance package complete | PASS | success |
| SCM external handoff | PASS | Ready for Finance - External Process |
| Immutable handoff and audit evidence | PASS | handoff=true; audit=1 |
