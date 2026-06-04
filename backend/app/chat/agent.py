"""The chat agent: drives a Gemini function-calling loop over the data tools.

Flow:
1. Build the conversation (system prompt + prior turns + new user message).
2. Ask Gemini for a response, offering the read-only data tools.
3. If Gemini asks to call tools, execute them against the DB and feed the
   results back. Repeat until Gemini returns a plain-text answer (or we hit the
   iteration cap).
"""
from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.chat import gemini
from app.chat.tools import TOOL_DECLARATIONS, TOOL_IMPLEMENTATIONS

logger = logging.getLogger("app.chat")

SYSTEM_PROMPT = """\
You are the Kings Analytics assistant, helping teachers and administrators \
understand how their students and classes are progressing.

You can answer questions such as how a particular student is going, how a class \
is performing overall, who has or hasn't completed a task, and which students \
need attention. Always ground your answers in the data tools provided — never \
invent numbers, names, or scores.

Guidelines:
- Use find_students to resolve a name to a student_id before fetching a summary.
- Use list_courses to discover the correct course when given a class name.
- If a tool returns an error or no data, say so plainly and suggest a next step.
- Be concise and clear. Prefer short paragraphs or compact bullet lists.
- Report percentages and counts exactly as returned by the tools.
- You only have read access; you cannot change any data or contact students.
- If a question is outside the analytics data (e.g. unrelated to students, \
classes, tasks or attendance), say it's outside what you can help with.
"""

# Roles accepted by the Gemini REST API are "user" and "model". Function
# responses are sent back as a "user" turn carrying functionResponse parts.
_MAX_HISTORY_TURNS = 20


def _to_gemini_contents(history: list[dict]) -> list[dict]:
    """Convert simple {role, content} message dicts into Gemini ``contents``.

    Incoming roles are "user" / "assistant"; Gemini expects "user" / "model".
    """
    contents = []
    for msg in history[-_MAX_HISTORY_TURNS:]:
        role = "model" if msg.get("role") == "assistant" else "user"
        contents.append({"role": role, "parts": [{"text": msg.get("content", "")}]})
    return contents


async def _execute_tool(db: AsyncSession, name: str, args: dict) -> dict:
    impl = TOOL_IMPLEMENTATIONS.get(name)
    if impl is None:
        return {"error": f"Unknown tool '{name}'."}
    try:
        return await impl(db, **(args or {}))
    except TypeError as exc:
        logger.warning("Tool %s called with bad args %s: %s", name, args, exc)
        return {"error": f"Invalid arguments for {name}: {exc}"}
    except Exception as exc:  # noqa: BLE001 — surface failures to the model, not the user
        logger.exception("Tool %s failed", name)
        return {"error": f"{name} failed: {exc}"}


async def run_chat(db: AsyncSession, history: list[dict]) -> dict:
    """Run one assistant turn over the provided conversation history.

    ``history`` is the full list of prior messages ending with the new user
    message, each ``{"role": "user"|"assistant", "content": str}``.

    Returns ``{"reply": str, "tool_calls": [tool names used]}``.
    """
    contents = _to_gemini_contents(history)
    used_tools: list[str] = []

    for _ in range(settings.gemini_max_tool_iterations):
        content = await gemini.generate_content(
            contents,
            system_instruction=SYSTEM_PROMPT,
            tools=TOOL_DECLARATIONS,
        )
        calls = gemini.extract_function_calls(content)

        if not calls:
            return {"reply": gemini.extract_text(content), "tool_calls": used_tools}

        # Record the model's tool-call turn, then answer each call.
        contents.append(content)
        response_parts = []
        for call in calls:
            name = call.get("name", "")
            args = call.get("args", {}) or {}
            used_tools.append(name)
            result = await _execute_tool(db, name, args)
            response_parts.append(
                {"functionResponse": {"name": name, "response": {"result": result}}}
            )
        contents.append({"role": "user", "parts": response_parts})

    # Ran out of iterations — make one final call without tools to force an answer.
    content = await gemini.generate_content(
        contents,
        system_instruction=SYSTEM_PROMPT,
    )
    return {"reply": gemini.extract_text(content), "tool_calls": used_tools}
