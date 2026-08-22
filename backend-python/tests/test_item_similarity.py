import shutil
import sqlite3

from fastapi.testclient import TestClient

from app import database
from app.main import app
from app.security import sign_token


def test_item_similarity_returns_percent_metadata_and_excludes_current_item(tmp_path, monkeypatch):
    test_database = tmp_path / "item-similarity.db"
    shutil.copy2(database.DB_PATH, test_database)
    monkeypatch.setattr(database, "DB_PATH", test_database)

    with sqlite3.connect(test_database) as connection:
        connection.row_factory = sqlite3.Row
        user = connection.execute(
            "SELECT id,username,full_name,role,warehouse_id FROM users WHERE deleted_at IS NULL ORDER BY id LIMIT 1"
        ).fetchone()
        item = connection.execute(
            "SELECT id,description,category,subcategory,uom FROM items WHERE deleted_at IS NULL ORDER BY id LIMIT 1"
        ).fetchone()

    token = sign_token({**dict(user), "warehouse_ids": [], "permission_keys": []})
    headers = {"Authorization": f"Bearer {token}"}
    payload = {
        "description": item["description"], "category": item["category"],
        "subcategory": item["subcategory"], "uom": item["uom"],
    }
    response = TestClient(app).post("/api/masters/items/similarity", json=payload, headers=headers)
    assert response.status_code == 200, response.text
    exact = next(row for row in response.json() if row["id"] == item["id"])
    assert exact["score"] == 100
    assert exact["match_type"] == "Exact Duplicate"
    assert {"category", "subcategory", "uom"}.issubset(exact)

    excluded = TestClient(app).post(
        "/api/masters/items/similarity", json={**payload, "exclude_id": item["id"]}, headers=headers
    )
    assert excluded.status_code == 200, excluded.text
    assert item["id"] not in {row["id"] for row in excluded.json()}
