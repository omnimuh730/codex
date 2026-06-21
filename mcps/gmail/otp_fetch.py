#!/usr/bin/env python3
"""Fetch the latest verification code / verify-link from Gmail (per-applicant creds).

Reads GMAIL_ADDRESS + GMAIL_APP_PASSWORD from the environment (the agent passes the
applicant's own creds from MongoDB). Scans recent INBOX messages and extracts a
one-time code and/or a verification URL. Prints a single JSON object.

Usage:
  GMAIL_ADDRESS=… GMAIL_APP_PASSWORD=… python3 otp_fetch.py \
     --match "workday|verify|verification|code|confirm|sign in" \
     --limit 15 --since-epoch 1718000000000
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from imap_client import GmailConfig, GmailImapClient  # noqa: E402

CODE_PATTERNS = [
    re.compile(r"(?:verification|confirmation|security|one[\s-]?time|access|login|sign[\s-]?in|your)\s*(?:code|pin|password)[^0-9]{0,24}(\d{4,8})", re.I),
    re.compile(r"\bcode\s*(?:is|:)?\s*(\d{4,8})\b", re.I),
    re.compile(r"\b(\d{6})\b"),
]
# Alphanumeric codes (e.g. Greenhouse/Affirm 8-char "security code"). Keyword-
# anchored; the captured token must contain a digit (see extract_code) so plain
# words near "code" aren't mistaken for a code.
ALNUM_PATTERNS = [
    re.compile(r"(?:verification|confirmation|security|one[\s-]?time|access|login|sign[\s-]?in)\s*(?:code|pin)[^A-Za-z0-9]{0,24}([A-Za-z0-9]{5,10})", re.I),
    re.compile(r"\bcode\s*(?:is|:)?\s*([A-Za-z0-9]{5,10})\b", re.I),
]
LINK_RE = re.compile(r"https?://[^\s\"'<>\)]+", re.I)
LINK_KEYWORDS = re.compile(r"verify|activate|confirm|token|/email|one[\s-]?time|sign[\s-]?in|reset|password|account", re.I)


def extract_code(text: str) -> str:
    for pat in CODE_PATTERNS:
        m = pat.search(text)
        if m:
            return m.group(1)
    # Fallback: alphanumeric code that contains at least one digit and one letter.
    for pat in ALNUM_PATTERNS:
        for m in pat.finditer(text):
            tok = m.group(1)
            if any(c.isdigit() for c in tok) and any(c.isalpha() for c in tok):
                return tok
    return ""


def extract_link(text: str) -> str:
    links = LINK_RE.findall(text or "")
    for link in links:
        if LINK_KEYWORDS.search(link):
            return link.rstrip(".,);]")
    return ""


def parse_date(s: str):
    try:
        return datetime.fromisoformat(s)
    except Exception:
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--match", default="verify|verification|code|confirm|one[ -]?time|sign[ -]?in|activate|password|workday")
    ap.add_argument("--query", default="newer_than:1d")
    ap.add_argument("--limit", type=int, default=15)
    ap.add_argument("--since-epoch", type=int, default=0, help="only emails at/after this unix-ms time")
    args = ap.parse_args()

    matcher = re.compile(args.match, re.I)
    since = datetime.fromtimestamp(args.since_epoch / 1000, tz=timezone.utc) if args.since_epoch else None

    try:
        cfg = GmailConfig.from_env()
    except Exception as exc:
        print(json.dumps({"found": False, "error": str(exc)}))
        return 0

    try:
        with GmailImapClient(cfg) as client:
            summaries = client.search(args.query, limit=args.limit)
            for s in summaries:
                hay = f"{s.get('from','')} {s.get('subject','')}"
                if not matcher.search(hay):
                    continue
                dt = parse_date(s.get("date", ""))
                if since and dt and dt.astimezone(timezone.utc) < since:
                    continue
                full = client.read_message(s["uid"])
                body = full.get("body", "") or ""
                blob = f"{s.get('subject','')}\n{body}"
                code = extract_code(blob)
                link = extract_link(body)
                if code or link:
                    print(json.dumps({
                        "found": True, "code": code, "link": link,
                        "from": s.get("from", ""), "subject": s.get("subject", ""),
                        "date": s.get("date", ""), "uid": s.get("uid", ""),
                    }))
                    return 0
        print(json.dumps({"found": False, "scanned": len(summaries) if 'summaries' in dir() else 0}))
    except Exception as exc:
        print(json.dumps({"found": False, "error": str(exc)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
