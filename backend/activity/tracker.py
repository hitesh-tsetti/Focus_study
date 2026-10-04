"""
Active application and browser domain tracker for Windows.
Uses UI Automation (uiautomation) to read the real URL from the browser address bar.
Falls back to window title keyword matching. Privacy-light: reads only the address bar,
never page content, screenshots, or keystrokes.
"""

import threading
import time
from urllib.parse import urlparse
import psutil
from dataclasses import dataclass, field
from collections import defaultdict
from datetime import datetime
from typing import Optional

try:
    import win32gui
    import win32process
    WIN32_AVAILABLE = True
except ImportError:
    WIN32_AVAILABLE = False

try:
    import uiautomation as auto
    UIA_AVAILABLE = True
except ImportError:
    UIA_AVAILABLE = False

# Apps classified as productive, neutral, or distracting
DISTRACTION_CATEGORIES = {
    "productive": {
        "code", "vscode", "visual studio", "intellij", "pycharm", "webstorm",
        "terminal", "cmd", "powershell", "bash", "git", "notepad++",
        "word", "excel", "powerpoint", "onenote", "notion",
        "figma", "photoshop", "illustrator", "blender",
        "zoom", "teams", "outlook",
    },
    "neutral": {
        "explorer", "finder", "settings", "control panel", "task manager",
        "spotify", "vlc", "windows", "clock", "calendar",
    },
    "distracting": {
        "youtube", "netflix", "twitch", "hulu", "reddit", "twitter",
        "instagram", "tiktok", "facebook", "discord", "steam",
        "epic games", "riot", "valorant", "fortnite", "minecraft",
    },
}

PRODUCTIVE_DOMAINS = {
    "github.com", "gitlab.com", "stackoverflow.com", "docs.google.com",
    "canvas.msu.edu", "msu.edu", "coursera.org", "edx.org", "khanacademy.org",
    "developer.mozilla.org", "docs.python.org", "npmjs.com", "pypi.org",
    "leetcode.com", "hackerrank.com", "replit.com", "codepen.io",
    "overleaf.com", "wolframalpha.com",
    "chatgpt.com", "claude.ai", "openai.com",
}

DISTRACTING_DOMAINS = {
    "youtube.com", "youtu.be", "reddit.com", "twitter.com", "x.com",
    "instagram.com", "tiktok.com", "facebook.com", "twitch.tv",
    "netflix.com", "hulu.com", "disneyplus.com", "9gag.com",
    "buzzfeed.com", "imgur.com", "tumblr.com", "snapchat.com",
}

BROWSER_PROCESS_NAMES = {"chrome", "firefox", "msedge", "opera", "brave"}

# URL prefixes that indicate an internal browser page (no domain to track)
_INTERNAL_SCHEMES = (
    "chrome://", "chrome-extension://", "edge://", "brave://",
    "about:", "moz-extension://", "file://",
)

# Prefixes stripped from hostnames to produce a clean domain
_STRIP_HOST_PREFIXES = ("www.", "m.", "web.", "mobile.")

# Maps title keywords → canonical domain (fallback when URL can't be read)
TITLE_KEYWORD_TO_DOMAIN = {
    "instagram": "instagram.com",
    "tiktok": "tiktok.com",
    "facebook": "facebook.com",
    "twitter": "twitter.com",
    "reddit": "reddit.com",
    "youtube": "youtube.com",
    "twitch": "twitch.tv",
    "netflix": "netflix.com",
    "hulu": "hulu.com",
    "disney+": "disneyplus.com",
    "pinterest": "pinterest.com",
    "snapchat": "snapchat.com",
    "linkedin": "linkedin.com",
    "gmail": "mail.google.com",
    "google docs": "docs.google.com",
    "google sheets": "docs.google.com",
    "github": "github.com",
    "stackoverflow": "stackoverflow.com",
    "chatgpt": "chatgpt.com",
    "openai": "chatgpt.com",
    "claude": "claude.ai",
    "whatsapp": "web.whatsapp.com",
    "discord": "discord.com",
    "slack": "slack.com",
    "notion": "notion.so",
    "figma": "figma.com",
}

# Placeholder used when we know it's a browser window but can't determine the domain
OTHER_BROWSER = "Other (browser)"


