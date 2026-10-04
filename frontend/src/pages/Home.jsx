import { useNavigate } from "react-router-dom";
import { Eye, Clock, BarChart2 } from "lucide-react";

export default function Home() {
  const nav = useNavigate();

  return (
    <div className="page" style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <div className="stack slide-up" style={{ gap: 40 }}>

        {/* Hero */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <Eye size={32} color="var(--accent)" />
            <span style={{ fontSize: "1.1rem", fontWeight: 700, letterSpacing: "0.05em", color: "var(--accent)" }}>
              FOCUS
            </span>
          </div>
          <h1 style={{ fontSize: "2.5rem", lineHeight: 1.2, marginBottom: 12 }}>
            See where your attention<br />actually goes.
          </h1>
          <p style={{ color: "var(--text-dim)", fontSize: "1.1rem", maxWidth: 480 }}>
            Focus measures observable indicators of screen-directed attention
            and digital activity — helping students understand the gap between
            intention and actual behavior.
          </p>
        </div>

        {/* Feature pills */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span className="pill pill-purple">Camera attention tracking</span>
          <span className="pill pill-gray">App + browser monitoring</span>
          <span className="pill pill-gray">Session reflection</span>
          <span className="pill pill-green">100% local processing</span>
        </div>

        {/* Actions */}
        <div className="stack" style={{ gap: 12 }}>
          <button
            className="btn-primary"
            style={{ fontSize: "1.1rem", padding: "16px 24px" }}
            onClick={() => nav("/create")}
          >
            Start Focus Session
          </button>
          <button
            className="btn-secondary"
            style={{ padding: "14px 24px" }}
            onClick={() => nav("/history")}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
              <BarChart2 size={18} />
              View Previous Sessions
            </span>
          </button>
        </div>

        {/* Privacy note */}
        <p style={{ fontSize: "0.8rem", color: "var(--text-dim)", borderTop: "1px solid var(--border)", paddingTop: 16 }}>
          <strong style={{ color: "var(--text)" }}>Privacy:</strong> Your camera is processed locally.
          We never record or upload video. Only session metadata is stored on your device.
        </p>

      </div>
    </div>
  );
}
