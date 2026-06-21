"""Gmail IMAP client using app password authentication."""

from __future__ import annotations

import email
import imaplib
import os
import re
from dataclasses import dataclass
from email.header import decode_header
from email.utils import parsedate_to_datetime
from typing import Any


@dataclass
class GmailConfig:
    address: str
    app_password: str
    imap_host: str = "imap.gmail.com"
    imap_port: int = 993

    @classmethod
    def from_env(cls) -> GmailConfig:
        address = (os.getenv("GMAIL_ADDRESS") or os.getenv("GMAIL_EMAIL") or "").strip()
        password = (os.getenv("GMAIL_APP_PASSWORD") or os.getenv("GMAIL_PASSWORD") or "").strip()
        password = password.replace(" ", "")
        if not address or not password:
            raise RuntimeError(
                "Set GMAIL_ADDRESS and GMAIL_APP_PASSWORD in .env "
                "(Google App Password with 2FA enabled)."
            )
        host = (os.getenv("GMAIL_IMAP_HOST") or "imap.gmail.com").strip()
        port = int(os.getenv("GMAIL_IMAP_PORT") or "993")
        return cls(address=address, app_password=password, imap_host=host, imap_port=port)


def _decode_header_value(value: str | None) -> str:
    if not value:
        return ""
    parts: list[str] = []
    for chunk, charset in decode_header(value):
        if isinstance(chunk, bytes):
            parts.append(chunk.decode(charset or "utf-8", errors="replace"))
        else:
            parts.append(str(chunk))
    return " ".join(parts).strip()


def _extract_body(msg: email.message.Message) -> str:
    plain_parts: list[str] = []
    html_parts: list[str] = []
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            disp = str(part.get("Content-Disposition") or "")
            if "attachment" in disp.lower():
                continue
            try:
                payload = part.get_payload(decode=True)
            except Exception:
                continue
            if not payload:
                continue
            charset = part.get_content_charset() or "utf-8"
            text = payload.decode(charset, errors="replace")
            if ctype == "text/plain":
                plain_parts.append(text)
            elif ctype == "text/html":
                html_parts.append(text)
    else:
        try:
            payload = msg.get_payload(decode=True) or b""
            charset = msg.get_content_charset() or "utf-8"
            text = payload.decode(charset, errors="replace")
            if msg.get_content_type() == "text/html":
                html_parts.append(text)
            else:
                plain_parts.append(text)
        except Exception:
            pass

    if plain_parts:
        return "\n".join(plain_parts).strip()
    if html_parts:
        html = html_parts[0]
        html = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", html)
        html = re.sub(r"(?i)<br\s*/?>", "\n", html)
        html = re.sub(r"(?i)</p>", "\n", html)
        html = re.sub(r"<[^>]+>", " ", html)
        html = re.sub(r"\s+", " ", html)
        return html.strip()
    return ""


def parse_gmail_query(query: str) -> list[str]:
    """
    Map a Gmail-like query string to IMAP SEARCH criteria.

    Supports: from:, to:, subject:, is:unread, newer_than:7d, plain text (TEXT).
    """
    q = (query or "").strip()
    if not q:
        return ["ALL"]

    criteria: list[str] = []
    rest: list[str] = []

    for token in q.split():
        lower = token.lower()
        if lower.startswith("from:"):
            criteria.extend(["FROM", token[5:].strip('"')])
        elif lower.startswith("to:"):
            criteria.extend(["TO", token[3:].strip('"')])
        elif lower.startswith("subject:"):
            criteria.extend(["SUBJECT", token[8:].strip('"')])
        elif lower in ("is:unread", "unread"):
            criteria.append("UNSEEN")
        elif lower in ("is:read", "read"):
            criteria.append("SEEN")
        elif lower.startswith("newer_than:"):
            from datetime import date, timedelta

            m = re.match(r"newer_than:(\d+)([dhm])", lower)
            if m:
                # IMAP SEARCH only has date (not time) granularity, so hours/minutes
                # collapse to "since today"; days map to a back-dated SINCE.
                days = int(m.group(1)) if m.group(2) == "d" else 0
                since = date.today() - timedelta(days=days)
                criteria.extend(["SINCE", since.strftime("%d-%b-%Y")])
        else:
            rest.append(token)

    if rest:
        criteria.extend(["TEXT", " ".join(rest)])
    return criteria or ["ALL"]


