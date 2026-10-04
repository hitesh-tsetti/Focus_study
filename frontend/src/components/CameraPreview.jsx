import { useEffect, useRef, useState } from "react";

export default function CameraPreview({ width = 240, style = {}, active = true }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!active) {
      // Release camera so the backend (OpenCV) can take over
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      setAvailable(false);
      return;
    }

    navigator.mediaDevices.getUserMedia({ video: true })
      .then(stream => {
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setAvailable(true);
      })
      .catch(() => setAvailable(false));

    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [active]);

  if (!available) return null;

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      style={{
        width,
        aspectRatio: "4/3",
        objectFit: "cover",
        borderRadius: 10,
        transform: "scaleX(-1)",
        background: "#111",
        display: "block",
        ...style,
      }}
    />
  );
}
