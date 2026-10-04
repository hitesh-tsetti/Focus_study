import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { createWebSocket, endSession } from "../api";
import { Eye, EyeOff, AlertTriangle, Monitor } from "lucide-react";
import { useFaceDetector } from "../camera/useFaceDetector";

function fmt(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

const EDUCATIONAL_KEYWORDS = [
  "tutorial", "lecture", "course", "how to", "howto", "learn",
  "study", "explained", "introduction", "crash course", "university",
  "professor", "lesson", "math", "calculus", "physics", "chemistry",
  "biology", "programming", "algorithm", "mit ", "stanford", "khan",
  "science", "history", "cs50", "freecodecamp", "full stack", "bootcamp",
];

function loadBannedSites() {
  try {
    const saved = localStorage.getItem("focusStudy_bannedSites");
    if (saved) return JSON.parse(saved);
  } catch {}
  return [
    "instagram.com", "tiktok.com", "twitter.com", "x.com",
    "facebook.com", "threads.net", "pinterest.com", "reddit.com",
    "9gag.com", "tumblr.com", "snapchat.com", "twitch.tv", "youtube.com",
  ];
}

function isSocialMediaHijack(activity, bannedSites) {
  if (!activity?.domain) return false;
  const domain = activity.domain.toLowerCase();
  if (domain.includes("youtube.com") || domain.includes("youtu.be")) {
    if (!bannedSites.includes("youtube.com")) return false;
    const title = (activity.window_title || "").toLowerCase();
    return !EDUCATIONAL_KEYWORDS.some((kw) => title.includes(kw));
  }
  return bannedSites.some((d) => domain.includes(d));
}

function CameraFeed({ videoRef, faceWarning, lookingAway }) {
  const statusColor = faceWarning
    ? "rgba(234,179,8,0.9)"
    : lookingAway
    ? "rgba(239,68,68,0.9)"
    : "rgba(34,197,94,0.9)";
  const statusLabel = faceWarning ? "NO FACE" : lookingAway ? "AWAY" : "FOCUSED";

  return (
    <div style={{
      position: "relative", width: "100%", aspectRatio: "4/3",
      background: "#0a0a0a", borderRadius: 12,
      border: "1px solid var(--border)", overflow: "hidden",
    }}>
      <video
        ref={videoRef}
        autoPlay muted playsInline
        style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
      />
      <div style={{
        position: "absolute", bottom: 10, left: 10,
        background: statusColor, borderRadius: 6, padding: "3px 10px",
        fontSize: "0.7rem", fontWeight: 700, color: "#000", letterSpacing: "0.05em",
      }}>
        {statusLabel}
      </div>
    </div>
  );
}

const MAX_TAB_INCIDENTS = 3;
const TAB_GRACE_SECONDS = 10;

export default function ActiveSession() {
  const nav = useNavigate();
  const wsRef = useRef(null);
  const tickRef = useRef(null);
  const strikeAudioRef = useRef(null);
  const socialAudioRef = useRef(null);
  const endingRef = useRef(false);
  const tabTimerRef = useRef(null);
  const tabAlarmActiveRef = useRef(false); // sync ref for closure access

  const bannedSitesRef = useRef(loadBannedSites());

  const [session, setSession] = useState(null);
  const [camera, setCamera] = useState({ face_detected: false, yaw: 0, looking_away: false, calibrated: false });
  const [activity, setActivity] = useState(null);
  const [strikes, setStrikes] = useState({ count: 0, max: 3 });
  const [paused, setPaused] = useState(false);
  const [faceWarning, setFaceWarning] = useState(false);
  const [strikeFlash, setStrikeFlash] = useState(false);
  const [remaining, setRemaining] = useState(null);
  const [tabAlarmActive, setTabAlarmActive] = useState(false);
  const [tabIncidents, setTabIncidents] = useState(0);
  const [tabBreakForced, setTabBreakForced] = useState(false);
  const [tabCountdown, setTabCountdown] = useState(null); // seconds until alarm fires
  const tabCountdownRef = useRef(null);

  // Browser-based face detection — streams face events to backend via WebSocket
  const { videoRef: faceVideoRef, setOnFrame } = useFaceDetector();

  useEffect(() => {
    setOnFrame((faceDetected, yaw) => {
      wsRef.current?.send(JSON.stringify({ cmd: "face_event", face_detected: faceDetected, yaw }));
    });
  }, [setOnFrame]);

  useEffect(() => {
    strikeAudioRef.current = new Audio("/fahhh_KcgAXfs.mp3");
    socialAudioRef.current = new Audio("/gah-damn_ytLqP1s.mp3");
    socialAudioRef.current.loop = true;
    return () => {
      strikeAudioRef.current?.pause();
      socialAudioRef.current?.pause();
    };
  }, []);

  const fireTabAlarm = useCallback(() => {
    tabTimerRef.current = null;
    clearInterval(tabCountdownRef.current);
    tabCountdownRef.current = null;
    setTabCountdown(null);

    if (tabAlarmActiveRef.current) return; // already ringing
    tabAlarmActiveRef.current = true;
    setTabAlarmActive(true);

    setTabIncidents(prev => {
      const next = prev + 1;
      if (next >= MAX_TAB_INCIDENTS) setTabBreakForced(true);
      return next;
    });

    const audio = socialAudioRef.current;
    if (audio) audio.play().catch(() => {});
  }, []);

  const handleBackOnTask = useCallback(() => {
    tabAlarmActiveRef.current = false;
    setTabAlarmActive(false);
    const audio = socialAudioRef.current;
    if (audio && !audio.paused) { audio.pause(); audio.currentTime = 0; }
  }, []);

  const updateActivity = useCallback((act) => {
    if (!act) return;
    setActivity(act);

    if (isSocialMediaHijack(act, bannedSitesRef.current)) {
      // Already alarming — do nothing extra
      if (tabAlarmActiveRef.current) return;
      // Timer already running — do nothing extra
      if (tabTimerRef.current) return;

      // Start grace period countdown
      let remaining = TAB_GRACE_SECONDS;
      setTabCountdown(remaining);
      tabCountdownRef.current = setInterval(() => {
        remaining -= 1;
        setTabCountdown(remaining);
        if (remaining <= 0) {
          clearInterval(tabCountdownRef.current);
          tabCountdownRef.current = null;
        }
      }, 1000);

      tabTimerRef.current = setTimeout(fireTabAlarm, TAB_GRACE_SECONDS * 1000);
    } else {
      // Left the banned site — cancel pending timer but keep alarm ringing if it fired
      if (tabTimerRef.current) {
        clearTimeout(tabTimerRef.current);
        tabTimerRef.current = null;
      }
      if (tabCountdownRef.current) {
        clearInterval(tabCountdownRef.current);
        tabCountdownRef.current = null;
        setTabCountdown(null);
      }
    }
  }, [fireTabAlarm]);

  const handleEvent = useCallback((msg) => {
    const { event, data } = msg;
    if (event === "status" || event === "session_created" || event === "calibration_done") {
      if (data.state) setSession(data);
      if (data.camera) setCamera(data.camera);
      if (data.remaining != null) setRemaining(data.remaining);
      if (data.strike_count != null) setStrikes({ count: data.strike_count, max: data.max_strikes || 3 });
      if (data.current_activity) updateActivity(data.current_activity);
    }
    if (event === "activity_change") updateActivity(data.current_activity);
    if (event === "face_state") {
      if (data.state === "lost") setFaceWarning(true);
      if (data.state === "detected") setFaceWarning(false);
    }
    if (event === "yaw_update") setCamera(prev => ({ ...prev, yaw: data.yaw }));
    if (event === "looking_away") setCamera(prev => ({ ...prev, looking_away: true }));
    if (event === "looking_back") setCamera(prev => ({ ...prev, looking_away: false }));
    if (event === "strike") {
      setStrikes({ count: data.number, max: data.max });
      setStrikeFlash(true);
      setTimeout(() => setStrikeFlash(false), 2000);
      const sa = strikeAudioRef.current;
      if (sa) { sa.currentTime = 0; sa.play().catch(() => {}); }
    }
    if (event === "session_paused") {
      setPaused(true);
      const audio = socialAudioRef.current;
      if (audio && !audio.paused) { audio.pause(); audio.currentTime = 0; }
    }
  }, [updateActivity]);

  useEffect(() => {
    const ws = createWebSocket(handleEvent);
    wsRef.current = ws;
    return () => ws.close();
  }, [handleEvent]);

  useEffect(() => {
    tickRef.current = setInterval(() => {
      setRemaining(r => (r != null && r > 0) ? r - 1 : r);
    }, 1000);
    return () => clearInterval(tickRef.current);
  }, []);

  useEffect(() => {
    if (remaining === 0) handleEnd();
  }, [remaining]);

  async function handleEnd() {
    if (endingRef.current) return;
    endingRef.current = true;
    clearInterval(tickRef.current);
    if (tabTimerRef.current) { clearTimeout(tabTimerRef.current); tabTimerRef.current = null; }
    if (tabCountdownRef.current) { clearInterval(tabCountdownRef.current); tabCountdownRef.current = null; }
    wsRef.current?.close();
    const audio = socialAudioRef.current;
    if (audio && !audio.paused) { audio.pause(); audio.currentTime = 0; }
    try {
      const analysis = await endSession();
      nav(`/dashboard/${analysis.session_id}`, { state: { analysis } });
    } catch {
      nav("/");
    }
  }

  const progressPct = session
    ? Math.min(100, ((session.planned_seconds - (remaining ?? session.remaining)) / session.planned_seconds) * 100)
    : 0;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px" }}>

      {strikeFlash && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(239,68,68,0.08)",
          border: "2px solid rgba(239,68,68,0.4)",
          pointerEvents: "none", zIndex: 100,
          animation: "pulse 0.5s ease-in-out 2",
        }} />
      )}

      {/* Task + progress bar */}
      <div style={{ marginBottom: 20 }}>
        <p className="dim" style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
          Focus Session
        </p>
        <h1 style={{ fontSize: "1.3rem", marginBottom: 10 }}>{session?.task || "Loading…"}</h1>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      {/* Two-column layout */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "3fr 2fr",
        gap: 20,
        alignItems: "start",
      }}>

        {/* LEFT — camera feed */}
        <CameraFeed videoRef={faceVideoRef} faceWarning={faceWarning} lookingAway={camera.looking_away} />

        {/* RIGHT — controls */}
        <div className="stack" style={{ gap: 14 }}>

          {/* Timer */}
          <div className="card" style={{ textAlign: "center" }}>
            <p className="dim" style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
              Remaining
            </p>
            <p className="mono" style={{ fontSize: "3rem", fontWeight: 700, letterSpacing: "-0.02em" }}>
              {remaining != null ? fmt(remaining) : "--:--"}
            </p>
          </div>

          {/* Paused */}
          {paused && (
            <div className="card" style={{ borderColor: "var(--red)", textAlign: "center" }}>
              <AlertTriangle size={28} color="var(--red)" style={{ margin: "0 auto 10px" }} />
              <h2 style={{ fontSize: "1rem", marginBottom: 6 }}>Session Paused</h2>
              <p className="dim" style={{ fontSize: "0.82rem", marginBottom: 16 }}>3 strikes reached. Take a break.</p>
              <div className="stack" style={{ gap: 8 }}>
                <button className="btn-primary" onClick={() => nav("/create")}>New Session</button>
                <button className="btn-secondary" onClick={handleEnd}>View Summary</button>
              </div>
            </div>
          )}

          {/* Strikes */}
          {!paused && (
            <div className="card" style={{ textAlign: "center" }}>
              <p className="label" style={{ marginBottom: 8 }}>Strikes</p>
              <p style={{
                fontSize: "2.2rem", fontWeight: 700,
                color: strikes.count === 0 ? "var(--text-dim)" : strikes.count >= 2 ? "var(--red)" : "var(--yellow)"
              }}>
                {strikes.count}
              </p>
              <p className="dim" style={{ fontSize: "0.78rem" }}>of {strikes.max}</p>
            </div>
          )}

          {/* Camera status */}
          {!paused && (
            <div className="card" style={{ textAlign: "center" }}>
              <p className="label" style={{ marginBottom: 8 }}>Camera</p>
              {faceWarning ? (
                <><EyeOff size={20} color="var(--yellow)" style={{ margin: "0 auto 6px" }} />
                <p style={{ fontSize: "0.78rem", color: "var(--yellow)" }}>Face not visible</p></>
              ) : camera.looking_away ? (
                <><EyeOff size={20} color="var(--red)" style={{ margin: "0 auto 6px" }} />
                <p style={{ fontSize: "0.78rem", color: "var(--red)" }}>Looking away</p>
                <p className="dim" style={{ fontSize: "0.7rem" }}>Yaw: {camera.yaw}°</p></>
              ) : (
                <><Eye size={20} color="var(--green)" style={{ margin: "0 auto 6px" }} />
                <p style={{ fontSize: "0.78rem", color: "var(--green)" }}>On screen</p>
                <p className="dim" style={{ fontSize: "0.7rem" }}>Yaw: {camera.yaw}°</p></>
              )}
            </div>
          )}

          {/* Active app */}
          {!paused && (
            <div className="card" style={{ textAlign: "center" }}>
              <p className="label" style={{ marginBottom: 8 }}>Active App</p>
              <Monitor size={18} color="var(--accent)" style={{ margin: "0 auto 6px" }} />
              <p style={{ fontSize: "0.82rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {activity?.app || "—"}
              </p>
              {activity?.domain && (
                <p className="dim" style={{ fontSize: "0.7rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {activity.domain}
                </p>
              )}
            </div>
          )}

          {/* Face warning banner */}
          {faceWarning && !paused && (
            <div className="card" style={{ borderColor: "var(--yellow)", background: "rgba(234,179,8,0.05)" }}>
              <p style={{ color: "var(--yellow)", fontSize: "0.82rem" }}>
                ⚠ Face not detected — check camera position.
              </p>
            </div>
          )}

          {/* End session */}
          {!paused && (
            <button className="btn-secondary" onClick={handleEnd}>
              End Session Early
            </button>
          )}

        </div>
      </div>

      {/* Countdown warning strip */}
      {tabCountdown !== null && !tabAlarmActive && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          background: "rgba(234,179,8,0.15)", borderTop: "2px solid var(--yellow)",
          padding: "12px 24px", zIndex: 150,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
        }}>
          <AlertTriangle size={18} color="var(--yellow)" />
          <span style={{ color: "var(--yellow)", fontWeight: 600 }}>
            Banned site detected — alarm in {tabCountdown}s
          </span>
        </div>
      )}

      {/* Tab alarm overlay */}
      {tabAlarmActive && !tabBreakForced && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)",
          zIndex: 200, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 20,
          padding: 24,
        }}>
          <div style={{ fontSize: "3rem" }}>🚨</div>
          <h2 style={{ fontSize: "1.6rem", fontWeight: 800, color: "var(--red)", textAlign: "center" }}>
            GET BACK ON TASK
          </h2>
          <p style={{ color: "var(--text-dim)", textAlign: "center", maxWidth: 320 }}>
            You've been on a banned site for too long. Return to your work and click the button below.
          </p>
          <p style={{ color: "var(--yellow)", fontSize: "0.82rem" }}>
            Warning {tabIncidents} of {MAX_TAB_INCIDENTS}
          </p>
          <button
            className="btn-primary"
            style={{ fontSize: "1rem", padding: "12px 32px" }}
            onClick={handleBackOnTask}
          >
            I'm back on task
          </button>
        </div>
      )}

      {/* Forced break overlay */}
      {tabBreakForced && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)",
          zIndex: 300, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 20,
          padding: 24,
        }}>
          <div style={{ fontSize: "3rem" }}>😵</div>
          <h2 style={{ fontSize: "1.6rem", fontWeight: 800, color: "var(--red)", textAlign: "center" }}>
            Time for a Break
          </h2>
          <p style={{ color: "var(--text-dim)", textAlign: "center", maxWidth: 340 }}>
            You went off task {MAX_TAB_INCIDENTS} times. Step away from the screen for a few minutes, then come back fresh.
          </p>
          <div className="stack" style={{ gap: 10, width: "100%", maxWidth: 280 }}>
            <button className="btn-primary" onClick={() => nav("/create")}>Start Fresh Session</button>
            <button className="btn-secondary" onClick={handleEnd}>View Summary</button>
          </div>
        </div>
      )}

    </div>
  );
}
