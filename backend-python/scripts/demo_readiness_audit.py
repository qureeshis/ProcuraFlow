"""Read-only database and report readiness checks for the active installation."""
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.database import DB_PATH  # noqa: E402


def main():
    failures = []
    connection = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row

    integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
    print(f"database_integrity={integrity}")
    if integrity != "ok": failures.append(f"integrity: {integrity}")

    foreign_keys = connection.execute("PRAGMA foreign_key_check").fetchall()
    print(f"foreign_key_violations={len(foreign_keys)}")
    if foreign_keys: failures.append(f"foreign keys: {len(foreign_keys)}")

    required_columns = {
        "purchase_requisitions": "business_requestor_employee_id",
        "grns": "received_for_employee_id",
        "users": "password_hash",
        "employees": "department_id",
    }
    for table, column in required_columns.items():
        columns = {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}
        passed = column in columns
        print(f"schema.{table}.{column}={'ok' if passed else 'missing'}")
        if not passed: failures.append(f"missing {table}.{column}")

    orphan_checks = {
        "pr_items": "SELECT COUNT(*) FROM pr_items x LEFT JOIN purchase_requisitions p ON p.id=x.pr_id WHERE p.id IS NULL",
        "grn_items": "SELECT COUNT(*) FROM grn_items x LEFT JOIN grns g ON g.id=x.grn_id WHERE g.id IS NULL",
        "employee_departments": "SELECT COUNT(*) FROM employees e LEFT JOIN departments d ON d.id=e.department_id WHERE e.department_id IS NOT NULL AND d.id IS NULL",
        "user_employees": "SELECT COUNT(*) FROM users u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.employee_id IS NOT NULL AND e.id IS NULL",
    }
    for name, sql in orphan_checks.items():
        count = connection.execute(sql).fetchone()[0]
        print(f"orphans.{name}={count}")
        if count: failures.append(f"orphan {name}: {count}")

    queries = json.loads((ROOT / "app" / "report_queries.json").read_text(encoding="utf-8"))
    report_failures = []
    for name, sql in queries.items():
        try:
            connection.execute(f"SELECT * FROM ({sql.rstrip(';')}) LIMIT 1").fetchone()
        except sqlite3.Error as error:
            report_failures.append(f"{name}: {error}")
    print(f"reports_checked={len(queries)}")
    print(f"report_query_failures={len(report_failures)}")
    failures.extend(report_failures)

    active_general = connection.execute("""SELECT COUNT(*) FROM employees e JOIN departments d ON d.id=e.department_id
        WHERE e.deleted_at IS NULL AND lower(trim(d.name)) NOT IN ('warehouse','procurement')""").fetchone()[0]
    active_operational = connection.execute("""SELECT COUNT(*) FROM employees e JOIN departments d ON d.id=e.department_id
        WHERE e.deleted_at IS NULL AND lower(trim(d.name)) IN ('warehouse','procurement')""").fetchone()[0]
    print(f"employees.general={active_general}")
    print(f"employees.operational={active_operational}")
    connection.close()

    if failures:
        print("AUDIT_FAILED")
        for failure in failures: print(f"- {failure}")
        return 1
    print("AUDIT_PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
