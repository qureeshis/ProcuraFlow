import shutil
import sqlite3

from fastapi.testclient import TestClient

from app import database
from app.main import app
from app.security import sign_token


def test_active_calendar_excludes_soft_deleted_and_inactive_employees(tmp_path, monkeypatch):
    test_database = tmp_path / "calendar-active-employees.db"
    shutil.copy2(database.DB_PATH, test_database)
    monkeypatch.setattr(database, "DB_PATH", test_database)

    with sqlite3.connect(test_database) as connection:
        connection.row_factory = sqlite3.Row
        manager = connection.execute(
            """SELECT u.id,u.username,u.full_name,u.role,u.warehouse_id
               FROM users u WHERE u.deleted_at IS NULL AND u.role='SupplyChainManager'
               ORDER BY u.id LIMIT 1"""
        ).fetchone()
        stale = connection.execute(
            """SELECT c.employee_id,c.calendar_date FROM employee_work_calendar c
               JOIN employees e ON e.id=c.employee_id
               WHERE e.deleted_at IS NOT NULL OR e.status<>'Active' LIMIT 1"""
        ).fetchone()
        assert stale is not None

    token = sign_token({
        **dict(manager), "warehouse_ids": [], "permission_keys": [],
    })
    response = TestClient(app).get(
        "/api/workforce/calendar",
        params={"from": stale["calendar_date"], "to": stale["calendar_date"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200, response.text
    assert stale["employee_id"] not in {row["employee_id"] for row in response.json()["rows"]}
