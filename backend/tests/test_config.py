from app.config import Settings


def make_settings(**kwargs) -> Settings:
    """Create a Settings instance without reading from .env file."""
    return Settings(
        canvas_api_url=kwargs.get("canvas_api_url", ""),
        canvas_api_token=kwargs.get("canvas_api_token", ""),
        canvas_course_whitelist=kwargs.get("canvas_course_whitelist", ""),
        _env_file=None,
    )


def test_course_whitelist_empty_string():
    s = make_settings(canvas_course_whitelist="")
    assert s.course_whitelist == []


def test_course_whitelist_parses_valid_ids():
    s = make_settings(canvas_course_whitelist="123,456")
    assert s.course_whitelist == [123, 456]


def test_course_whitelist_strips_whitespace():
    s = make_settings(canvas_course_whitelist=" 123 , 456 ")
    assert s.course_whitelist == [123, 456]


def test_course_whitelist_ignores_non_digits():
    s = make_settings(canvas_course_whitelist="abc,123,xyz,456")
    assert s.course_whitelist == [123, 456]


def test_canvas_configured_both_empty():
    s = make_settings(canvas_api_url="", canvas_api_token="")
    assert s.canvas_configured is False


def test_canvas_configured_only_url():
    s = make_settings(canvas_api_url="https://canvas.test", canvas_api_token="")
    assert s.canvas_configured is False


def test_canvas_configured_both_set():
    s = make_settings(canvas_api_url="https://canvas.test", canvas_api_token="token123")
    assert s.canvas_configured is True
