from datetime import timezone
from app.sync.tasks import _parse_dt


def test_returns_none_for_none():
    assert _parse_dt(None) is None


def test_returns_none_for_empty_string():
    assert _parse_dt("") is None


def test_parses_canvas_z_suffix():
    result = _parse_dt("2024-09-01T12:00:00Z")
    assert result is not None
    assert result.year == 2024
    assert result.month == 9
    assert result.day == 1
    assert result.tzinfo is not None


def test_parses_iso_with_utc_offset():
    result = _parse_dt("2024-09-01T12:00:00+00:00")
    assert result is not None
    assert result.year == 2024
    assert result.tzinfo is not None


def test_returns_none_for_malformed():
    assert _parse_dt("not-a-date") is None
    assert _parse_dt("12345") is None
