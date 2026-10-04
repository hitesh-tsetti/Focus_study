import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle, XCircle, Loader } from "lucide-react";
import { calibrateWithOffset, skipCalibration } from "../api";
import { useFaceDetector } from "../camera/useFaceDetector";

const SAMPLE_DURATION_MS = 3000; // collect yaw for 3 seconds

export default function Calibrate() {
  const nav = useNavigate();
  const [phase, setPhase] = useState("intro"); // intro | loading | calibrating | success | fail
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");

  const { videoRef, ready, faceDetected, yaw, error, setOnFrame } = useFaceDetector();

  async function startCalibration() {
    if (!ready) {
      setStatusMsg("Still loading face detection…");
      return;
    }
    if (!faceDetected) {
      setStatusMsg("No face detected yet — make sure you're in frame.");
      return;
    }

    setPhase("calibrating");
    setProgress(0);
    setStatusMsg("");

    const samples = [];
    const start = Date.now();

    await new Promise((resolve) => {
      setOnFrame((detected, rawYaw) => {
        const elapsed = Date.now() - start;
        setProgress(Math.min(100, (elapsed / SAMPLE_DURATION_MS) * 100));

        if (detected) samples.push(rawYaw);

        if (elapsed >= SAMPLE_DURATION_MS) {
          setOnFrame(null);
          resolve();
        }
      });
    });

    if (samples.length < 10) {
      setPhase("fail");
      return;
    }

    // Compute median as the calibration offset
    const sorted = [...samples].sort((a, b) => a - b);
    const yawOffset = sorted[Math.floor(sorted.length / 2)];

    try {
      await calibrateWithOffset(yawOffset);
      setPhase("success");
      setTimeout(() => nav("/session"), 1000);
    } catch {
      setPhase("fail");
    }
  }

  async function handleSkip() {
    await skipCalibration();
    nav("/session");
  }

  function handleRetry() {
    setPhase("intro");
    setProgress(0);
    setStatusMsg("");
  }

  // Show face detection status in intro
  const faceStatus = error
    ? { color: "var(--red)", text: error }
    : !ready
    ? { color: "var(--text-dim)", text: "Loading face detection…" }
    : faceDetected
    ? { color: "var(--green)", text: "Face detected — ready to calibrate" }
    : { color: "var(--yellow)", text: "No face detected — move into frame" };

  return (
    <div className="page" style={{ display: "flex", alignItems: "center" }}>
      <div className="stack slide-up" style={{ gap: 24, width: "100%" }}>

        <div style={{ textAlign: "center" }}>
          <h1 style={{ marginBottom: 8 }}>Camera Setup</h1>
          <p className="dim" style={{ maxWidth: 420, margin: "0 auto" }}>
            Sit normally, look straight at the screen, then press Calibrate.
          </p>
        </div>

        {/* Live camera preview — always visible */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div style={{ position: "relative" }}>
            <video
              ref={videoRef}
              autoPlay muted playsInline
              style={{
                width: 320, aspectRatio: "4/3", objectFit: "cover",
                borderRadius: 12, transform: "scaleX(-1)",
                background: "#111", display: "block",
                border: `2px solid ${phase === "calibrating" ? "var(--accent)" : "var(--border)"}`,
                boxShadow: phase === "calibrating" ? "0 0 18px rgba(99,102,241,0.4)" : "none",
              }}
            />
            {/* Face status badge */}
            <div style={{
              position: "absolute", bottom: 10, left: 10,
              background: faceStatus.color === "var(--green)" ? "rgba(34,197,94,0.9)"
                : faceStatus.color === "var(--yellow)" ? "rgba(234,179,8,0.9)" : "rgba(107,114,128,0.9)",
              borderRadius: 6, padding: "3px 10px",
              fontSize: "0.7rem", fontWeight: 700, color: "#000",
            }}>
              {!ready ? "LOADING" : faceDetected ? "FACE OK" : "NO FACE"}
            </div>
          </div>
        </div>

        {/* Status message */}
        {statusMsg && (
          <p style={{ textAlign: "center", color: "var(--yellow)", fontSize: "0.85rem" }}>{statusMsg}</p>
        )}

        {/* Phase cards */}
        {phase === "intro" && (
          <div className="card" style={{ textAlign: "center" }}>
            <p style={{ marginBottom: 6, color: faceStatus.color, fontSize: "0.85rem" }}>
              {faceStatus.text}
            </p>
            <p className="dim" style={{ fontSize: "0.8rem", marginBottom: 20 }}>
              Look straight at the screen for 3 seconds while we record your neutral position.
            </p>
            <div className="stack" style={{ gap: 10 }}>
              <button
                className="btn-primary"
                style={{ fontSize: "1rem", padding: 14, opacity: ready && faceDetected ? 1 : 0.5 }}
                onClick={startCalibration}
              >
                {!ready ? "Loading…" : "Calibrate"}
              </button>
              <button className="btn-ghost" onClick={handleSkip}>
                Skip (no camera)
              </button>
            </div>
          </div>
        )}

        {phase === "calibrating" && (
          <div className="card" style={{ textAlign: "center" }}>
            <p style={{ marginBottom: 6 }} className="pulse">Hold still… recording neutral position</p>
            <p className="dim" style={{ fontSize: "0.8rem", marginBottom: 16 }}>
              {faceDetected ? "Face locked in ✓" : "⚠ Keep your face in frame"}
            </p>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%`, transition: "width 0.1s linear" }} />
            </div>
          </div>
        )}

        {phase === "success" && (
          <div className="card" style={{ textAlign: "center" }}>
            <CheckCircle size={40} color="var(--green)" style={{ margin: "0 auto 12px" }} />
            <h2>Calibrated!</h2>
            <p className="dim">Starting session…</p>
          </div>
        )}

        {phase === "fail" && (
          <div className="card" style={{ textAlign: "center" }}>
            <XCircle size={40} color="var(--yellow)" style={{ margin: "0 auto 12px" }} />
            <h2 style={{ marginBottom: 8 }}>Calibration failed</h2>
            <p className="dim" style={{ marginBottom: 20 }}>
              Not enough face samples collected. Make sure your face is visible for the full 3 seconds.
            </p>
            <div className="stack" style={{ gap: 10 }}>
              <button className="btn-primary" onClick={handleRetry}>Try Again</button>
              <button className="btn-ghost" onClick={handleSkip}>Continue without camera</button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
