import shutil
import sqlite3

from fastapi.testclient import TestClient

from app import database
from app.main import app
from app.security import sign_token


def test_company_employee_is_created_selected_and_stored_on_material_issue(tmp_path, monkeypatch):
    test_database = tmp_path / "material-issue-employee.db"
    shutil.copy2(database.DB_PATH, test_database)
    monkeypatch.setattr(database, "DB_PATH", test_database)

    with sqlite3.connect(test_database) as connection:
        user_id = connection.execute("""SELECT u.id FROM users u JOIN employees e ON e.id=u.employee_id
            WHERE u.is_active=1 AND u.deleted_at IS NULL AND u.role='SupplyChainManager' AND e.status='Active' AND e.system_access_yn=1
            ORDER BY u.id LIMIT 1""").fetchone()[0]
        department_id = connection.execute(
            "SELECT id FROM departments WHERE lower(name) NOT IN ('warehouse','procurement') ORDER BY id LIMIT 1"
        ).fetchone()[0]
        warehouse_id = connection.execute(
            "INSERT INTO warehouses(warehouse_code,name) VALUES('TEST-MI-WH','Material Issue Test Warehouse')"
        ).lastrowid
        connection.execute(
            "INSERT OR REPLACE INTO user_warehouse_assignments(user_id,warehouse_id,is_active) VALUES(?,?,1)",
            (user_id, warehouse_id),
        )
        location_id = connection.execute(
            "INSERT INTO locations(warehouse_id,code,type,label,status) VALUES(?,?,'Bin',?,'Active')",
            (warehouse_id, "TEST-BIN", "Material Issue Test Bin"),
        ).lastrowid
        item_id = connection.execute(
            "INSERT INTO items(item_code,description,uom,standard_cost,active_yn) VALUES('TEST-MI-ITEM','Material Issue Test Item','EA',5,1)"
        ).lastrowid
        connection.execute(
            "INSERT INTO inventory_layers(item_id,warehouse_id,location_id,quantity_remaining,unit_cost) VALUES(?,?,?,?,?)",
            (item_id, warehouse_id, location_id, 10, 5),
        )
        connection.execute(
            "INSERT INTO inventory_stock(item_id,warehouse_id,location_id,quantity) VALUES(?,?,?,?)",
            (item_id, warehouse_id, location_id, 10),
        )

    token = sign_token({
        "id": user_id, "username": "material.issue.integration", "full_name": "Material Issue Integration",
        "role": "SupplyChainManager", "warehouse_id": warehouse_id, "warehouse_ids": [warehouse_id],
        "permission_keys": [],
    })
    headers = {"Authorization": f"Bearer {token}"}
    client = TestClient(app)

    employee_response = client.post(
        "/api/masters/general-employees/quick",
        json={"employee_code": "TEST-MI-EMP", "name": "Alex Duplicate Name", "department_id": department_id},
        headers=headers,
    )
    assert employee_response.status_code == 201
    employee = employee_response.json()

    # Browser select/search controls may serialize the selected ID as a string.
    # The API must normalize it instead of rejecting an otherwise valid employee.
    string_department_response = client.post(
        "/api/masters/general-employees/quick",
        json={"employee_code": "TEST-MI-EMP-2", "name": "String Department ID", "department_id": str(department_id)},
        headers=headers,
    )
    assert string_department_response.status_code == 201
    assert string_department_response.json()["department_id"] == department_id

    issue_response = client.post(
        "/api/warehouse/material-issues",
        json={
            "employee_id": employee["id"], "purpose": "Production line material",
            "items": [{"item_id": item_id, "warehouse_id": warehouse_id, "location_id": location_id, "quantity": 2}],
        },
        headers=headers,
    )
    assert issue_response.status_code == 201
    issue_id = issue_response.json()["id"]

    with sqlite3.connect(test_database) as connection:
        stored_issue = connection.execute(
            "SELECT employee_id,purpose,status FROM material_issues WHERE id=?", (issue_id,)
        ).fetchone()
        stored_line = connection.execute(
            "SELECT item_id,warehouse_id,location_id,quantity FROM material_issue_items WHERE issue_id=?", (issue_id,)
        ).fetchone()
        remaining = connection.execute(
            "SELECT quantity FROM inventory_stock WHERE item_id=? AND warehouse_id=? AND location_id=?",
            (item_id, warehouse_id, location_id),
        ).fetchone()[0]
    assert stored_issue == (employee["id"], "Production line material", "PendingApproval")
    assert stored_line == (item_id, warehouse_id, location_id, 2)
    assert remaining == 10

    listed = client.get("/api/warehouse/material-issues", headers=headers)
    assert listed.status_code == 200
    saved = next(row for row in listed.json() if row["id"] == issue_id)
    assert saved["employee_code"] == "TEST-MI-EMP"
    assert saved["employee_name"] == "Alex Duplicate Name"
    assert saved["employee_department_name"]

    approved = client.put(f"/api/warehouse/material-issues/{issue_id}/approve", headers=headers)
    assert approved.status_code == 200, approved.text
    with sqlite3.connect(test_database) as connection:
        status, remaining = connection.execute(
            "SELECT mi.status,s.quantity FROM material_issues mi JOIN inventory_stock s ON s.item_id=? AND s.warehouse_id=? AND s.location_id=? WHERE mi.id=?",
            (item_id, warehouse_id, location_id, issue_id),
        ).fetchone()
    assert status == "Posted"
    assert remaining == 8
