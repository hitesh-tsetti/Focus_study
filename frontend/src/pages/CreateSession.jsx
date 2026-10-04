import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronDown, ChevronUp, Volume2 } from "lucide-react";
import { createSession } from "../api";

const PRESETS = [25, 50, 90];

const ALL_ALARM_SITES = [
  { domain: "youtube.com", label: "YouTube (non-educational)" },
  { domain: "instagram.com", label: "Instagram" },
  { domain: "tiktok.com", label: "TikTok" },
  { domain: "twitter.com", label: "Twitter / X" },
  { domain: "x.com", label: "X.com" },
  { domain: "facebook.com", label: "Facebook" },
  { domain: "reddit.com", label: "Reddit" },
  { domain: "threads.net", label: "Threads" },
  { domain: "pinterest.com", label: "Pinterest" },
  { domain: "9gag.com", label: "9GAG" },
  { domain: "tumblr.com", label: "Tumblr" },
  { domain: "snapchat.com", label: "Snapchat" },
  { domain: "twitch.tv", label: "Twitch" },
];

function loadBannedSites() {
  try {
    const saved = localStorage.getItem("focusStudy_bannedSites");
    if (saved) return JSON.parse(saved);
  } catch {}
  return ALL_ALARM_SITES.map(s => s.domain);
}

export default function CreateSession() {
  const nav = useNavigate();
  const [task, setTask] = useState("");
  const [minutes, setMinutes] = useState(50);
  const [custom, setCustom] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [bannedSites, setBannedSites] = useState(loadBannedSites);
  const [alarmOpen, setAlarmOpen] = useState(false);

  function toggleSite(domain) {
    setBannedSites(prev => {
      const next = prev.includes(domain) ? prev.filter(d => d !== domain) : [...prev, domain];
      localStorage.setItem("focusStudy_bannedSites", JSON.stringify(next));
      return next;
    });
  }

  function toggleAll(checked) {
    const next = checked ? ALL_ALARM_SITES.map(s => s.domain) : [];
    setBannedSites(next);
    localStorage.setItem("focusStudy_bannedSites", JSON.stringify(next));
  }

  async function handleStart(e) {
    e.preventDefault();
    if (!task.trim()) { setError("Please describe what you're working on."); return; }
    if (!minutes || minutes < 5) { setError("Please choose a session length."); return; }
    setLoading(true);
    setError("");
    try {
      await createSession(task.trim(), Number(minutes));
      nav("/calibrate");
    } catch (err) {
      setError("Could not connect to the backend. Make sure it's running.");
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <div className="stack slide-up" style={{ gap: 32 }}>

        <div className="row">
          <button className="btn-ghost" style={{ padding: "8px 0" }} onClick={() => nav("/")}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <ArrowLeft size={18} /> Back
            </span>
          </button>
        </div>

        <div>
          <h1 style={{ marginBottom: 8 }}>New Session</h1>
          <p className="dim">Set your intention before you begin.</p>
        </div>

        <form onSubmit={handleStart} className="stack" style={{ gap: 24 }}>

          <div>
            <label className="label">What are you working on?</label>
            <input
              type="text"
              placeholder="e.g. CSE 320 Exam Preparation"
              value={task}
              onChange={e => setTask(e.target.value)}
              autoFocus
            />
          </div>

          <div>
            <label className="label">How long do you want to focus?</label>
            <div className="row" style={{ flexWrap: "wrap" }}>
              {PRESETS.map(p => (
                <button
                  key={p}
                  type="button"
                  className={minutes === p && !custom ? "btn-primary" : "btn-secondary"}
                  style={{ flex: 1, minWidth: 80 }}
                  onClick={() => { setMinutes(p); setCustom(false); }}
                >
                  {p} min
                </button>
              ))}
              <button
                type="button"
                className={custom ? "btn-primary" : "btn-secondary"}
                style={{ flex: 1, minWidth: 80 }}
                onClick={() => setCustom(true)}
              >
                Custom
              </button>
            </div>
            {custom && (
              <div style={{ marginTop: 12 }}>
                <input
                  type="number"
                  min="5"
                  max="480"
                  placeholder="Minutes"
                  value={minutes}
                  onChange={e => setMinutes(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Audio alarm sites */}
          <div>
            <button
              type="button"
              onClick={() => setAlarmOpen(o => !o)}
              style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%",
                background: "none", border: "1px solid var(--border)", borderRadius: 8,
                padding: "10px 14px", cursor: "pointer", color: "var(--text)",
              }}
            >
              <Volume2 size={16} color="var(--accent)" />
              <span style={{ flex: 1, textAlign: "left", fontWeight: 600, fontSize: "0.9rem" }}>
                Audio alarm sites
              </span>
              <span className="dim" style={{ fontSize: "0.78rem", marginRight: 6 }}>
                {bannedSites.length} of {ALL_ALARM_SITES.length} selected
              </span>
              {alarmOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {alarmOpen && (
              <div style={{
                marginTop: 8, padding: "14px 16px", border: "1px solid var(--border)",
                borderRadius: 8, background: "var(--surface)",
              }}>
                <p className="dim" style={{ fontSize: "0.78rem", marginBottom: 12 }}>
                  The alarm sound will play when you visit any checked site during a session.
                </p>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <button type="button" className="btn-ghost" style={{ fontSize: "0.78rem", padding: "2px 0" }} onClick={() => toggleAll(true)}>Select all</button>
                  <button type="button" className="btn-ghost" style={{ fontSize: "0.78rem", padding: "2px 0" }} onClick={() => toggleAll(false)}>Deselect all</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>
                  {ALL_ALARM_SITES.map(({ domain, label }) => (
                    <label key={domain} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.85rem" }}>
                      <input
                        type="checkbox"
                        checked={bannedSites.includes(domain)}
                        onChange={() => toggleSite(domain)}
                        style={{ accentColor: "var(--accent)", width: 15, height: 15 }}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {error && (
            <p style={{ color: "var(--red)", fontSize: "0.9rem" }}>{error}</p>
          )}

          <button
            type="submit"
            className="btn-primary"
            style={{ fontSize: "1.05rem", padding: "16px" }}
            disabled={loading}
          >
            {loading ? "Starting…" : "Start Session →"}
          </button>

        </form>

      </div>
    </div>
  );
}