class GmailImapClient:
    def __init__(self, config: GmailConfig | None = None) -> None:
        self.config = config or GmailConfig.from_env()
        self._conn: imaplib.IMAP4_SSL | None = None

    def connect(self) -> imaplib.IMAP4_SSL:
        if self._conn is not None:
            return self._conn
        conn = imaplib.IMAP4_SSL(self.config.imap_host, self.config.imap_port)
        conn.login(self.config.address, self.config.app_password)
        self._conn = conn
        return conn

    def close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.logout()
            except Exception:
                pass
            self._conn = None

    def __enter__(self) -> GmailImapClient:
        self.connect()
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    def list_labels(self) -> list[str]:
        conn = self.connect()
        _status, data = conn.list()
        labels: list[str] = []
        if not data:
            return labels
        for row in data:
            if not row:
                continue
            line = row.decode("utf-8", errors="replace") if isinstance(row, bytes) else str(row)
            m = re.search(r'"([^"]+)"\s*$', line)
            if m:
                labels.append(m.group(1))
        return sorted(set(labels))

    def _select_mailbox(self, mailbox: str) -> None:
        conn = self.connect()
        status, _ = conn.select(mailbox, readonly=True)
        if status != "OK":
            raise RuntimeError(f"Could not open mailbox: {mailbox}")

    def search(self, query: str = "", *, mailbox: str = "INBOX", limit: int = 25) -> list[dict[str, Any]]:
        self._select_mailbox(mailbox)
        conn = self.connect()
        criteria = parse_gmail_query(query)
        status, data = conn.search(None, *criteria)
        if status != "OK" or not data or not data[0]:
            return []
        uids = data[0].split()
        uids = uids[-limit:]
        uids.reverse()
        return [self._fetch_summary(uid) for uid in uids]

    def list_recent(self, *, mailbox: str = "INBOX", limit: int = 10) -> list[dict[str, Any]]:
        return self.search("", mailbox=mailbox, limit=limit)

    def _fetch_summary(self, uid: bytes) -> dict[str, Any]:
        conn = self.connect()
        status, data = conn.fetch(uid, "(RFC822.HEADER FLAGS)")
        if status != "OK" or not data or not data[0]:
            return {"uid": uid.decode(), "error": "fetch failed"}
        raw = data[0][1] if isinstance(data[0], tuple) else b""
        msg = email.message_from_bytes(raw)
        date_str = _decode_header_value(msg.get("Date"))
        try:
            dt = parsedate_to_datetime(msg.get("Date") or "")
            date_iso = dt.isoformat() if dt else date_str
        except Exception:
            date_iso = date_str
        flags = ""
        if isinstance(data[0], tuple) and len(data[0]) > 0:
            meta = data[0][0]
            if isinstance(meta, bytes):
                flags = meta.decode("utf-8", errors="replace")
        return {
            "uid": uid.decode(),
            "from": _decode_header_value(msg.get("From")),
            "to": _decode_header_value(msg.get("To")),
            "subject": _decode_header_value(msg.get("Subject")),
            "date": date_iso,
            "unread": "\\Seen" not in flags,
        }

    def read_message(self, uid: str, *, mailbox: str = "INBOX") -> dict[str, Any]:
        self._select_mailbox(mailbox)
        conn = self.connect()
        status, data = conn.fetch(str(uid).encode(), "(RFC822)")
        if status != "OK" or not data or not data[0]:
            raise RuntimeError(f"Message UID {uid} not found")
        raw = data[0][1] if isinstance(data[0], tuple) else b""
        msg = email.message_from_bytes(raw)
        return {
            "uid": str(uid),
            "from": _decode_header_value(msg.get("From")),
            "to": _decode_header_value(msg.get("To")),
            "subject": _decode_header_value(msg.get("Subject")),
            "date": _decode_header_value(msg.get("Date")),
            "body": _extract_body(msg)[:50000],
        }
