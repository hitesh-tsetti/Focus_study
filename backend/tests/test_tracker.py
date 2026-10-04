import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from activity.tracker import _normalise_domain


def test_strips_www():
    assert _normalise_domain("https://www.github.com/user/repo") == "github.com"


def test_strips_m():
    assert _normalise_domain("https://m.instagram.com/p/abc123") == "instagram.com"


def test_strips_web_prefix():
    assert _normalise_domain("https://web.snapchat.com/stories") == "snapchat.com"


def test_keeps_docs_subdomain():
    assert _normalise_domain("https://docs.google.com/document/d/xyz") == "docs.google.com"


def test_keeps_mail_subdomain():
    assert _normalise_domain("https://mail.google.com/mail/u/0/") == "mail.google.com"


def test_chatgpt():
    assert _normalise_domain("https://chatgpt.com/c/abc-def") == "chatgpt.com"


def test_claude():
    assert _normalise_domain("https://claude.ai/chat/abc") == "claude.ai"


def test_plain_domain_no_scheme():
    assert _normalise_domain("github.com") == "github.com"


def test_strips_path_and_query():
    assert _normalise_domain("https://stackoverflow.com/questions/123?tab=newest") == "stackoverflow.com"


def test_strips_port():
    assert _normalise_domain("https://localhost:3000/app") is None


def test_chrome_internal_returns_none():
    assert _normalise_domain("chrome://newtab/") is None
    assert _normalise_domain("chrome-extension://abc/popup.html") is None


def test_about_blank_returns_none():
    assert _normalise_domain("about:blank") is None


def test_edge_internal_returns_none():
    assert _normalise_domain("edge://settings/") is None


def test_empty_returns_none():
    assert _normalise_domain("") is None
    assert _normalise_domain(None) is None


def test_no_dot_returns_none():
    assert _normalise_domain("https://localhost/") is None
