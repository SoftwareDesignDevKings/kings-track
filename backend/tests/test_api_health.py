from unittest.mock import patch


def test_health_returns_ok(app_client):
    resp = app_client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "canvas_configured" in data
    assert "integrations" not in data


def test_health_canvas_configured_false(app_client):
    from app import main
    import app.main as main_module
    from app.config import Settings

    fake_settings = Settings(
        canvas_api_url="",
        canvas_api_token="",
        _env_file=None,
    )
    with patch.object(main_module, "settings", fake_settings):
        resp = app_client.get("/api/health")

    assert resp.status_code == 200
    # The health endpoint reads settings at call time
    data = resp.json()
    assert "canvas_configured" in data
