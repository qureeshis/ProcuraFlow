import shutil
import sqlite3

from fastapi.testclient import TestClient

from app import database
from app.main import app
from app.security import sign_token


def test_accounting_period_validation_and_audit(tmp_path, monkeypatch):
    path = tmp_path / "controls.db"
    shutil.copy2(database.DB_PATH, path)
    monkeypatch.setattr(database, "DB_PATH", path)
    with sqlite3.connect(path) as connection:
        manager = connection.execute(
            "SELECT id FROM users WHERE role='SupplyChainManager' AND is_active=1 AND deleted_at IS NULL LIMIT 1"
        ).fetchone()[0]
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {sign_token({'id': manager})}"}

    invalid = client.post(
        "/api/controls/accounting-periods",
        headers=headers,
        json={"fiscal_year": 2098, "period_number": 1, "start_date": "2098-02-01", "end_date": "2098-01-01"},
    )
    assert invalid.status_code == 400

    created = client.post(
        "/api/controls/accounting-periods",
        headers=headers,
        json={"fiscal_year": 2098, "period_number": 1, "start_date": "2098-01-01", "end_date": "2098-01-31"},
    )
    assert created.status_code == 201, created.text
    period_id = created.json()["id"]
    assert client.put(
        f"/api/controls/accounting-periods/{period_id}/status",
        headers=headers,
        json={"status": "CLOSED"},
    ).status_code == 400
    closed = client.put(
        f"/api/controls/accounting-periods/{period_id}/status",
        headers=headers,
        json={"status": "CLOSED", "reason": "Month-end close", "approval_reference": "APP-2098-01"},
    )
    assert closed.status_code == 200, closed.text
    with sqlite3.connect(path) as connection:
        status = connection.execute("SELECT status FROM accounting_periods WHERE id=?", (period_id,)).fetchone()[0]
        audits = connection.execute(
            "SELECT COUNT(*) FROM audit_log WHERE table_name='accounting_periods' AND record_id=?",
            (period_id,),
        ).fetchone()[0]
    assert status == "CLOSED"
    assert audits == 2


def test_authorization_limits_reject_invalid_subjects(tmp_path, monkeypatch):
    path = tmp_path / "limits.db"
    shutil.copy2(database.DB_PATH, path)
    monkeypatch.setattr(database, "DB_PATH", path)
    with sqlite3.connect(path) as connection:
        manager = connection.execute(
            "SELECT id FROM users WHERE role='SupplyChainManager' AND is_active=1 AND deleted_at IS NULL LIMIT 1"
        ).fetchone()[0]
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {sign_token({'id': manager})}"}
    assert client.post(
        "/api/controls/authorization-limits/po",
        headers=headers,
        json={"employee_id": 999999999, "approval_limit": 1000},
    ).status_code == 400
    assert client.post(
        "/api/controls/authorization-limits/material-issue",
        headers=headers,
        json={"employee_id": 999999999, "warehouse_id": 999999999, "value_limit": 1000, "quantity_limit": 10},
    ).status_code == 400

