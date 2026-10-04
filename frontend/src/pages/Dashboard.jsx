import { useEffect, useState } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { getSessionDetail } from "../api";
import { ArrowLeft, Clock, Eye, Monitor, AlertTriangle, Target } from "lucide-react";

function fmtMins(secs) {
  const m = Math.round(secs / 60);
  return m === 1 ? "1 min" : `${m} mins`;
}

function fmtPct(a, b) {
  if (!b) return "0%";
  return `${Math.round((a / b) * 100)}%`;
}

function Bar({ value, max, color = "var(--accent)" }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="progress-bar" style={{ height: 8 }}>
      <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function StatCard({ icon, label, value, sub, color }) {
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 8, gap: 8 }}>
        {icon}
        <p className="dim" style={{ fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</p>
      </div>
      <p style={{ fontSize: "1.6rem", fontWeight: 700, color: color || "var(--text)" }}>{value}</p>
      {sub && <p className="dim" style={{ fontSize: "0.8rem", marginTop: 2 }}>{sub}</p>}
    </div>
  );
}

export default function Dashboard() {
  const { sessionId } = useParams();
  const location = useLocation();
  const nav = useNavigate();
  const [data, setData] = useState(location.state?.analysis || null);

  useEffect(() => {
    if (!data) {
      getSessionDetail(sessionId).then(setData).catch(() => nav("/history"));
    }
  }, []);

  if (!data) return <div className="page"><p className="dim">Loading…</p></div>;

  const {
    task, planned_seconds, actual_seconds,
    camera_on_screen_seconds, camera_away_seconds,
    distracting_seconds, productive_seconds, neutral_seconds,
    strike_count, app_summary, domain_summary,
    biggest_distraction, longest_continuous_distraction_seconds,
    insights, timeline,
  } = data;

  const planned_m = Math.round(planned_seconds / 60);
  const actual_m = Math.round(actual_seconds / 60);
  const distraction_pct = actual_seconds ? Math.round((distracting_seconds / actual_seconds) * 100) : 0;

  const topApps = Object.entries(app_summary || {}).slice(0, 6);
  const topDomains = Object.entries(domain_summary || {}).slice(0, 5);

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="stack slide-up" style={{ gap: 28 }}>

        <div className="row">
          <button className="btn-ghost" style={{ padding: "8px 0" }} onClick={() => nav("/history")}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <ArrowLeft size={18} /> Sessions
            </span>
          </button>
          <div className="spacer" />
          <button className="btn-primary" style={{ padding: "8px 16px" }} onClick={() => nav("/create")}>
            New Session
          </button>
        </div>

        {/* Title */}
        <div>
          <p className="dim" style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
            Session Complete
          </p>
          <h1 style={{ fontSize: "1.6rem", lineHeight: 1.3 }}>{task}</h1>
        </div>

        {/* The main reflection */}
        <div className="card" style={{ background: "linear-gradient(135deg, rgba(108,99,255,0.1), rgba(108,99,255,0.03))", borderColor: "rgba(108,99,255,0.3)" }}>
          <p style={{ fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--accent)", marginBottom: 12, fontWeight: 700 }}>
            Reflection
          </p>
          <p style={{ fontSize: "1.05rem", lineHeight: 1.7 }}>
            You planned to focus for{" "}
            <strong>{planned_m} minutes</strong>.
            {distracting_seconds > 60
              ? <> You spent approximately <strong style={{ color: "var(--yellow)" }}>{fmtMins(distracting_seconds)}</strong> on potentially distracting activity{biggest_distraction ? ` — your largest distraction was ${biggest_distraction}` : ""}.</>
              : <> You stayed largely on task throughout the session. Great work.</>
            }
          </p>
        </div>

        {/* Stats grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <StatCard
            icon={<Clock size={16} color="var(--accent)" />}
            label="Session Length"
            value={fmtMins(actual_seconds)}
            sub={`of ${planned_m} min planned`}
          />
          <StatCard
            icon={<Eye size={16} color="var(--green)" />}
            label="Screen-Directed"
            value={fmtMins(camera_on_screen_seconds)}
            sub={fmtPct(camera_on_screen_seconds, actual_seconds) + " of session"}
            color="var(--green)"
          />
          <StatCard
            icon={<Monitor size={16} color="var(--yellow)" />}
            label="Potential Distraction"
            value={fmtMins(distracting_seconds)}
            sub={distraction_pct + "% of session"}
            color={distraction_pct > 20 ? "var(--red)" : distraction_pct > 10 ? "var(--yellow)" : "var(--text)"}
          />
          <StatCard
            icon={<AlertTriangle size={16} color={strike_count >= 3 ? "var(--red)" : "var(--text-dim)"} />}
            label="Focus Strikes"
            value={strike_count}
            sub={`of 3 max`}
            color={strike_count >= 3 ? "var(--red)" : strike_count > 0 ? "var(--yellow)" : "var(--text-dim)"}
          />
        </div>

        {/* App breakdown */}
        {topApps.length > 0 && (
          <div>
            <h2 style={{ marginBottom: 16 }}>Where Your Time Went</h2>
            <div className="card">
              <div className="stack" style={{ gap: 14 }}>
                {topApps.map(([app, secs]) => (
                  <div key={app}>
                    <div className="row" style={{ marginBottom: 6 }}>
                      <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{app}</span>
                      <div className="spacer" />
                      <span className="dim" style={{ fontSize: "0.82rem" }}>{fmtMins(secs)}</span>
                    </div>
                    <Bar
                      value={secs}
                      max={actual_seconds}
                      color={secs === Math.max(...Object.values(app_summary)) ? "var(--accent)" : "var(--border)"}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Domain breakdown */}
        {topDomains.length > 0 && (
          <div>
            <h2 style={{ marginBottom: 16 }}>Browser Activity</h2>
            <div className="card">
              <div className="stack" style={{ gap: 10 }}>
                {topDomains.map(([domain, secs]) => (
                  <div key={domain} className="row">
                    <span style={{ fontWeight: 600, fontSize: "0.88rem", flex: 1 }}>{domain}</span>
                    <span className="dim" style={{ fontSize: "0.82rem" }}>{fmtMins(secs)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Insights */}
        {insights?.length > 0 && (
          <div>
            <h2 style={{ marginBottom: 16 }}>Insights</h2>
            <div className="stack" style={{ gap: 8 }}>
              {insights.map((ins, i) => (
                <div key={i} className="card" style={{ padding: "14px 18px" }}>
                  <p style={{ fontSize: "0.92rem" }}>📊 {ins}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="stack" style={{ gap: 10, paddingTop: 8 }}>
          <button className="btn-primary" style={{ padding: 14 }} onClick={() => nav("/create")}>
            Start Another Session
          </button>
          <button className="btn-secondary" onClick={() => nav("/history")}>
            View All Sessions
          </button>
        </div>

      </div>
    </div>
  );
}
