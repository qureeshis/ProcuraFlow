# Financial Calculation & Rounding Standard

1. Source quantities and values retain database precision.
2. Transaction and report currency is displayed to the configured currency decimal places (default 2).
3. Comparison tolerance is **absolute difference ≤ 0.01 in transaction currency**.
4. Totals are aggregated before display rounding.
5. Expected, actual, difference, tolerance, and result are retained in test evidence.
6. Floating-point values are normalized at controlled report/payment boundaries; equality is never based on formatted text.