@dataclass
class ActivityEvent:
    app_name: str
    process_name: str
    window_title: str
    domain: Optional[str]
    category: str       # productive / neutral / distracting / browser
    start_time: float
    end_time: Optional[float] = None

    @property
    def duration(self) -> float:
        end = self.end_time or time.time()
        return max(0.0, end - self.start_time)


def _normalise_domain(url: str) -> Optional[str]:
    """
    Parse a URL and return a clean, normalised domain name.
    Returns None for internal browser pages (chrome://, about:blank, etc.).
    """
    if not url:
        return None
    if any(url.startswith(s) for s in _INTERNAL_SCHEMES):
        return None
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    try:
        host = urlparse(url).hostname or ""
    except Exception:
        return None
    if not host or "." not in host:
        return None
    for prefix in _STRIP_HOST_PREFIXES:
        if host.startswith(prefix):
            host = host[len(prefix):]
            break
    return host if "." in host else None


def _get_active_window_info():
    """Return (hwnd, proc_name, window_title) or None."""
    if not WIN32_AVAILABLE:
        return None
    try:
        hwnd = win32gui.GetForegroundWindow()
        if not hwnd:
            return None
        title = win32gui.GetWindowText(hwnd)
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        proc = psutil.Process(pid)
        proc_name = proc.name().lower().replace(".exe", "")
        return hwnd, proc_name, title
    except Exception:
        return None


def _get_browser_url(hwnd: int, proc_name: str) -> Optional[str]:
    """
    Read the actual URL from the browser's address bar via UI Automation.
    Returns the raw URL string or None if unavailable.
    """
    if not UIA_AVAILABLE:
        return None
    try:
        ctrl = auto.ControlFromHandle(hwnd)
        if proc_name in ("chrome", "msedge", "brave", "opera"):
            addr = ctrl.EditControl(Name="Address and search bar")
            if addr.Exists(0.1, 0):
                val = addr.GetValuePattern().Value
                return val or None
        elif proc_name == "firefox":
            for name in ("Search with Google or enter address", "Search or enter address"):
                addr = ctrl.EditControl(Name=name)
                if addr.Exists(0.1, 0):
                    val = addr.GetValuePattern().Value
                    return val or None
            addr = ctrl.EditControl(AutomationId="urlbar-input")
            if addr.Exists(0.1, 0):
                val = addr.GetValuePattern().Value
                return val or None
    except Exception:
        pass
    return None


def _extract_domain_from_title(title: str) -> Optional[str]:
    """
    Fallback: match known site names in the page title when the URL is unavailable.
    Does NOT use regex pattern matching on the title to avoid false positives.
    """
    title_lower = title.lower()
    for keyword, domain in TITLE_KEYWORD_TO_DOMAIN.items():
        if keyword in title_lower:
            return domain
    return None


def _classify_app(proc_name: str, domain: Optional[str]) -> str:
    name_lower = proc_name.lower()

    if domain and domain != OTHER_BROWSER:
        if any(d in domain for d in DISTRACTING_DOMAINS):
            return "distracting"
        if any(d in domain for d in PRODUCTIVE_DOMAINS):
            return "productive"

    for cat, keywords in DISTRACTION_CATEGORIES.items():
        if any(kw in name_lower for kw in keywords):
            return cat

    if name_lower in BROWSER_PROCESS_NAMES:
        return "neutral"

    return "neutral"


def _friendly_app_name(proc_name: str) -> str:
    mapping = {
        "code": "VS Code",
        "chrome": "Google Chrome",
        "msedge": "Microsoft Edge",
        "firefox": "Firefox",
        "brave": "Brave",
        "opera": "Opera",
        "discord": "Discord",
        "spotify": "Spotify",
        "cmd": "Command Prompt",
        "powershell": "PowerShell",
        "windowsterminal": "Terminal",
        "explorer": "File Explorer",
        "notepad": "Notepad",
        "notepad++": "Notepad++",
        "winword": "Microsoft Word",
        "excel": "Microsoft Excel",
        "powerpnt": "PowerPoint",
        "onenote": "OneNote",
        "outlook": "Outlook",
        "teams": "Microsoft Teams",
        "zoom": "Zoom",
        "pycharm64": "PyCharm",
        "idea64": "IntelliJ IDEA",
        "devenv": "Visual Studio",
        "steam": "Steam",
    }
    return mapping.get(proc_name.lower(), proc_name.title())


