from __future__ import annotations

import asyncio
import logging
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage

from app.config import settings

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class EmailSendRequest:
    to_email: str
    subject: str
    text_body: str
    html_body: str | None = None


@dataclass(slots=True)
class EmailSendResult:
    status: str
    provider_response: str | None = None
    error_message: str | None = None


class BaseEmailSender:
    async def send_email(self, request: EmailSendRequest) -> EmailSendResult:
        raise NotImplementedError


class LoggingEmailSender(BaseEmailSender):
    def __init__(self, reason: str):
        self.reason = reason

    async def send_email(self, request: EmailSendRequest) -> EmailSendResult:
        logger.warning(
            "email_send_skipped to=%s subject=%s reason=%s",
            request.to_email,
            request.subject,
            self.reason,
        )
        return EmailSendResult(status="skipped", error_message=self.reason)


class SmtpEmailSender(BaseEmailSender):
    async def send_email(self, request: EmailSendRequest) -> EmailSendResult:
        return await asyncio.to_thread(self._send_sync, request)

    def _send_sync(self, request: EmailSendRequest) -> EmailSendResult:
        message = EmailMessage()
        from_header = settings.reminder_email_from_address
        if settings.reminder_email_from_name:
            from_header = f"{settings.reminder_email_from_name} <{settings.reminder_email_from_address}>"

        message["From"] = from_header
        message["To"] = request.to_email
        message["Subject"] = request.subject
        message.set_content(request.text_body)
        if request.html_body:
            message.add_alternative(request.html_body, subtype="html")

        smtp_cls = smtplib.SMTP_SSL if settings.reminder_smtp_use_ssl else smtplib.SMTP
        try:
            with smtp_cls(
                settings.reminder_smtp_host,
                settings.reminder_smtp_port,
                timeout=settings.reminder_smtp_timeout_seconds,
            ) as client:
                if not settings.reminder_smtp_use_ssl and settings.reminder_smtp_starttls:
                    client.starttls()
                if settings.reminder_smtp_username:
                    client.login(settings.reminder_smtp_username, settings.reminder_smtp_password)
                response = client.send_message(message)
            provider_response = "accepted" if not response else f"partial_failure:{response}"
            return EmailSendResult(status="sent", provider_response=provider_response)
        except Exception as exc:
            logger.exception("email_send_failed to=%s subject=%s", request.to_email, request.subject)
            return EmailSendResult(status="failed", error_message=str(exc))


def build_email_sender() -> BaseEmailSender:
    if not settings.reminder_email_enabled:
        return LoggingEmailSender("Reminder email sending is disabled")
    if not settings.reminder_email_configured:
        return LoggingEmailSender("Reminder email sending is enabled but SMTP is not fully configured")
    return SmtpEmailSender()
