import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Clock, AlertTriangle } from "lucide-react";
import { getHistory } from "../api";

export default function History() {
  const nav = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getHistory()
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page">
      <div className="stack slide-up" style={{ gap: 28 }}>

        <div className="row">
          <button className="btn-ghost" style={{ padding: "8px 0" }} onClick={() => nav("/")}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <ArrowLeft size={18} /> Home
            </span>
          </button>
        </div>

        <div>
          <h1 style={{ marginBottom: 8 }}>Past Sessions</h1>
          <p className="dim">Your focus history, stored locally.</p>
        </div>

        {loading && <p className="dim">Loading…</p>}

        {!loading && sessions.length === 0 && (
          <div className="card" style={{ textAlign: "center" }}>
            <p className="dim" style={{ marginBottom: 16 }}>No sessions yet.</p>
            <button className="btn-primary" onClick={() => nav("/create")}>
              Start Your First Session
            </button>
          </div>
        )}

        {sessions.map((s) => (
          <div
            key={s.session_id}
            className="card"
            style={{ cursor: "pointer", transition: "border-color 0.15s" }}
            onClick={() => nav(`/dashboard/${s.session_id}`)}
            onMouseEnter={e => e.currentTarget.style.borderColor = "var(--accent)"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}
          >
            <div className="row" style={{ marginBottom: 8 }}>
              <div>
                <h3 style={{ marginBottom: 2 }}>{s.task}</h3>
                <p className="dim" style={{ fontSize: "0.82rem" }}>{s.date}</p>
              </div>
              <div className="spacer" />
              <span
                className={`pill ${s.distraction_pct > 20 ? "pill-red" : s.distraction_pct > 10 ? "pill-yellow" : "pill-green"}`}
              >
                {s.distraction_pct}% distraction
              </span>
            </div>
            <div className="row" style={{ gap: 16 }}>
              <span className="dim" style={{ fontSize: "0.8rem", display: "flex", alignItems: "center", gap: 4 }}>
                <Clock size={14} /> {s.actual_minutes} min
              </span>
              {s.strike_count > 0 && (
                <span className="dim" style={{ fontSize: "0.8rem", display: "flex", alignItems: "center", gap: 4 }}>
                  <AlertTriangle size={14} /> {s.strike_count} strike{s.strike_count > 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>
        ))}

        {sessions.length > 0 && (
          <button className="btn-primary" style={{ padding: 14 }} onClick={() => nav("/create")}>
            New Session
          </button>
        )}

      </div>
    </div>
  );
}