class ActivityTracker:
    """
    Polls the active window every 0.5s and records activity events.
    Thread-safe; call start() / stop() around a session.
    """

    def __init__(self, poll_interval=0.5, on_activity_change=None):
        self.poll_interval = poll_interval
        self._events: list[ActivityEvent] = []
        self._current: Optional[ActivityEvent] = None
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._on_activity_change = on_activity_change or (lambda activity: None)

    def start(self):
        self._events.clear()
        self._current = None
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=3.0)
        with self._lock:
            if self._current:
                self._current.end_time = time.time()
                self._events.append(self._current)
                self._current = None

    def get_current(self):
        with self._lock:
            if self._current:
                return {
                    "app": self._current.app_name,
                    "domain": self._current.domain,
                    "category": self._current.category,
                    "duration": round(self._current.duration),
                    "window_title": self._current.window_title,
                }
        return None

    def get_timeline(self):
        with self._lock:
            events = list(self._events)
            if self._current:
                events.append(self._current)
        return [
            {
                "app": e.app_name,
                "process": e.process_name,
                "domain": e.domain,
                "category": e.category,
                "start": e.start_time,
                "end": e.end_time or time.time(),
                "duration": round(e.duration),
                "start_fmt": datetime.fromtimestamp(e.start_time).strftime("%H:%M"),
            }
            for e in events
        ]

    def get_summary(self):
        """Returns dict of app_name -> total seconds."""
        totals: dict[str, float] = defaultdict(float)
        with self._lock:
            all_events = list(self._events)
            if self._current:
                all_events.append(self._current)
        for e in all_events:
            totals[e.app_name] += e.duration
        return dict(sorted(totals.items(), key=lambda x: x[1], reverse=True))

    def get_category_summary(self):
        """Returns dict of category -> total seconds."""
        cats: dict[str, float] = defaultdict(float)
        with self._lock:
            all_events = list(self._events)
            if self._current:
                all_events.append(self._current)
        for e in all_events:
            cats[e.category] += e.duration
        return dict(cats)

    def get_domain_summary(self):
        """
        Returns dict of domain -> total seconds for browser events.
        Browser time with no identifiable domain is recorded under OTHER_BROWSER
        so the total never silently drops.
        """
        domains: dict[str, float] = defaultdict(float)
        with self._lock:
            all_events = list(self._events)
            if self._current:
                all_events.append(self._current)
        for e in all_events:
            if e.process_name in BROWSER_PROCESS_NAMES:
                key = e.domain if e.domain else OTHER_BROWSER
                domains[key] += e.duration
        return dict(sorted(domains.items(), key=lambda x: x[1], reverse=True))

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _run(self):
        while not self._stop_event.is_set():
            info = _get_active_window_info()
            changed_to = None
            if info:
                hwnd, proc_name, title = info
                is_browser = proc_name.lower() in BROWSER_PROCESS_NAMES

                domain = None
                if is_browser:
                    raw_url = _get_browser_url(hwnd, proc_name)
                    if raw_url:
                        domain = _normalise_domain(raw_url)
                    if domain is None:
                        domain = _extract_domain_from_title(title)
                    # domain stays None → recorded as OTHER_BROWSER in get_domain_summary

                category = _classify_app(proc_name, domain)
                app_name = _friendly_app_name(proc_name)

                with self._lock:
                    current = self._current
                    same = (
                        current is not None
                        and current.process_name == proc_name
                        and current.domain == domain
                    )
                    if not same:
                        now = time.time()
                        if current:
                            current.end_time = now
                            self._events.append(current)
                        self._current = ActivityEvent(
                            app_name=app_name,
                            process_name=proc_name,
                            window_title=title,
                            domain=domain,
                            category=category,
                            start_time=now,
                        )
                        changed_to = {
                            "app": app_name,
                            "domain": domain,
                            "category": category,
                            "window_title": title,
                        }

            if changed_to:
                try:
                    self._on_activity_change(changed_to)
                except Exception:
                    pass

            time.sleep(self.poll_interval)
