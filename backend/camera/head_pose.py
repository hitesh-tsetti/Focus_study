"""
Head pose estimation using MediaPipe Face Landmarker (Tasks API, v1.0+).
Estimates yaw (left/right) rotation to determine if user is looking at screen.
All processing is local — no video is stored or transmitted.
"""

import threading
import time
import math
import os
import cv2
import numpy as np

import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
from mediapipe.tasks.python.vision import RunningMode

# Path to the bundled model file
MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "face_landmarker.task")

# Default thresholds
FACE_GRACE_PERIOD = 2.0       # seconds before flagging face not detected
HEAD_TURN_THRESHOLD = 15.0    # degrees yaw
HEAD_TURN_DURATION = 2.0      # seconds sustained turn before flagging


def _estimate_yaw(landmarks, img_w, img_h):
    """
    Estimate head yaw via PnP solve using 6 stable landmarks.
    Returns yaw in degrees (positive = right, negative = left).
    """
    # 3D canonical face model points (in mm)
    model_points = np.array([
        (0.0,   0.0,    0.0),      # Nose tip — index 1
        (0.0,  -330.0, -65.0),     # Chin — index 152
        (-225.0, 170.0, -135.0),   # Left eye left corner — index 263
        (225.0,  170.0, -135.0),   # Right eye right corner — index 33
        (-150.0, -150.0, -125.0),  # Left mouth corner — index 287
        (150.0,  -150.0, -125.0),  # Right mouth corner — index 57
    ], dtype=np.float64)

    lm = landmarks
    h, w = img_h, img_w

    def pt(idx):
        return (lm[idx].x * w, lm[idx].y * h)

    image_points = np.array([
        pt(1), pt(152), pt(263), pt(33), pt(287), pt(57),
    ], dtype=np.float64)

    focal_length = w
    camera_matrix = np.array([
        [focal_length, 0, w / 2],
        [0, focal_length, h / 2],
        [0, 0, 1],
    ], dtype=np.float64)
    dist_coeffs = np.zeros((4, 1))

    success, rotation_vec, _ = cv2.solvePnP(
        model_points, image_points, camera_matrix, dist_coeffs,
        flags=cv2.SOLVEPNP_ITERATIVE,
    )
    if not success:
        return 0.0

    rmat, _ = cv2.Rodrigues(rotation_vec)
    sy = math.sqrt(rmat[0, 0] ** 2 + rmat[1, 0] ** 2)
    if sy > 1e-6:
        yaw = math.atan2(rmat[1, 0], rmat[0, 0])
    else:
        yaw = math.atan2(-rmat[1, 2], rmat[1, 1])

    return math.degrees(yaw)


