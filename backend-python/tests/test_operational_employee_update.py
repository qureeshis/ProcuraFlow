import shutil
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app import database
from app.main import app
from app.security import sign_token


@pytest.mark.parametrize("department_name", ["warehouse", "procurement"])
def test_existing_supply_chain_employee_can_be_edited_without_duplicate_login(tmp_path, monkeypatch, department_name):
    test_database = tmp_path / f"employee-update-{department_name}.db"
    shutil.copy2(database.DB_PATH, test_database)
    monkeypatch.setattr(database, "DB_PATH", test_database)

    with sqlite3.connect(test_database) as connection:
        connection.row_factory = sqlite3.Row
        manager = connection.execute(
            """SELECT u.id,u.username,u.full_name,u.role,u.warehouse_id,e.id employee_id
               FROM users u JOIN employees e ON e.id=u.employee_id
               WHERE u.is_active=1 AND u.deleted_at IS NULL AND u.role='SupplyChainManager'
               ORDER BY u.id LIMIT 1"""
        ).fetchone()
        employee = connection.execute(
            """SELECT e.* FROM employees e JOIN departments d ON d.id=e.department_id
               WHERE e.deleted_at IS NULL AND lower(d.name)=?
               AND e.id<>? ORDER BY e.id LIMIT 1""",
            (department_name, manager["employee_id"]),
        ).fetchone()
        login_count_before = connection.execute(
            "SELECT COUNT(*) FROM users WHERE employee_id=?", (employee["id"],)
        ).fetchone()[0]

    token = sign_token({
        "id": manager["id"], "username": manager["username"], "full_name": manager["full_name"],
        "role": manager["role"], "warehouse_id": manager["warehouse_id"], "warehouse_ids": [],
        "permission_keys": [],
    })
    response = TestClient(app).put(
        f"/api/masters/employees/{employee['id']}",
        json={
            "first_name": employee["first_name"] or employee["name"],
            "middle_name": employee["middle_name"], "last_name": employee["last_name"],
            "date_of_birth": employee["date_of_birth"], "email": employee["email"],
            "payroll_number": f"EDIT-{department_name}-{employee['id']}", "department_id": employee["department_id"],
            "position": f"Updated {department_name.title()} Position", "reports_to_employee_id": employee["reports_to_employee_id"],
            "approval_limit": employee["approval_limit"] or 0, "approval_role": employee["approval_role"],
            "permission_keys": employee["permission_keys"] or "[]", "system_access_yn": employee["system_access_yn"],
            "status": employee["status"], "warehouse_id": employee["warehouse_id"],
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["position"] == f"Updated {department_name.title()} Position"
    assert response.json()["payroll_number"] == f"EDIT-{department_name}-{employee['id']}"

    if department_name == "warehouse" and employee["warehouse_id"]:
        assignment_payload = {
            "warehouse_ids": [employee["warehouse_id"]],
            "primary_warehouse_id": employee["warehouse_id"],
            "all_warehouses_yn": False,
        }
        first_assignment = TestClient(app).put(
            f"/api/masters/employees/{employee['id']}/warehouse-assignments",
            json=assignment_payload,
            headers={"Authorization": f"Bearer {token}"},
        )
        repeated_assignment = TestClient(app).put(
            f"/api/masters/employees/{employee['id']}/warehouse-assignments",
            json=assignment_payload,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert first_assignment.status_code == 200, first_assignment.text
        assert repeated_assignment.status_code == 200, repeated_assignment.text

    with sqlite3.connect(test_database) as connection:
        stored = connection.execute(
            "SELECT position,payroll_number FROM employees WHERE id=?", (employee["id"],)
        ).fetchone()
        login_count_after = connection.execute(
            "SELECT COUNT(*) FROM users WHERE employee_id=?", (employee["id"],)
        ).fetchone()[0]
    assert stored == (f"Updated {department_name.title()} Position", f"EDIT-{department_name}-{employee['id']}")
    assert login_count_after == login_count_before
