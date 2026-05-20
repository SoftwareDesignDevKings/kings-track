from app.canvas.pagination import parse_next_url


def test_returns_none_for_none():
    assert parse_next_url(None) is None


def test_returns_none_for_empty_string():
    assert parse_next_url("") is None


def test_extracts_next_from_single_rel():
    header = '<https://canvas.example.com/api/v1/courses?page=2>; rel="next"'
    assert parse_next_url(header) == "https://canvas.example.com/api/v1/courses?page=2"


def test_extracts_next_from_multi_rel_link():
    header = (
        '<https://canvas.example.com/api/v1/courses?page=2>; rel="next", '
        '<https://canvas.example.com/api/v1/courses?page=1>; rel="prev", '
        '<https://canvas.example.com/api/v1/courses?page=5>; rel="last"'
    )
    assert parse_next_url(header) == "https://canvas.example.com/api/v1/courses?page=2"


def test_returns_none_when_no_next_rel():
    header = (
        '<https://canvas.example.com/api/v1/courses?page=4>; rel="prev", '
        '<https://canvas.example.com/api/v1/courses?page=5>; rel="last"'
    )
    assert parse_next_url(header) is None


def test_handles_url_with_query_params():
    header = '<https://canvas.example.com/api/v1/courses?page=bookmark:abc123&per_page=100>; rel="next"'
    result = parse_next_url(header)
    assert result == "https://canvas.example.com/api/v1/courses?page=bookmark:abc123&per_page=100"
