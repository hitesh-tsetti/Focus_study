"""
Focus Assistant — FastAPI backend
WebSocket /ws/session  → real-time events during a session
REST endpoints         → session control and history
"""

import asyncio
import json
import sys
import os
from contextlib import asynccontextmanager

sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional

from sessions.manager import SessionManager
from analytics.insights import save_session, load_all_sessions, session_to_history_item

@asynccontextmanager
async def lifespan(app):
    global _event_queue
    _event_queue = asyncio.Queue(maxsize=200)
    asyncio.create_task(_event_dispatcher())
    yield

app = FastAPI(title="Focus Assistant", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# One global session manager; _ws_clients holds active WebSocket connections
_ws_clients: list[WebSocket] = []
_event_queue: asyncio.Queue = None  # initialised in lifespan


async def _broadcast(event: str, data: dict):
    msg = json.dumps({"event": event, "data": data})
    dead = []
    for ws in list(_ws_clients):
        try:
            await ws.send_text(msg)
        except Exception:
            dead.append(ws)
    for ws in dead:
        if ws in _ws_clients:
            _ws_clients.remove(ws)


def _on_session_event(event: str, data: dict):
    """Called from background threads — push to the asyncio queue."""
    if _event_queue:
        try:
            _event_queue.put_nowait((event, data))
        except asyncio.QueueFull:
            pass


manager = SessionManager(on_event=_on_session_event)


async def _event_dispatcher():
    """Drain the event queue and broadcast to all WebSocket clients."""
    while True:
        event, data = await _event_queue.get()
        await _broadcast(event, data)


# ------------------------------------------------------------------
# WebSocket
# ------------------------------------------------------------------

@app.websocket("/ws/session")
async def ws_session(websocket: WebSocket):
    await websocket.accept()
    _ws_clients.append(websocket)
    # Send current status immediately on connect
    try:
        status = manager.get_status()
        await websocket.send_text(json.dumps({"event": "status", "data": status}))
    except Exception:
        pass

    try:
        while True:
            # Keep alive; client can also send commands this way
            text = await websocket.receive_text()
            try:
                msg = json.loads(text)
                await _handle_ws_command(msg, websocket)
            except Exception:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        if websocket in _ws_clients:
            _ws_clients.remove(websocket)


async def _handle_ws_command(msg: dict, ws: WebSocket):
    cmd = msg.get("cmd")
    if cmd == "ping":
        await ws.send_text(json.dumps({"event": "pong"}))
    elif cmd == "status":
        await ws.send_text(json.dumps({"event": "status", "data": manager.get_status()}))
    elif cmd == "face_event":
        loop = asyncio.get_running_loop()
        loop.run_in_executor(None, manager.process_browser_face_event,
                             msg.get("face_detected", False), float(msg.get("yaw", 0.0)))


# ------------------------------------------------------------------
# Session REST endpoints
# ------------------------------------------------------------------

class CreateSessionRequest(BaseModel):
    task: str
    planned_minutes: int


@app.post("/api/session/create")
def create_session(req: CreateSessionRequest):
    try:
        session = manager.create_session(req.task, req.planned_minutes)
        return {"session_id": session.id, "state": session.state.value}
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/session/calibrate")
async def calibrate():
    """Start calibration (blocking ~2-3s). Returns success/failure."""
    loop = asyncio.get_event_loop()
    ok = await loop.run_in_executor(None, manager.calibrate)
    return {"success": ok}


@app.post("/api/session/skip-calibration")
def skip_calibration():
    manager.skip_calibration()
    return {"success": True}


class CalibrateOffsetRequest(BaseModel):
    yaw_offset: float

@app.post("/api/session/calibrate-browser")
def calibrate_browser(req: CalibrateOffsetRequest):
    """Accept calibration offset computed by the browser's face detector."""
    manager.set_browser_calibration(req.yaw_offset)
    return {"success": True}


@app.post("/api/session/end")
def end_session():
    try:
        analysis = manager.end_session()
        save_session(analysis)
        return analysis
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/session/status")
def get_status():
    return manager.get_status()


# ------------------------------------------------------------------
# History endpoints
# ------------------------------------------------------------------

@app.get("/api/history")
def get_history():
    sessions = load_all_sessions()
    return [session_to_history_item(s) for s in sessions]


@app.get("/api/history/{session_id}")
def get_session_detail(session_id: str):
    sessions = load_all_sessions()
    for s in sessions:
        if s.get("session_id") == session_id:
            return s
    raise HTTPException(404, "Session not found")


# ------------------------------------------------------------------
# Camera control
# ------------------------------------------------------------------

@app.post("/api/camera/start")
def start_camera():
    manager.ensure_camera_started()
    return {"success": True}


@app.get("/api/camera/snapshot")
def camera_snapshot():
    jpeg = manager.get_latest_frame_jpeg()
    if jpeg is None:
        raise HTTPException(503, "No frame available yet")
    return Response(content=jpeg, media_type="image/jpeg")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
