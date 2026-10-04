"""Pluggable side-effect adapters: payments, mail, file storage."""

import logging
import secrets
import smtplib
from email.message import EmailMessage
from pathlib import Path
from typing import Protocol

from optiframe.config import Settings
from optiframe.errors import AppError

log = logging.getLogger("optiframe")


# ---------------------------------------------------------------------------- payments


class PaymentProvider(Protocol):
    name: str

    def charge(self, amount_cents: int, currency: str, token: str, description: str) -> str: ...

    def refund(self, charge_ref: str, amount_cents: int) -> str: ...


class FakePaymentProvider:
    """Development provider: every token succeeds except `tok_fail`."""

    name = "fake"

    def charge(self, amount_cents: int, currency: str, token: str, description: str) -> str:
        if token == "tok_fail":
            raise AppError("PAYMENT_FAILED")
        return "fake_ch_" + secrets.token_hex(8)

    def refund(self, charge_ref: str, amount_cents: int) -> str:
        return "fake_re_" + secrets.token_hex(8)


# ---------------------------------------------------------------------------- mail


class Mailer(Protocol):
    def send(self, to: str, subject: str, body: str) -> None: ...


class ConsoleMailer:
    def send(self, to: str, subject: str, body: str) -> None:
        log.info("EMAIL to=%s subject=%r\n%s", to, subject, body)


class SMTPMailer:
    def __init__(self, s: Settings):
        self.s = s

    def send(self, to: str, subject: str, body: str) -> None:
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = self.s.mail_from, to, subject
        msg.set_content(body)
        try:
            with smtplib.SMTP(self.s.smtp_host, self.s.smtp_port, timeout=15) as smtp:
                if self.s.smtp_starttls:
                    smtp.starttls()
                if self.s.smtp_user:
                    smtp.login(self.s.smtp_user, self.s.smtp_password)
                smtp.send_message(msg)
        except Exception:
            # Email is best-effort and runs after the response; never fail an order because of it.
            log.exception("Failed to send email to %s", to)


def make_mailer(s: Settings) -> Mailer:
    return SMTPMailer(s) if s.mailer == "smtp" else ConsoleMailer()


# ---------------------------------------------------------------------------- storage


class LocalStorage:
    def __init__(self, root: Path):
        self.root = root
        root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if self.root.resolve() not in p.parents:
            raise ValueError("invalid storage key")
        return p

    def put(self, key: str, data: bytes) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(p.suffix + ".tmp")
        tmp.write_bytes(data)
        tmp.replace(p)

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)
