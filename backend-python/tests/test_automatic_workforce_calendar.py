import shutil
import sqlite3
import json
from datetime import date, timedelta

from fastapi.testclient import TestClient

from app import database
from app.main import app
from app.security import sign_token


def test_active_employee_is_scheduled_automatically_and_unavailability_updates_calendar(tmp_path, monkeypatch):
    test_database = tmp_path / "automatic-calendar.db"
    shutil.copy2(database.DB_PATH, test_database)
    monkeypatch.setattr(database, "DB_PATH", test_database)
    with sqlite3.connect(test_database) as connection:
        user_id = connection.execute("""SELECT u.id FROM users u JOIN employees e ON e.id=u.employee_id
            WHERE u.role='SupplyChainManager' AND u.is_active=1 AND u.deleted_at IS NULL
            AND e.status='Active' AND e.system_access_yn=1 LIMIT 1""").fetchone()[0]
        department_id = connection.execute("INSERT INTO departments(name) VALUES('Calendar Integration Department')").lastrowid
        employee_id = connection.execute("""INSERT INTO employees(employee_code,name,department_id,position,status,approval_role,system_access_yn)
            VALUES('TEST-CALENDAR-EMP','Automatic Calendar Employee',?,'Operator','Active','Helper',0)""", (department_id,)).lastrowid
        if not connection.execute("SELECT id FROM shifts WHERE active_yn=1 LIMIT 1").fetchone():
            connection.execute("INSERT INTO shifts(shift_code,shift_label,start_time,end_time) VALUES('TEST-SHIFT','Test Shift','08:00','16:00')")

    token = sign_token({"id": user_id})
    headers = {"Authorization": f"Bearer {token}"}
    client = TestClient(app)
    candidate=date.today()+timedelta(days=40)
    with sqlite3.connect(test_database)as connection:
        operating_days=set(json.loads(connection.execute("SELECT value FROM settings WHERE key='procurement_operating_days'").fetchone()[0]))
        holiday_dates={row[0]for row in connection.execute("SELECT COALESCE(observed_date,holiday_date) FROM holidays WHERE active_yn=1").fetchall()}
    while candidate.weekday()not in operating_days or candidate.isoformat()in holiday_dates:candidate+=timedelta(days=1)
    work_date = candidate.isoformat()

    generated = client.get(
        "/api/workforce/calendar",
        params={"from": work_date, "to": work_date, "scope": "Calendar Integration Department"},
        headers=headers,
    )
    assert generated.status_code == 200
    row = next(item for item in generated.json()["rows"] if item["employee_id"] == employee_id)
    assert row["day_type"] == "WORKDAY"
    assert row["availability_status"] == "Available"
    assert row["assignment_source"] == "AUTO"
    assert row["status"] == "PUBLISHED"

    exception = client.post(
        "/api/workforce/availability",
        json={"employee_id": employee_id, "date_from": work_date, "date_to": work_date,
              "availability_status": "Sick", "reason": "Medical leave"},
        headers=headers,
    )
    assert exception.status_code == 201
    assert exception.json()["calendar_update"]["updated"] == 1

    updated = client.get(
        "/api/workforce/calendar",
        params={"from": work_date, "to": work_date, "scope": "Calendar Integration Department"},
        headers=headers,
    )
    row = next(item for item in updated.json()["rows"] if item["employee_id"] == employee_id)
    assert row["day_type"] == "OFF"
    assert row["availability_status"] == "Sick"
    assert row["shift_id"] is None
    assert "Medical leave" in row["remarks"]

    with sqlite3.connect(test_database) as connection:
        availability = connection.execute(
            "SELECT availability_status,reason FROM employee_availability WHERE employee_id=?", (employee_id,)
        ).fetchone()
        calendar = connection.execute(
            "SELECT day_type,shift_id,status,assignment_source FROM employee_work_calendar WHERE employee_id=? AND calendar_date=?",
            (employee_id, work_date),
        ).fetchone()
    assert availability == ("Sick", "Medical leave")
    assert calendar == ("OFF", None, "PUBLISHED", "AUTO")
