import shutil
import sqlite3

import bcrypt
from fastapi.testclient import TestClient

from app import database
from app.main import app


def test_change_password_cors_and_database_persistence(tmp_path, monkeypatch):
    test_database = tmp_path / "password-test.db"
    shutil.copy2(database.DB_PATH, test_database)
    monkeypatch.setattr(database, "DB_PATH", test_database)

    password = "Current-Password-123!"
    with sqlite3.connect(test_database) as connection:
        employee_id = connection.execute(
            "INSERT INTO employees(employee_code,name,status,system_access_yn,approval_role) "
            "VALUES('TEST-PASSWORD-USER','Password Test User','Active',1,'SupplyChainManager')"
        ).lastrowid
        connection.execute(
            "INSERT INTO users(employee_id,username,password_hash,full_name,role,is_active,must_change_password) "
            "VALUES(?,?,?,?,?,1,1)",
            (employee_id, "password.integration.test", bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode(), "Password Test User", "SupplyChainManager"),
        )

    client = TestClient(app)
    origin = "http://localhost:5174"
    preflight = client.options(
        "/api/auth/change-password",
        headers={"Origin": origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "authorization,content-type"},
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == origin

    login = client.post("/api/auth/login", json={"username": "password.integration.test", "password": password})
    assert login.status_code == 200
    token = login.json()["token"]
    changed = client.put(
        "/api/auth/change-password",
        json={"current_password": password, "new_password": "Updated-Password-456!"},
        headers={"Authorization": f"Bearer {token}", "Origin": origin},
    )
    assert changed.status_code == 200
    assert changed.headers["access-control-allow-origin"] == origin

    with sqlite3.connect(test_database) as connection:
        stored = connection.execute(
            "SELECT password_hash,must_change_password,password_changed_at,password_expires_at FROM users WHERE username=?",
            ("password.integration.test",),
        ).fetchone()
    assert bcrypt.checkpw(b"Updated-Password-456!", stored[0].encode())
    assert stored[1] == 0
    assert stored[2] and stored[3]
    assert client.post("/api/auth/login", json={"username": "password.integration.test", "password": "Updated-Password-456!"}).status_code == 200
