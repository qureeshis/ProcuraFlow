import shutil
import sqlite3
from datetime import date, timedelta

from fastapi.testclient import TestClient

from app import database
from app.routes import workforce
from app.main import app
from app.security import sign_token


def test_calendar_tabs_ranges_publish_supervisor_and_settings_stay_in_sync(tmp_path, monkeypatch):
    test_database = tmp_path / "calendar-management.db"
    shutil.copy2(database.DB_PATH, test_database)
    monkeypatch.setattr(database, "DB_PATH", test_database)

    with sqlite3.connect(test_database) as connection:
        connection.row_factory = sqlite3.Row
        manager = connection.execute(
            """SELECT u.id,e.id employee_id FROM users u JOIN employees e ON e.id=u.employee_id
               WHERE u.role='SupplyChainManager' AND u.is_active=1 AND u.deleted_at IS NULL LIMIT 1"""
        ).fetchone()
        warehouse_employee = connection.execute(
            """SELECT e.id FROM employees e JOIN departments d ON d.id=e.department_id
               WHERE lower(d.name)='warehouse' AND e.status='Active' AND e.deleted_at IS NULL
               ORDER BY e.id LIMIT 1"""
        ).fetchone()
        connection.execute(
            "UPDATE employees SET reports_to_employee_id=? WHERE id=?",
            (manager["employee_id"], warehouse_employee["id"]),
        )

    client = TestClient(app)
    headers = {"Authorization": f"Bearer {sign_token({'id': manager['id']})}"}
    current = client.get("/api/workforce/calendar", params={"scope": "Warehouse", "period": "current"}, headers=headers)
    following = client.get("/api/workforce/calendar", params={"scope": "Warehouse", "period": "next"}, headers=headers)
    assert current.status_code == following.status_code == 200
    today = date.today()
    assert current.json()["range"] == {"from": today.isoformat(), "to": (today + timedelta(days=14)).isoformat()}
    assert following.json()["range"] == {"from": (today + timedelta(days=15)).isoformat(), "to": (today + timedelta(days=29)).isoformat()}
    assert current.json()["range"]["to"] < following.json()["range"]["from"]
    employee_row = next(row for row in current.json()["rows"] if row["employee_id"] == warehouse_employee["id"])
    assert employee_row["reports_to_name"]
    assert employee_row["reports_to_role"] == "SupplyChainManager"

    status = client.put(
        "/api/workforce/calendar/bulk-status",
        json={**current.json()["range"], "status": "PROVISIONAL", "scope": "Warehouse", "warehouse_id": None},
        headers=headers,
    )
    assert status.status_code == 200, status.text
    assert status.json()["updated"] > 0
    with sqlite3.connect(test_database) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM employee_work_calendar WHERE calendar_date BETWEEN ? AND ? AND status='PROVISIONAL'",
            (current.json()["range"]["from"], current.json()["range"]["to"]),
        ).fetchone()[0] > 0

    saved_roles = ["WarehouseSupervisor", "WarehouseManager"]
    saved = client.put("/api/workforce/helper-supervisor-roles", json={"roles": saved_roles}, headers=headers)
    assert saved.status_code == 200
    reference = client.get("/api/workforce/reference", headers=headers)
    assert reference.status_code == 200
    assert reference.json()["helper_supervisor_roles"] == saved_roles

    class HolidayProviderResponse:
        status_code=200
        def raise_for_status(self):return None
        def json(self):return {"meta":{"code":200},"response":{"holidays":[{"name":"Independence Day","description":"National holiday","date":{"iso":f"{today.year}-07-04"},"type":["National holiday"]}]}}
    monkeypatch.setenv("CALENDARIFIC_API_KEY","test-calendarific-key")
    monkeypatch.setattr(workforce.httpx,"get",lambda *args,**kwargs:HolidayProviderResponse())

    holiday_sync = client.post(
        "/api/workforce/holidays/synchronize",
        json={"country_code": "US", "year": today.year},
        headers=headers,
    )
    assert holiday_sync.status_code == 200
    assert holiday_sync.json()["preview"] is True
    holiday_confirm = client.post(
        "/api/workforce/holidays/synchronize",
        json={"country_code": "US", "year": today.year, "confirm": True, "expected_fingerprint": holiday_sync.json()["fingerprint"]},
        headers=headers,
    )
    assert holiday_confirm.status_code == 200
    assert holiday_confirm.json()["created"] in (0,1)
    assert "confirmed" in holiday_confirm.json()["message"].lower()

    class EmptyCalendarificResponse:
        status_code=200
        def raise_for_status(self):return None
        def json(self):return {"meta":{"code":200},"response":{"holidays":[]}}
    class NagerFallbackResponse:
        status_code=200
        def raise_for_status(self):return None
        def json(self):return [{"date":f"{today.year}-11-11","localName":"Veterans Day","name":"Veterans Day","types":["Public"]}]
    monkeypatch.setattr(workforce.httpx,"get",lambda url,*args,**kwargs:NagerFallbackResponse()if "nager" in url.lower()else EmptyCalendarificResponse())
    fallback_sync=client.post("/api/workforce/holidays/synchronize",json={"country_code":"US","year":today.year},headers=headers)
    assert fallback_sync.status_code==200,fallback_sync.text
    assert fallback_sync.json()["fallback_used"] is True
    assert fallback_sync.json()["provider"]=="Nager.Date Public Holidays API"
