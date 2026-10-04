"""
Session lifecycle manager.
Coordinates camera monitor and activity tracker.
Owns the strike system and session state machine.
"""

import time
import uuid
from dataclasses import dataclass, field
from typing import Optional, Callable
from enum import Enum

from camera.head_pose import CameraMonitor
from activity.tracker import ActivityTracker


class SessionState(str, Enum):
    IDLE = "idle"
    CALIBRATING = "calibrating"
    ACTIVE = "active"
    PAUSED = "paused"     # 3 strikes reached
    ENDED = "ended"


MAX_STRIKES = 3


@dataclass
class StrikeEvent:
    timestamp: float
    reason: str           # "looking_away" | "face_lost"
    number: int


@dataclass
class Session:
    id: str
    task: str
    planned_duration: int   # seconds
    start_time: float
    state: SessionState = SessionState.CALIBRATING
    strikes: list[StrikeEvent] = field(default_factory=list)
    end_time: Optional[float] = None
    camera_away_seconds: float = 0.0
    # Filled at session end
    timeline: list = field(default_factory=list)
    app_summary: dict = field(default_factory=dict)
    category_summary: dict = field(default_factory=dict)
    domain_summary: dict = field(default_factory=dict)

    @property
    def strike_count(self):
        return len(self.strikes)

    @property
    def elapsed(self):
        if self.end_time:
            return self.end_time - self.start_time
        return time.time() - self.start_time

    @property
    def remaining(self):
        return max(0.0, self.planned_duration - self.elapsed)