class CameraMonitor:
    """
    Runs webcam capture + head pose estimation in a background thread.
    Calls callbacks for face state changes, yaw updates, and violations.
    """

    def __init__(
        self,
        on_face_state=None,
        on_yaw_update=None,
        on_looking_away=None,
        on_looking_back=None,
        yaw_threshold=HEAD_TURN_THRESHOLD,
        turn_duration=HEAD_TURN_DURATION,
        face_grace=FACE_GRACE_PERIOD,
    ):
        self.on_face_state = on_face_state or (lambda s: None)
        self.on_yaw_update = on_yaw_update or (lambda y: None)
        self.on_looking_away = on_looking_away or (lambda: None)
        self.on_looking_back = on_looking_back or (lambda: None)

        self.yaw_threshold = yaw_threshold
        self.turn_duration = turn_duration
        self.face_grace = face_grace

        self._thread = None
        self._stop_event = threading.Event()
        self._lock = threading.Lock()

        self.face_detected = False
        self.current_yaw = 0.0
        self.looking_away = False
        self.calibrated = False
        self.calibration_yaw_offset = 0.0

        self._face_lost_at = None
        self._turn_started_at = None
        self._face_lost_notified = False

        self._latest_frame_jpeg: bytes = None
        self._frame_lock = threading.Lock()

    def start(self, camera_index=0):
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, args=(camera_index,), daemon=True)
        self._thread.start()

    def stop(self):
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=3.0)

    def calibrate(self, samples=30):
        """Collect yaw readings and set median as offset. Returns True on success."""
        readings = []
        deadline = time.time() + 5.0
        while len(readings) < samples and time.time() < deadline:
            with self._lock:
                if self.face_detected:
                    readings.append(self.current_yaw)
            time.sleep(0.05)

        if len(readings) >= 10:
            self.calibration_yaw_offset = float(np.median(readings))
            self.calibrated = True
            return True
        return False

    def get_latest_frame_jpeg(self) -> bytes:
        with self._frame_lock:
            return self._latest_frame_jpeg

    def get_status(self):
        with self._lock:
            return {
                "face_detected": self.face_detected,
                "yaw": round(self.current_yaw - self.calibration_yaw_offset, 1),
                "raw_yaw": round(self.current_yaw, 1),
                "looking_away": self.looking_away,
                "calibrated": self.calibrated,
                "threshold": self.yaw_threshold,
            }

    # ------------------------------------------------------------------

    def _run(self, camera_index):
        model_path = os.path.abspath(MODEL_PATH)
        if not os.path.exists(model_path):
            self.on_face_state("camera_error")
            return

        options = mp_vision.FaceLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=model_path),
            running_mode=RunningMode.VIDEO,
            num_faces=1,
            min_face_detection_confidence=0.5,
            min_face_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )

        cap = cv2.VideoCapture(camera_index)
        if not cap.isOpened():
            self.on_face_state("camera_error")
            return

        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

        with mp_vision.FaceLandmarker.create_from_options(options) as landmarker:
            frame_ts_ms = 0
            while not self._stop_event.is_set():
                ret, frame = cap.read()
                if not ret:
                    time.sleep(0.03)
                    continue

                # Store latest frame for the snapshot endpoint (mirrored so it looks natural)
                try:
                    display = cv2.flip(frame, 1)
                    _, buf = cv2.imencode(".jpg", display, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
                    with self._frame_lock:
                        self._latest_frame_jpeg = buf.tobytes()
                except Exception:
                    pass

                h, w = frame.shape[:2]
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                mp_image = mp.Image(
                    image_format=mp.ImageFormat.SRGB,
                    data=rgb,
                )
                frame_ts_ms += 33  # ~30 fps

                result = landmarker.detect_for_video(mp_image, frame_ts_ms)
                now = time.time()

                if result.face_landmarks:
                    lm = result.face_landmarks[0]
                    self._process_face(lm, w, h, now)
                else:
                    self._process_no_face(now)

                time.sleep(0.033)

        cap.release()

    def _process_face(self, landmarks, w, h, now):
        yaw = _estimate_yaw(landmarks, w, h)

        with self._lock:
            prev_detected = self.face_detected
            self.face_detected = True
            self.current_yaw = yaw
            self._face_lost_at = None
            self._face_lost_notified = False

        if not prev_detected:
            self.on_face_state("detected")

        adjusted = yaw - self.calibration_yaw_offset
        self.on_yaw_update(round(adjusted, 1))
        self._update_turn_state(abs(adjusted) > self.yaw_threshold, now)

    def _process_no_face(self, now):
        notify = False
        with self._lock:
            if self._face_lost_at is None:
                self._face_lost_at = now
            elapsed = now - self._face_lost_at
            if elapsed > self.face_grace and not self._face_lost_notified:
                self.face_detected = False
                self._face_lost_notified = True
                self._turn_started_at = None
                was_away = self.looking_away
                self.looking_away = False
                notify = True

        if notify:
            self.on_face_state("lost")

    def _update_turn_state(self, is_away, now):
        do_away = False
        do_back = False

        with self._lock:
            if is_away:
                if self._turn_started_at is None:
                    self._turn_started_at = now
                elapsed = now - self._turn_started_at
                if elapsed >= self.turn_duration and not self.looking_away:
                    self.looking_away = True
                    do_away = True
            else:
                was_away = self.looking_away
                self._turn_started_at = None
                self.looking_away = False
                do_back = was_away

        if do_away:
            self.on_looking_away()
        elif do_back:
            self.on_looking_back()
