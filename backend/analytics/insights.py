"""
Session history storage and insight generation.
Stores session analyses as JSON in the data/ directory.
"""

import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

DATA_DIR = Path(__file__).parent.parent.parent / "data"


def save_session(analysis: dict) -> str:
    DATA_DIR.mkdir(exist_ok=True)
    session_id = analysis.get("session_id", str(int(time.time())))
    path = DATA_DIR / f"session_{session_id}.json"
    analysis["saved_at"] = time.time()
    with open(path, "w") as f:
        json.dump(analysis, f, indent=2)
    return str(path)


def load_all_sessions() -> list[dict]:
    DATA_DIR.mkdir(exist_ok=True)
    sessions = []
    for p in sorted(DATA_DIR.glob("session_*.json"), key=os.path.getmtime, reverse=True):
        try:
            with open(p) as f:
                sessions.append(json.load(f))
        except Exception:
            pass
    return sessions


def session_to_history_item(analysis: dict) -> dict:
    saved = analysis.get("saved_at", time.time())
    actual = analysis.get("actual_seconds", 0)
    distracting = analysis.get("distracting_seconds", 0)
    pct = round(distracting / actual * 100) if actual > 0 else 0
    return {
        "session_id": analysis.get("session_id"),
        "task": analysis.get("task", "Unknown"),
        "date": datetime.fromtimestamp(saved).strftime("%b %d"),
        "planned_minutes": round(analysis.get("planned_seconds", 0) / 60),
        "actual_minutes": round(actual / 60),
        "distraction_pct": pct,
        "strike_count": analysis.get("strike_count", 0),
    }
