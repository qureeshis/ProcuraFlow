from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.main import app


PUBLIC_OPERATIONS = {
    ("GET", "/api/health"),
    ("POST", "/api/auth/login"),
    ("GET", "/api/settings/branding"),
    ("GET", "/api/settings/maintenance/status"),
}


def concrete_path(path):
    replacements = {
        "{kind}": "PR",
        "{report_key}": "inventory-stock",
    }
    for marker, value in replacements.items():
        path = path.replace(marker, value)
    while "{" in path:
        start = path.index("{")
        end = path.index("}", start)
        path = path[:start] + "999999999" + path[end + 1:]
    return path


def test_every_nonpublic_api_operation_requires_authentication():
    client = TestClient(app)
    failures = []
    for route in app.routes:
        if not isinstance(route, APIRoute) or not route.path.startswith("/api/"):
            continue
        for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
            if (method, route.path) in PUBLIC_OPERATIONS:
                continue
            response = client.request(method, concrete_path(route.path))
            if response.status_code != 401:
                failures.append((method, route.path, response.status_code))
    assert failures == []
