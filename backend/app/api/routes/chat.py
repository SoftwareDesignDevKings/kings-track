"""AI chat assistant route — POST /api/chat.

Accepts a conversation history and returns the assistant's next reply, grounded
in the analytics data via the Gemini function-calling agent.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_auth
from app.config import settings
from app.db import get_db
from app.chat.agent import run_chat
from app.chat.gemini import GeminiError

logger = logging.getLogger("app.chat")

router = APIRouter(
    prefix="/chat",
    tags=["chat"],
    dependencies=[Depends(require_auth)],
)


class ChatMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str = Field(..., min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(..., min_length=1, max_length=40)


class ChatResponse(BaseModel):
    reply: str
    tool_calls: list[str]


@router.get("/status")
async def chat_status():
    """Whether the assistant is configured and ready to use."""
    return {"enabled": settings.gemini_configured, "model": settings.gemini_model}


@router.post("", response_model=ChatResponse)
async def chat(req: ChatRequest, db: AsyncSession = Depends(get_db)):
    if not settings.gemini_configured:
        raise HTTPException(
            status_code=503,
            detail="The AI assistant is not configured. Set GEMINI_API_KEY to enable it.",
        )

    if req.messages[-1].role != "user":
        raise HTTPException(status_code=400, detail="The last message must be from the user.")

    history = [{"role": m.role, "content": m.content} for m in req.messages]
    try:
        result = await run_chat(db, history)
    except GeminiError as exc:
        # Log the full technical detail; return only the clean user-facing message.
        logger.warning("Gemini error: %s", exc)
        status = exc.status_code if exc.status_code in (429, 503) else 502
        raise HTTPException(status_code=status, detail=exc.user_message)

    return ChatResponse(reply=result["reply"], tool_calls=result["tool_calls"])
