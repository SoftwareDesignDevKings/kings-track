from app.config import Settings


def make_settings(**kwargs) -> Settings:
    """Create a Settings instance without reading from .env file."""
    return Settings(
        canvas_api_url=kwargs.get("canvas_api_url", ""),
        canvas_api_token=kwargs.get("canvas_api_token", ""),
        _env_file=None,
    )


def test_canvas_configured_both_empty():
    s = make_settings(canvas_api_url="", canvas_api_token="")
    assert s.canvas_configured is False


def test_canvas_configured_only_url():
    s = make_settings(canvas_api_url="https://canvas.test", canvas_api_token="")
    assert s.canvas_configured is False


def test_canvas_configured_both_set():
    s = make_settings(canvas_api_url="https://canvas.test", canvas_api_token="token123")
    assert s.canvas_configured is True


