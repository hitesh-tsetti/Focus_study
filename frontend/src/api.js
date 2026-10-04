const BASE = "http://localhost:8000";

export async function createSession(task, planned_minutes) {
  const res = await fetch(`${BASE}/api/session/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task, planned_minutes }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function calibrateSession(signal) {
  const res = await fetch(`${BASE}/api/session/calibrate`, { method: "POST", signal });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function calibrateWithOffset(yawOffset) {
  const res = await fetch(`${BASE}/api/session/calibrate-browser`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ yaw_offset: yawOffset }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function skipCalibration() {
  const res = await fetch(`${BASE}/api/session/skip-calibration`, { method: "POST" });
  return res.json();
}

export async function endSession() {
  const res = await fetch(`${BASE}/api/session/end`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getHistory() {
  const res = await fetch(`${BASE}/api/history`);
  return res.json();
}

export async function getSessionDetail(id) {
  const res = await fetch(`${BASE}/api/history/${id}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function createWebSocket(onMessage) {
  let ws;
  let closed = false;
  let retries = 0;

  function connect() {
    ws = new WebSocket("ws://localhost:8000/ws/session");
    ws.onmessage = (e) => {
      try { onMessage(JSON.parse(e.data)); } catch {}
    };
    ws.onerror = () => {};
    ws.onopen = () => { retries = 0; };
    ws.onclose = () => {
      if (closed) return;
      const delay = Math.min(500 * 2 ** retries, 8000);
      retries++;
      setTimeout(connect, delay);
    };
  }

  connect();
  return {
    close() { closed = true; ws?.close(); },
    send(data) { if (ws?.readyState === 1) ws.send(data); },
    get _rawWs() { return ws; },
  };
}
