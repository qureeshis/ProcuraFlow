import shutil
import sqlite3

from fastapi.testclient import TestClient

from app import database
from app.main import app
from app.security import sign_token


def test_location_hierarchy_generates_codes_and_supports_editing(tmp_path, monkeypatch):
    test_database = tmp_path / "warehouse-locations.db"
    shutil.copy2(database.DB_PATH, test_database)
    monkeypatch.setattr(database, "DB_PATH", test_database)
    with sqlite3.connect(test_database) as connection:
        connection.row_factory = sqlite3.Row
        user = connection.execute("SELECT id,username,full_name,role,warehouse_id FROM users WHERE role='SupplyChainManager' AND deleted_at IS NULL ORDER BY id LIMIT 1").fetchone()
        warehouse = connection.execute("SELECT id,warehouse_code FROM warehouses WHERE deleted_at IS NULL ORDER BY id LIMIT 1").fetchone()
    token = sign_token({**dict(user), "warehouse_ids": [], "permission_keys": []})
    headers = {"Authorization": f"Bearer {token}"}
    client = TestClient(app)

    zone = client.post("/api/masters/locations", json={"warehouse_id": warehouse["id"], "type": "Zone", "label": "Test Zone"}, headers=headers)
    assert zone.status_code == 201, zone.text
    assert zone.json()["code"].startswith(f"{warehouse['warehouse_code']}-ZN-")

    rack = client.post("/api/masters/locations", json={"warehouse_id": warehouse["id"], "type": "Rack", "parent_id": zone.json()["id"], "label": "Test Rack"}, headers=headers)
    assert rack.status_code == 201, rack.text
    assert rack.json()["parent_id"] == zone.json()["id"]

    edited = client.put(f"/api/masters/locations/{rack.json()['id']}", json={"label": "Updated Rack", "status": "Maintenance"}, headers=headers)
    assert edited.status_code == 200, edited.text
    assert edited.json()["label"] == "Updated Rack"

    listed = client.get("/api/masters/locations", headers=headers)
    listed_rack = next(row for row in listed.json() if row["id"] == rack.json()["id"])
    assert listed_rack["parent_code"] == zone.json()["code"]
    assert "site_name" in listed_rack
