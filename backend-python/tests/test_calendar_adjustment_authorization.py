from fastapi.testclient import TestClient

from app.database import fetch_all
from app.main import app
from app.security import sign_token


def auth(user_id):
    return {'Authorization': f"Bearer {sign_token({'id': user_id})}"}


def test_only_supply_chain_manager_can_reach_calendar_adjustment_endpoint():
    client = TestClient(app)
    users = fetch_all("SELECT id,role FROM users WHERE is_active=1 AND deleted_at IS NULL")
    assert users
    for user in users:
        response = client.put(
            '/api/workforce/calendar/999999999',
            headers=auth(user['id']),
            json={'day_type': 'OFF', 'reason': 'Authorization test'},
        )
        if user['role'] == 'SupplyChainManager':
            assert response.status_code == 404
        else:
            assert response.status_code == 403, user['role']
