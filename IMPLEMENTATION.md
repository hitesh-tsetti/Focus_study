# Focus — Implementation Plan

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.14 + FastAPI + Uvicorn |
| Camera | MediaPipe Face Landmarker (Tasks API 1.0) + OpenCV |
| Activity | psutil + pywin32 (Windows) |
| Storage | JSON files in `data/` |
| Frontend | React 18 + Vite + React Router |
| Comms | WebSocket (real-time) + REST (control) |

## Architecture

```
Frontend (React)
    │  HTTP REST + WebSocket
    ▼
FastAPI Backend (main.py)
    │
    ├── SessionManager (sessions/manager.py)
    │       ├── CameraMonitor (camera/head_pose.py)  → MediaPipe
    │       └── ActivityTracker (activity/tracker.py) → win32gui
    │
    └── Analytics (analytics/insights.py)  → JSON storage
```

## Milestone Status

- [x] **M1** — MediaPipe face landmarker + head pose (yaw via PnP)
- [x] **M2** — Temporal filtering (2s grace period, 15° threshold)
- [x] **M3** — Session manager (IDLE → CALIBRATING → ACTIVE → ENDED)
- [x] **M4** — App activity tracking (win32gui + psutil)
- [x] **M5** — Browser domain tracking (window title parsing, no extension)
- [x] **M6** — Session analysis (app summary, category, distraction %)
- [x] **M7** — Dashboard + History pages
- [ ] **M8** — Demo polish (strike sound, richer insights)

## Configuration Defaults

| Setting | Default |
|---------|---------|
| Yaw threshold | ±15° |
| Sustained turn before flagging | 2 seconds |
| Face grace period | 2 seconds |
| Max strikes | 3 |

## Running

```bash
# Terminal 1 — backend
cd backend
python main.py

# Terminal 2 — frontend
cd frontend
npm run dev
```

Frontend: http://localhost:5173
Backend:  http://localhost:8000

## Privacy

- Camera frames processed in-RAM only — never written to disk
- No screenshots, no keystrokes, no page content collected
- Only metadata stored: app name, domain, duration, timestamp, strikes
- All data stays on the user's device (data/ folder)

## Known Limitations / MVP Notes

- Browser domain tracking reads window titles only (no extension)
  - Accuracy: ~80% — some titles don't include domain
- Camera requires good lighting and frontal positioning
- Windows-only for activity tracking (win32gui)
- Face landmarker model file (`face_landmarker.task`) must be present in `backend/`
