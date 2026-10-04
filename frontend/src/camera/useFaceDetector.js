import { useEffect, useRef, useState, useCallback } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

// Singleton — only one landmarker needed across all components
let landmarkerInstance = null;
let landmarkerLoading = null;

async function getOrCreateLandmarker() {
  if (landmarkerInstance) return landmarkerInstance;
  if (landmarkerLoading) return landmarkerLoading;

  landmarkerLoading = (async () => {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );
    landmarkerInstance = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    return landmarkerInstance;
  })();

  return landmarkerLoading;
}

// Yaw from nose-eye geometry in normalized image coords.
// Multiplier 130 calibrated so ~15° real turn ≈ 15° output.
// Calibration step removes the neutral offset so absolute accuracy < relative consistency.
function estimateYaw(landmarks) {
  const nose = landmarks[1];
  const leftEye = landmarks[263];   // person's left eye outer corner (image right)
  const rightEye = landmarks[33];   // person's right eye outer corner (image left)
  const leftMouth = landmarks[287]; // left mouth corner
  const rightMouth = landmarks[57]; // right mouth corner

  const eyeSpan = Math.abs(leftEye.x - rightEye.x);
  if (eyeSpan < 0.05) return 0;

  const eyeCenter = (leftEye.x + rightEye.x) / 2;
  const mouthCenter = (leftMouth.x + rightMouth.x) / 2;

  // Blend nose and mouth signals for stability
  const noseOffset = nose.x - eyeCenter;
  const mouthOffset = mouthCenter - eyeCenter;
  const blended = noseOffset * 0.7 + mouthOffset * 0.3;

  return (blended / eyeSpan) * 130;
}

export function useFaceDetector() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const landmarkerRef = useRef(null);
  const onFrameRef = useRef(null); // callback(faceDetected, yaw)

  const [ready, setReady] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [yaw, setYaw] = useState(0);
  const [error, setError] = useState(null);

  const setOnFrame = useCallback((cb) => { onFrameRef.current = cb; }, []);

  useEffect(() => {
    let alive = true;

    async function init() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (!alive) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await new Promise(res => { video.onloadedmetadata = res; });
          video.play();
        }

        const lm = await getOrCreateLandmarker();
        if (!alive) return;
        landmarkerRef.current = lm;
        setReady(true);

        function detect() {
          if (!alive) return;
          const vid = videoRef.current;
          if (vid && vid.readyState >= 2 && landmarkerRef.current) {
            try {
              const result = landmarkerRef.current.detectForVideo(vid, performance.now());
              if (result.faceLandmarks?.length > 0) {
                const rawYaw = estimateYaw(result.faceLandmarks[0]);
                setFaceDetected(true);
                setYaw(rawYaw);
                onFrameRef.current?.(true, rawYaw);
              } else {
                setFaceDetected(false);
                onFrameRef.current?.(false, 0);
              }
            } catch {}
          }
          rafRef.current = requestAnimationFrame(detect);
        }
        rafRef.current = requestAnimationFrame(detect);

      } catch (e) {
        if (alive) setError(e.message || "Camera error");
      }
    }

    init();

    return () => {
      alive = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  return { videoRef, ready, faceDetected, yaw, error, setOnFrame };
}
