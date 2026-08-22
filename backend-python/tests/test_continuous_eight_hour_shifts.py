import shutil
import sqlite3
from datetime import date

from fastapi.testclient import TestClient

from app import database
from app.main import app
from app.security import sign_token


def minutes(value):
    hours, minute = map(int, value.split(":")[:2])
    return hours * 60 + minute


def test_shift_start_calculates_end_without_moving_other_shifts(tmp_path, monkeypatch):
    test_database = tmp_path / "continuous-shifts.db"
    shutil.copy2(database.DB_PATH, test_database)
    monkeypatch.setattr(database, "DB_PATH", test_database)
    with sqlite3.connect(test_database) as connection:
        connection.execute("UPDATE settings SET value='1' WHERE key='procurement_shifts_enabled'")
        connection.execute("UPDATE shifts SET active_yn=1 WHERE warehouse_id IS NULL AND schedule_mode='MULTI'")
        connection.execute("UPDATE shifts SET active_yn=0 WHERE warehouse_id IS NULL AND schedule_mode='STANDARD'")
        user_id = connection.execute("""SELECT u.id FROM users u JOIN employees e ON e.id=u.employee_id
            WHERE u.role='SupplyChainManager' AND u.is_active=1 AND u.deleted_at IS NULL
            AND e.status='Active' AND e.system_access_yn=1 LIMIT 1""").fetchone()[0]
        shifts = connection.execute("SELECT id,start_time,end_time FROM shifts WHERE active_yn=1 AND warehouse_id IS NULL ORDER BY start_time,id").fetchall()
        assert len(shifts) == 3
        shift_id, shift_start, shift_end = shifts[0]
        other_before = connection.execute(
            "SELECT id,start_time,end_time FROM shifts WHERE active_yn=1 AND warehouse_id IS NULL AND id<>? ORDER BY id", (shift_id,)
        ).fetchall()

    client = TestClient(app)
    headers = {"Authorization": f"Bearer {sign_token({'id': user_id})}"}
    effective_from = date.today().isoformat()
    response = client.put(
        f"/api/workforce/shifts/{shift_id}",
        json={"shift_label": "Day Shift", "start_time": shift_start, "end_time": shift_end, "break_minutes": 30, "effective_from": effective_from},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["end_time"] == shift_end
    assert response.json()["break_minutes"] == 30
    assert "No other shift times were changed" in response.json()["message"]

    with sqlite3.connect(test_database) as connection:
        configured = connection.execute("SELECT start_time,end_time,break_minutes FROM shifts WHERE id=?", (shift_id,)).fetchone()
        other_after = connection.execute(
            "SELECT id,start_time,end_time FROM shifts WHERE active_yn=1 AND warehouse_id IS NULL AND id<>? ORDER BY id", (shift_id,)
        ).fetchall()
        version = connection.execute(
            "SELECT start_time,end_time,break_minutes FROM shift_versions WHERE shift_id=? AND effective_from=?",
            (shift_id, effective_from),
        ).fetchone()
    assert configured == (shift_start, shift_end, 30)
    assert other_after == other_before
    assert version == configured

    invalid = client.put(
        f"/api/workforce/shifts/{shift_id}",
        json={"start_time": "07:00", "end_time": "14:30", "break_minutes": 30},
        headers=headers,
    )
    assert invalid.status_code == 400
    assert "eight working hours plus the break" in invalid.json()["error"]
