import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { createSession } from "../api";

const PRESETS = [25, 50, 90];

export default function CreateSession() {
  const nav = useNavigate();
  const [task, setTask] = useState("");
  const [minutes, setMinutes] = useState(50);
  const [custom, setCustom] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
