#!/usr/bin/env python3
"""Gmail MCP server — read and search via IMAP (app password)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from dotenv import load_dotenv

_GMAIL_DIR = Path(__file__).resolve().parent
_ROOT = _GMAIL_DIR.parents[1]
load_dotenv(_ROOT / ".env")

sys.path.insert(0, str(_GMAIL_DIR))
from imap_client import GmailImapClient  # noqa: E402

try:
    from mcp.server.fastmcp import FastMCP
except ImportError as exc:
    raise SystemExit(
        "Install mcp package: pip install 'mcp>=1.0.0'\n" f"({exc})"
    ) from exc

mcp = FastMCP("gmail")


def _json(data: object) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False)


@mcp.tool()
def gmail_search(query: str = "", mailbox: str = "INBOX", limit: int = 25) -> str:
    """Search Gmail messages. Query supports from:, to:, subject:, is:unread, newer_than:7d, or free text."""
    with GmailImapClient() as client:
        results = client.search(query, mailbox=mailbox, limit=min(max(1, limit), 100))
    return _json({"count": len(results), "messages": results})


@mcp.tool()
def gmail_read_message(uid: str, mailbox: str = "INBOX") -> str:
    """Read a single message by IMAP UID (headers + plain-text body)."""
    with GmailImapClient() as client:
        msg = client.read_message(uid, mailbox=mailbox)
    return _json(msg)


@mcp.tool()
def gmail_list_recent(mailbox: str = "INBOX", limit: int = 10) -> str:
    """List the most recent messages in a mailbox."""
    with GmailImapClient() as client:
        results = client.list_recent(mailbox=mailbox, limit=min(max(1, limit), 100))
    return _json({"count": len(results), "messages": results})


@mcp.tool()
def gmail_get_labels() -> str:
    """List Gmail mailbox labels/folders."""
    with GmailImapClient() as client:
        labels = client.list_labels()
    return _json({"labels": labels})


if __name__ == "__main__":
    mcp.run(transport="stdio")
