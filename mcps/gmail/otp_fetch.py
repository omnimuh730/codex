#!/usr/bin/env python3
"""Fetch a verification code / verify-link from Gmail (per-applicant creds).

Reads GMAIL_ADDRESS + GMAIL_APP_PASSWORD from the environment (the agent passes
the applicant's own creds from MongoDB), loads the most recent INBOX messages,
and resolves the one-time code two ways:

  1. PRIMARY — an LLM reads the candidate emails together with the application
     context (company / job / applicant email) and returns the single email that
     is *this* application's verification message plus the exact code it carries.
     This is robust to (a) other emails arriving in between and (b) changing /
     dynamic mail templates, neither of which a fixed regex handles.
  2. FALLBACK — keyword + pattern extraction, used only when no LLM endpoint is
     configured or the LLM call fails, so a missing key never hard-breaks the gate.

Prints a single JSON object: {"found": bool, "code": str, "link": str, ...}.

LLM endpoint (OpenAI-compatible /chat/completions) is read from the environment:
  OTP_LLM_API_KEY   (falls back to OPENAI_API_KEY)
  OTP_LLM_BASE_URL  (default https://api.openai.com/v1)
  OTP_LLM_MODEL     (default gpt-4o-mini)

Usage:
  GMAIL_ADDRESS=… GMAIL_APP_PASSWORD=… python3 otp_fetch.py \
     --limit 10 --company "Mindbody" --job "Software Engineer III" \
     --to applicant@gmail.com
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from imap_client import GmailConfig, GmailImapClient  # noqa: E402

# ---------------------------------------------------------------------------
# Fallback (regex) extraction — only used when the LLM path is unavailable.
# ---------------------------------------------------------------------------
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
# Last-resort: a standalone token mixing letters AND digits is a strong, low-
# false-positive code signal — plain English words have no digits, and short
# tokens like "11th"/"18th" are excluded by the 6-char minimum.
MIXED_TOKEN = re.compile(r"\b([A-Za-z0-9]{6,10})\b")
LINK_RE = re.compile(r"https?://[^\s\"'<>\)]+", re.I)
LINK_KEYWORDS = re.compile(r"verify|activate|confirm|token|/email|one[\s-]?time|sign[\s-]?in|reset|password|account", re.I)


def extract_code(text: str) -> str:
    for pat in CODE_PATTERNS:
        m = pat.search(text)
        if m:
            return m.group(1)
    for pat in ALNUM_PATTERNS:
        for m in pat.finditer(text):
            tok = m.group(1)
            if any(c.isdigit() for c in tok) and any(c.isalpha() for c in tok):
                return tok
    for m in MIXED_TOKEN.finditer(text):
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


# ---------------------------------------------------------------------------
# Candidate loading
# ---------------------------------------------------------------------------
def _clean(text: str, limit: int = 2500) -> str:
    text = re.sub(r"[ \t]+", " ", text or "")
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = text.strip()
    return text[:limit]


def load_candidates(client: GmailImapClient, *, query: str, limit: int, include_spam: bool):
    """Most-recent-first list of {uid, mailbox, from, subject, date, body}."""
    candidates: list[dict] = []
    boxes = ["INBOX"] + (["[Gmail]/Spam"] if include_spam else [])
    for box in boxes:
        try:
            summaries = client.search(query, mailbox=box, limit=limit)
        except Exception:
            continue
        for s in summaries:
            try:
                full = client.read_message(s["uid"], mailbox=box)
                body = full.get("body", "") or ""
            except Exception:
                body = ""
            candidates.append({
                "uid": s.get("uid", ""),
                "mailbox": box,
                "from": s.get("from", ""),
                "subject": s.get("subject", ""),
                "date": s.get("date", ""),
                "body": _clean(body),
            })
    # Newest first across all mailboxes.
    candidates.sort(key=lambda c: c.get("date", ""), reverse=True)
    return candidates


# ---------------------------------------------------------------------------
# LLM selection + extraction (primary path)
# ---------------------------------------------------------------------------
def _llm_config():
    api_key = (os.getenv("OTP_LLM_API_KEY") or os.getenv("OPENAI_API_KEY") or "").strip()
    if not api_key:
        return None
    base = (os.getenv("OTP_LLM_BASE_URL") or "https://api.openai.com/v1").strip().rstrip("/")
    model = (os.getenv("OTP_LLM_MODEL") or "gpt-4o-mini").strip()
    return {"api_key": api_key, "base": base, "model": model}


def _llm_call(cfg: dict, system: str, user: str, *, timeout: int = 40) -> str:
    payload = {
        "model": cfg["model"],
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    req = urllib.request.Request(
        f"{cfg['base']}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {cfg['api_key']}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"]


def llm_select_code(candidates: list[dict], *, company: str, job: str, to_email: str, want: str):
    """Ask an LLM which candidate is THIS application's code email and extract it.

    Returns the chosen candidate dict augmented with code/link/reason, or None if
    the LLM is unavailable, errors, or finds no matching email.
    """
    cfg = _llm_config()
    if not cfg or not candidates:
        return None

    listing = []
    for i, c in enumerate(candidates):
        listing.append(
            f"[{i}] from: {c['from']}\n    subject: {c['subject']}\n    date: {c['date']}\n"
            f"    body: {c['body']}"
        )
    emails_block = "\n\n".join(listing)

    system = (
        "You read a list of recent emails for an automated job-application agent and "
        "find the single email that delivers the verification / security / one-time "
        "code for the SPECIFIC application described, then return that exact code. "
        "Respond ONLY with a JSON object."
    )
    user = (
        f"Application context:\n"
        f"- Company: {company or '(unknown)'}\n"
        f"- Job: {job or '(unknown)'}\n"
        f"- Applicant email (the code was sent here): {to_email or '(unknown)'}\n"
        f"- What we need: {want}\n\n"
        "Rules:\n"
        "- Choose the email that is the verification/security/one-time code for THIS "
        "application (match the company, the applicant email, and ATS sender such as "
        "Greenhouse/Lever/Workday/Ashby). Other emails (job alerts, recruiter notes, "
        "receipts, other companies' codes) are NOT the answer.\n"
        "- If several plausible code emails exist, pick the MOST RECENT one that matches.\n"
        "- Extract the code EXACTLY as written (preserve case, length, letters and "
        "digits). Do not invent, reformat, or pad it.\n"
        "- If the email instead requires clicking a verification link, return that URL.\n"
        "- If no email matches, set found=false.\n\n"
        "Return JSON with this exact shape:\n"
        '{"found": true|false, "index": <int or null>, "code": "<string or empty>", '
        '"link": "<url or empty>", "reason": "<short why>"}\n\n'
        f"Emails (newest first):\n{emails_block}"
    )

    try:
        raw = _llm_call(cfg, system, user)
        parsed = json.loads(raw)
    except (urllib.error.URLError, urllib.error.HTTPError, KeyError, ValueError, TimeoutError):
        return None
    except Exception:
        return None

    if not parsed.get("found"):
        return None
    idx = parsed.get("index")
    code = (parsed.get("code") or "").strip()
    link = (parsed.get("link") or "").strip()
    if not isinstance(idx, int) or idx < 0 or idx >= len(candidates):
        # The model may return a code without a valid index; still usable.
        if not (code or link):
            return None
        chosen = {"from": "", "subject": "", "date": "", "uid": "", "mailbox": ""}
    else:
        chosen = candidates[idx]
    if not (code or link):
        return None
    return {
        **chosen,
        "code": code,
        "link": link,
        "reason": (parsed.get("reason") or "")[:200],
    }


# ---------------------------------------------------------------------------
def parse_date(s: str):
    try:
        return datetime.fromisoformat(s)
    except Exception:
        return None


def regex_fallback(candidates: list[dict], *, matcher: re.Pattern, since):
    for c in candidates:
        hay = f"{c.get('from','')} {c.get('subject','')}"
        if not matcher.search(hay):
            continue
        dt = parse_date(c.get("date", ""))
        if since and dt and dt.astimezone(timezone.utc) < since:
            continue
        blob = f"{c.get('subject','')}\n{c.get('body','')}"
        code = extract_code(blob)
        link = extract_link(c.get("body", ""))
        if code or link:
            return {**c, "code": code, "link": link}
    return None


def emit(result: dict, via: str) -> None:
    out = {
        "found": True,
        "code": result.get("code", ""),
        "link": result.get("link", ""),
        "from": result.get("from", ""),
        "subject": result.get("subject", ""),
        "date": result.get("date", ""),
        "uid": result.get("uid", ""),
        "via": via,
    }
    if result.get("reason"):
        out["reason"] = result["reason"]
    print(json.dumps(out))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--company", default="", help="company the application is for (LLM disambiguation)")
    ap.add_argument("--job", default="", help="job title (LLM disambiguation)")
    ap.add_argument("--to", dest="to_email", default="", help="applicant email the code was sent to")
    ap.add_argument("--want", default="email verification / security / one-time code")
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--include-spam", action="store_true")
    # Fallback-only knobs.
    ap.add_argument("--match", default="verify|verification|code|confirm|one[ -]?time|sign[ -]?in|activate|password|workday")
    ap.add_argument("--query", default="newer_than:1d")
    ap.add_argument("--since-epoch", type=int, default=0, help="fallback: only emails at/after this unix-ms time")
    args = ap.parse_args()

    try:
        cfg = GmailConfig.from_env()
    except Exception as exc:
        print(json.dumps({"found": False, "error": str(exc)}))
        return 0

    try:
        with GmailImapClient(cfg) as client:
            candidates = load_candidates(
                client, query=args.query, limit=args.limit, include_spam=args.include_spam,
            )

            # PRIMARY: LLM selection + extraction.
            chosen = llm_select_code(
                candidates,
                company=args.company,
                job=args.job,
                to_email=args.to_email or cfg.address,
                want=args.want,
            )
            if chosen:
                emit(chosen, via="llm")
                return 0

            # FALLBACK: regex extraction over the same candidates.
            matcher = re.compile(args.match, re.I)
            since = (
                datetime.fromtimestamp(args.since_epoch / 1000, tz=timezone.utc)
                if args.since_epoch else None
            )
            chosen = regex_fallback(candidates, matcher=matcher, since=since)
            if chosen:
                emit(chosen, via="regex")
                return 0

            print(json.dumps({"found": False, "scanned": len(candidates)}))
    except Exception as exc:
        print(json.dumps({"found": False, "error": str(exc)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
