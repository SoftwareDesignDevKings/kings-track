"""Thin async client for the Google Gemini (Generative Language) REST API.

We talk to Gemini over plain HTTP with ``httpx`` (already a project dependency)
rather than pulling in the ``google-generativeai`` SDK, keeping the dependency
surface small and consistent with the other integrations in this codebase.

Only the ``generateContent`` endpoint with function-calling support is needed.
"""
from __future__ import annotations

import httpx

from app.config import settings

_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"


class GeminiError(RuntimeError):
    """Raised when the Gemini API returns an error or unexpected payload.

    Carries an HTTP ``status_code`` and a short, user-safe ``user_message`` so
    the API layer can return something clean instead of the raw Gemini payload.
    The full technical detail stays in the exception string for server logs.
    """

    def __init__(self, message: str, *, status_code: int = 502, user_message: str | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.user_message = user_message or (
            "The AI assistant is temporarily unavailable. Please try again in a moment."
        )


async def generate_content(
    contents: list[dict],
    *,
    system_instruction: str | None = None,
    tools: list[dict] | None = None,
    temperature: float = 0.2,
    timeout: float = 60.0,
) -> dict:
    """Call Gemini ``generateContent`` and return the first candidate's content.

    ``contents`` is the running conversation (list of ``{role, parts}``).
    ``tools`` is a list of function declarations. Returns the model's content
    object: ``{"role": "model", "parts": [...]}`` which may contain text and/or
    ``functionCall`` parts.
    """
    if not settings.gemini_configured:
        raise GeminiError("Gemini is not configured (missing GEMINI_API_KEY).")

    url = f"{_BASE_URL}/models/{settings.gemini_model}:generateContent"
    body: dict = {
        "contents": contents,
        "generationConfig": {"temperature": temperature},
    }
    if system_instruction:
        body["system_instruction"] = {"parts": [{"text": system_instruction}]}
    if tools:
        body["tools"] = [{"function_declarations": tools}]

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(
            url,
            params={"key": settings.gemini_api_key},
            json=body,
        )

    if resp.status_code != 200:
        if resp.status_code == 429:
            user_message = (
                "The AI assistant has reached its usage limit for now. "
                "Please wait a little while and try again."
            )
        elif resp.status_code in (401, 403):
            user_message = (
                "The AI assistant isn't configured correctly (authentication failed). "
                "Please check the API key."
            )
        elif resp.status_code >= 500:
            user_message = (
                "The AI service is having trouble right now. Please try again shortly."
            )
        else:
            user_message = "The AI assistant couldn't process that request. Please try again."
        # Full payload kept for server logs only — never surfaced to the user.
        raise GeminiError(
            f"Gemini API error {resp.status_code}: {resp.text[:500]}",
            status_code=resp.status_code,
            user_message=user_message,
        )

    data = resp.json()

    # Surface prompt-level blocks (e.g. safety) as a clear error.
    if "candidates" not in data or not data["candidates"]:
        feedback = data.get("promptFeedback", {})
        raise GeminiError(f"Gemini returned no candidates. promptFeedback={feedback}")

    candidate = data["candidates"][0]
    content = candidate.get("content")
    if not content:
        reason = candidate.get("finishReason", "unknown")
        raise GeminiError(f"Gemini returned an empty response (finishReason={reason}).")

    return content


def extract_function_calls(content: dict) -> list[dict]:
    """Return the list of ``functionCall`` objects in a model content part."""
    calls = []
    for part in content.get("parts", []):
        if "functionCall" in part:
            calls.append(part["functionCall"])
    return calls


def extract_text(content: dict) -> str:
    """Concatenate all text parts in a model content object."""
    return "".join(
        part["text"] for part in content.get("parts", []) if "text" in part
    ).strip()