class SessionManager:
    """
    Single active session at a time.
    Exposes callbacks so the WebSocket layer can push updates to the frontend.
    """

    def __init__(self, on_event: Optional[Callable] = None):
        self.on_event = on_event or (lambda event, data: None)
        self.session: Optional[Session] = None
        self._camera = CameraMonitor(
            on_face_state=self._on_face_state,
            on_yaw_update=self._on_yaw_update,
            on_looking_away=self._on_looking_away,
            on_looking_back=self._on_looking_back,
        )
        self._tracker = ActivityTracker(on_activity_change=self._on_activity_changed)

        # Internal state
        self._looking_away_start: Optional[float] = None
        self._camera_started = False

        # Browser face detection state (used when OpenCV camera is unavailable)
        self._browser_calibration_offset: float = 0.0
        self._browser_face_detected: bool = False
        self._browser_face_lost_at: Optional[float] = None
        self._browser_turn_started_at: Optional[float] = None
        self._browser_looking_away: bool = False

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def ensure_camera_started(self):
        if not self._camera_started:
            self._camera.start()
            self._camera_started = True

    def create_session(self, task: str, planned_minutes: int) -> Session:
        if self.session and self.session.state not in (SessionState.ENDED, SessionState.PAUSED):
            raise ValueError("A session is already active")

        self.session = Session(
            id=str(uuid.uuid4()),
            task=task,
            planned_duration=planned_minutes * 60,
            start_time=time.time(),
            state=SessionState.CALIBRATING,
        )
        self.ensure_camera_started()
        self._emit("session_created", self._session_snapshot())
        return self.session

    def calibrate(self) -> bool:
        """Calibrate head pose. Returns True on success."""
        if not self.session:
            raise ValueError("No session")
        ok = self._camera.calibrate()
        if ok:
            self.session.state = SessionState.ACTIVE
            self._tracker.start()
            self._emit("calibration_done", self._session_snapshot())
        else:
            self._emit("calibration_failed", {"reason": "Could not detect face during calibration"})
        return ok

    def skip_calibration(self):
        """Allow starting without calibration (camera may not be available)."""
        if not self.session:
            raise ValueError("No session")
        self.session.state = SessionState.ACTIVE
        self._tracker.start()
        self._emit("calibration_done", self._session_snapshot())

    def end_session(self) -> dict:
        """End session normally and return analysis."""
        if not self.session:
            raise ValueError("No session")
        return self._finalize_session()

    def get_status(self) -> dict:
        camera_status = self._camera.get_status()
        current_activity = self._tracker.get_current()
        snap = self._session_snapshot()
        snap["camera"] = camera_status
        snap["current_activity"] = current_activity
        return snap

    def get_latest_frame_jpeg(self):
        return self._camera.get_latest_frame_jpeg()

    def set_browser_calibration(self, yaw_offset: float):
        """Accept calibration offset computed by the browser face detector."""
        self._browser_calibration_offset = yaw_offset
        if self.session and self.session.state == SessionState.CALIBRATING:
            self.session.state = SessionState.ACTIVE
            self._tracker.start()
        self._emit("calibration_done", self._session_snapshot())

    def process_browser_face_event(self, face_detected: bool, yaw: float):
        """
        Called from the WebSocket handler when the browser sends face detection data.
        Replicates the grace-period + turn-duration logic of CameraMonitor.
        """
        if not self.session or self.session.state != SessionState.ACTIVE:
            return

        now = time.time()

        if face_detected:
            prev_detected = self._browser_face_detected
            self._browser_face_detected = True
            self._browser_face_lost_at = None

            if not prev_detected:
                self._on_face_state("detected")

            adjusted = yaw - self._browser_calibration_offset
            self._on_yaw_update(round(adjusted, 1))
            self._update_browser_turn(abs(adjusted) > 15.0, now)
        else:
            if self._browser_face_lost_at is None:
                self._browser_face_lost_at = now
            elif now - self._browser_face_lost_at > 2.0 and self._browser_face_detected:
                self._browser_face_detected = False
                self._browser_turn_started_at = None
                self._browser_looking_away = False
                self._on_face_state("lost")

    def _update_browser_turn(self, is_away: bool, now: float):
        if is_away:
            if self._browser_turn_started_at is None:
                self._browser_turn_started_at = now
            elif now - self._browser_turn_started_at >= 2.0 and not self._browser_looking_away:
                self._browser_looking_away = True
                self._on_looking_away()
        else:
            was_away = self._browser_looking_away
            self._browser_turn_started_at = None
            self._browser_looking_away = False
            if was_away:
                self._on_looking_back()

    def stop_camera(self):
        self._camera.stop()
        self._camera_started = False

    # ------------------------------------------------------------------
    # Camera callbacks
    # ------------------------------------------------------------------

    def _on_face_state(self, state: str):
        self._emit("face_state", {"state": state})

    def _on_yaw_update(self, yaw: float):
        self._emit("yaw_update", {"yaw": yaw})

    def _on_looking_away(self):
        if not self.session or self.session.state != SessionState.ACTIVE:
            return
        self._looking_away_start = time.time()
        self._emit("looking_away", {})
        self._issue_strike("looking_away")

    def _on_activity_changed(self, activity: dict):
        self._emit("activity_change", {"current_activity": activity})

    def _on_looking_back(self):
        if self._looking_away_start:
            away_secs = time.time() - self._looking_away_start
            if self.session:
                self.session.camera_away_seconds += away_secs
            self._looking_away_start = None
        self._emit("looking_back", {})

    # ------------------------------------------------------------------
    # Strike system
    # ------------------------------------------------------------------

    def _issue_strike(self, reason: str):
        if not self.session or self.session.state != SessionState.ACTIVE:
            return

        strike = StrikeEvent(
            timestamp=time.time(),
            reason=reason,
            number=self.session.strike_count + 1,
        )
        self.session.strikes.append(strike)
        self._emit("strike", {
            "number": strike.number,
            "max": MAX_STRIKES,
            "reason": reason,
        })

        if self.session.strike_count >= MAX_STRIKES:
            self.session.state = SessionState.PAUSED
            self._tracker.stop()
            self._emit("session_paused", {"reason": "max_strikes"})

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _finalize_session(self) -> dict:
        s = self.session
        s.end_time = time.time()
        s.state = SessionState.ENDED
        self._tracker.stop()

        # Collect data
        s.timeline = self._tracker.get_timeline()
        s.app_summary = self._tracker.get_summary()
        s.category_summary = self._tracker.get_category_summary()
        s.domain_summary = self._tracker.get_domain_summary()

        # Account for any ongoing away period
        if self._looking_away_start:
            s.camera_away_seconds += time.time() - self._looking_away_start
            self._looking_away_start = None

        analysis = self._build_analysis(s)
        self._emit("session_ended", analysis)
        return analysis

    def _build_analysis(self, s: Session) -> dict:
        elapsed = s.elapsed
        planned = s.planned_duration
        camera_away = s.camera_away_seconds
        camera_on_screen = max(0.0, elapsed - camera_away)
        distracting_secs = s.category_summary.get("distracting", 0.0)

        # Biggest distraction (by app or domain)
        biggest_distraction = None
        if s.app_summary:
            # Find the top distracting app from timeline
            distracting_events = [
                e for e in s.timeline if e["category"] == "distracting"
            ]
            if distracting_events:
                by_app: dict = {}
                for e in distracting_events:
                    key = e.get("domain") or e["app"]
                    by_app[key] = by_app.get(key, 0) + e["duration"]
                biggest_distraction = max(by_app, key=by_app.get)

        # Longest continuous distraction period
        longest_continuous = 0.0
        current_run = 0.0
        for e in s.timeline:
            if e["category"] == "distracting":
                current_run += e["duration"]
                longest_continuous = max(longest_continuous, current_run)
            else:
                current_run = 0.0

        # Insights
        insights = []
        pct_distracted = (distracting_secs / elapsed * 100) if elapsed > 0 else 0
        if pct_distracted > 0:
            insights.append(f"You spent {round(pct_distracted)}% of this session on potentially distracting activity.")
        if longest_continuous > 60:
            insights.append(f"Your longest continuous distraction was {round(longest_continuous / 60)} minutes.")
        if s.strike_count > 0:
            insights.append(f"You had {s.strike_count} focus strike{'s' if s.strike_count > 1 else ''} during this session.")
        if camera_on_screen > 0:
            pct_on = round(camera_on_screen / elapsed * 100)
            insights.append(f"You were screen-directed for approximately {pct_on}% of the session.")

        return {
            "session_id": s.id,
            "task": s.task,
            "planned_seconds": planned,
            "actual_seconds": round(elapsed),
            "camera_on_screen_seconds": round(camera_on_screen),
            "camera_away_seconds": round(camera_away),
            "distracting_seconds": round(distracting_secs),
            "productive_seconds": round(s.category_summary.get("productive", 0)),
            "neutral_seconds": round(s.category_summary.get("neutral", 0)),
            "strike_count": s.strike_count,
            "strikes": [
                {"number": st.number, "reason": st.reason, "timestamp": st.timestamp}
                for st in s.strikes
            ],
            "app_summary": {k: round(v) for k, v in s.app_summary.items()},
            "domain_summary": {k: round(v) for k, v in s.domain_summary.items()},
            "timeline": s.timeline,
            "biggest_distraction": biggest_distraction,
            "longest_continuous_distraction_seconds": round(longest_continuous),
            "insights": insights,
        }

    def _session_snapshot(self) -> dict:
        if not self.session:
            return {"state": "idle"}
        s = self.session
        return {
            "session_id": s.id,
            "task": s.task,
            "state": s.state.value,
            "planned_seconds": s.planned_duration,
            "elapsed": round(s.elapsed),
            "remaining": round(s.remaining),
            "strike_count": s.strike_count,
            "max_strikes": MAX_STRIKES,
        }

    def _emit(self, event: str, data: dict):
        try:
            self.on_event(event, data)
        except Exception:
            pass
