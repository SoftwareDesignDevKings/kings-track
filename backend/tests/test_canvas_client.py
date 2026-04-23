"""
Tests for CanvasClient using respx to mock httpx at the transport level.
"""
import asyncio
from unittest.mock import patch, AsyncMock

import pytest
import respx
import httpx

from app.canvas.client import CanvasClient, CanvasAPIError

BASE_URL = "https://canvas.test"
TOKEN = "test-token"


@pytest.fixture
def client():
    return CanvasClient(BASE_URL, TOKEN)


@respx.mock
async def test_bearer_token_injected(client):
    """Every request must include Authorization: Bearer <token>."""
    route = respx.get(f"{BASE_URL}/api/v1/courses").mock(
        return_value=httpx.Response(200, json=[])
    )
    async with client:
        await client._request("GET", "/api/v1/courses")

    assert route.called
    assert route.calls[0].request.headers["authorization"] == f"Bearer {TOKEN}"


@respx.mock
async def test_rate_limit_backoff_triggered(client):
    """When X-Rate-Limit-Remaining < 100, asyncio.sleep should be called."""
    respx.get(f"{BASE_URL}/api/v1/courses").mock(
        return_value=httpx.Response(200, json=[], headers={"X-Rate-Limit-Remaining": "50"})
    )
    with patch("app.canvas.client.asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
        async with client:
            await client._request("GET", "/api/v1/courses")
        mock_sleep.assert_called_once_with(1.0)


@respx.mock
async def test_retry_on_429(client):
    """A 429 response should be retried; the second successful response is returned."""
    route = respx.get(f"{BASE_URL}/api/v1/courses").mock(
        side_effect=[
            httpx.Response(429, text="rate limited"),
            httpx.Response(200, json=[{"id": 1}]),
        ]
    )
    with patch("app.canvas.client.asyncio.sleep", new_callable=AsyncMock):
        async with client:
            resp = await client._request("GET", "/api/v1/courses")

    assert resp.status_code == 200
    assert route.call_count == 2


@respx.mock
async def test_raises_canvas_api_error_on_404(client):
    """4xx responses (other than retried 429) should raise CanvasAPIError."""
    respx.get(f"{BASE_URL}/api/v1/courses/999").mock(
        return_value=httpx.Response(404, text="not found")
    )
    async with client:
        with pytest.raises(CanvasAPIError) as exc_info:
            await client._request("GET", "/api/v1/courses/999")

    assert exc_info.value.status_code == 404


@respx.mock
async def test_get_paginated_follows_link_header(client):
    """get_paginated should follow Link rel=next and yield items from all pages."""
    page2_url = f"{BASE_URL}/api/v1/courses/page2"

    respx.get(f"{BASE_URL}/api/v1/courses").mock(
        return_value=httpx.Response(
            200,
            json=[{"id": 1}, {"id": 2}],
            headers={"Link": f'<{page2_url}>; rel="next"'},
        )
    )
    respx.get(page2_url).mock(
        return_value=httpx.Response(
            200,
            json=[{"id": 3}],
        )
    )

    async with client:
        items = [item async for item in client.get_paginated("/api/v1/courses")]

    assert [i["id"] for i in items] == [1, 2, 3]


@respx.mock
async def test_list_courses_uses_teacher_courses_when_present(client):
    respx.get(f"{BASE_URL}/api/v1/courses").mock(
        return_value=httpx.Response(200, json=[{"id": 11}, {"id": 12}])
    )
    manageable_accounts = respx.get(f"{BASE_URL}/api/v1/manageable_accounts").mock(
        return_value=httpx.Response(200, json=[{"id": 99}])
    )

    async with client:
        courses = await client.list_courses()

    assert [course["id"] for course in courses] == [11, 12]
    assert manageable_accounts.called is False


@respx.mock
async def test_list_courses_falls_back_to_admin_accounts(client):
    respx.get(f"{BASE_URL}/api/v1/courses").mock(
        return_value=httpx.Response(200, json=[])
    )
    respx.get(f"{BASE_URL}/api/v1/manageable_accounts").mock(
        return_value=httpx.Response(200, json=[{"id": 10}, {"id": 20}])
    )
    respx.get(f"{BASE_URL}/api/v1/accounts/10/courses").mock(
        return_value=httpx.Response(
            200,
            json=[
                {"id": 101, "name": "Admin Course A"},
                {"id": 102, "name": "Shared Course"},
            ],
        )
    )
    respx.get(f"{BASE_URL}/api/v1/accounts/20/courses").mock(
        return_value=httpx.Response(
            200,
            json=[
                {"id": 102, "name": "Shared Course"},
                {"id": 103, "name": "Admin Course B"},
            ],
        )
    )

    async with client:
        courses = await client.list_courses()

    assert [course["id"] for course in courses] == [101, 102, 103]


@respx.mock
async def test_list_courses_falls_back_to_visible_accounts_when_manageable_is_empty(client):
    respx.get(f"{BASE_URL}/api/v1/courses").mock(
        return_value=httpx.Response(200, json=[])
    )
    respx.get(f"{BASE_URL}/api/v1/manageable_accounts").mock(
        return_value=httpx.Response(200, json=[])
    )
    respx.get(f"{BASE_URL}/api/v1/accounts").mock(
        return_value=httpx.Response(200, json=[{"id": 11}])
    )
    respx.get(f"{BASE_URL}/api/v1/accounts/11/courses").mock(
        return_value=httpx.Response(
            200,
            json=[
                {"id": 1064, "name": "Course One"},
                {"id": 1131, "name": "Course Two"},
            ],
        )
    )

    async with client:
        courses = await client.list_courses()

    assert [course["id"] for course in courses] == [1064, 1131]
