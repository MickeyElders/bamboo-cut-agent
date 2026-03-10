import { useEffect, useMemo, useRef, useState } from "react";
import { fetchMotorStatus, sendMotorCommand, uiWsUrl } from "./api";
import type { AiFrame, Detection, MotorStatus } from "./types";

const EMPTY_STATUS: MotorStatus = {
  feed_running: false,
  cutter_down: false,
  last_action: "init"
};

function drawDetections(canvas: HTMLCanvasElement, detections: Detection[]) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 2;
  ctx.font = "14px sans-serif";

  for (const det of detections) {
    ctx.strokeStyle = "#2de26d";
    ctx.fillStyle = "#2de26d";
    ctx.strokeRect(det.x, det.y, det.w, det.h);
    const label = `${det.label} ${(det.score * 100).toFixed(0)}%`;
    ctx.fillText(label, det.x + 4, Math.max(14, det.y - 6));
  }
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [motor, setMotor] = useState<MotorStatus>(EMPTY_STATUS);
  const [aiFrame, setAiFrame] = useState<AiFrame>({ timestamp: Date.now() / 1000, detections: [] });
  const [logLines, setLogLines] = useState<string[]>([]);
  const [cameraOn, setCameraOn] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const [cameraError, setCameraError] = useState<string>("");

  const connectionState = useMemo(() => (wsConnected ? "online" : "offline"), [wsConnected]);

  useEffect(() => {
    fetchMotorStatus().then(setMotor).catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;

    async function loadDevices() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter((d) => d.kind === "videoinput");
        if (!active) return;
        setCameraDevices(cams);
        if (!selectedCameraId && cams.length > 0) {
          setSelectedCameraId(cams[0].deviceId);
        }
      } catch (err) {
        if (!active) return;
        setCameraError("Failed to enumerate cameras");
        setLogLines((prev) => [`[ERR] enumerateDevices failed: ${String(err)}`, ...prev].slice(0, 200));
      }
    }

    loadDevices();
    const handler = () => loadDevices();
    if (navigator.mediaDevices && "addEventListener" in navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener("devicechange", handler);
    }

    return () => {
      active = false;
      if (navigator.mediaDevices && "removeEventListener" in navigator.mediaDevices) {
        navigator.mediaDevices.removeEventListener("devicechange", handler);
      }
    };
  }, [selectedCameraId]);

  useEffect(() => {
    const ws = new WebSocket(uiWsUrl());
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data) as AiFrame;
      setAiFrame(data);
      setLogLines((prev) => [`[AI] ${new Date().toLocaleTimeString()} detections=${data.detections.length}`, ...prev].slice(0, 200));
    };
    ws.onopen = () => {
      setWsConnected(true);
      setLogLines((prev) => ["[SYS] UI websocket connected", ...prev].slice(0, 200));
    };
    ws.onclose = () => {
      setWsConnected(false);
      setLogLines((prev) => ["[SYS] UI websocket disconnected", ...prev].slice(0, 200));
    };
    ws.onerror = () => setLogLines((prev) => ["[ERR] UI websocket error", ...prev].slice(0, 200));

    return () => {
      setWsConnected(false);
      ws.close();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const syncCanvas = () => {
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      drawDetections(canvas, aiFrame.detections);
    };

    syncCanvas();
  }, [aiFrame]);

  async function startCamera() {
    try {
      setCameraError("");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: selectedCameraId ? { exact: selectedCameraId } : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 15, max: 30 }
        },
        audio: false
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          const canvas = canvasRef.current;
          const video = videoRef.current;
          if (!canvas || !video) return;
          canvas.width = video.videoWidth || 1280;
          canvas.height = video.videoHeight || 720;
        };
      }

      setCameraOn(true);
      setLogLines((prev) => ["[SYS] Camera started", ...prev].slice(0, 200));
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCameraDevices(devices.filter((d) => d.kind === "videoinput"));
    } catch {
      setCameraError("Camera start failed");
      setLogLines((prev) => ["[ERR] Camera start failed", ...prev].slice(0, 200));
    }
  }

  async function handleMotorCommand(cmd: "feed_start" | "feed_stop" | "cutter_down" | "cutter_up" | "emergency_stop") {
    const status = await sendMotorCommand(cmd);
    setMotor(status);
    setLogLines((prev) => [`[MOTOR] ${cmd}`, ...prev].slice(0, 200));
  }

  return (
    <main className="app">
      <section className="panel">
        <div className="header">
          <h2>Vision</h2>
          <span className={`badge ${connectionState === "online" ? "ok" : "warn"}`}>{connectionState}</span>
        </div>
        <div className="video-wrap">
          <video ref={videoRef} autoPlay playsInline muted />
          <canvas ref={canvasRef} className="overlay" />
        </div>
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <label>
            Camera
            <select
              style={{ marginLeft: 8 }}
              value={selectedCameraId}
              onChange={(e) => setSelectedCameraId(e.target.value)}
            >
              {cameraDevices.length === 0 && <option value="">No cameras</option>}
              {cameraDevices.map((d, idx) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Camera ${idx + 1}`}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" onClick={startCamera} disabled={cameraOn}>Enable USB Camera</button>
          {cameraError ? <div style={{ color: "#9d3020", fontWeight: 600 }}>{cameraError}</div> : null}
        </div>
      </section>

      <section className="grid">
        <div className="panel">
          <div className="header">
            <h2>Line Control</h2>
            <span className="badge ok">ready</span>
          </div>
          <div className="controls">
            <button className="primary" onClick={() => handleMotorCommand("feed_start")}>Feed Start</button>
            <button onClick={() => handleMotorCommand("feed_stop")}>Feed Stop</button>
            <button className="primary" onClick={() => handleMotorCommand("cutter_down")}>Cutter Down</button>
            <button onClick={() => handleMotorCommand("cutter_up")}>Cutter Up</button>
            <button className="danger" onClick={() => handleMotorCommand("emergency_stop")}>Emergency Stop</button>
          </div>
        </div>

        <div className="panel">
          <div className="header"><h2>Status</h2></div>
          <div className="stat"><span>Feed Motor</span><strong>{motor.feed_running ? "Running" : "Stopped"}</strong></div>
          <div className="stat"><span>Cutter</span><strong>{motor.cutter_down ? "Down" : "Up"}</strong></div>
          <div className="stat"><span>Last Action</span><strong>{motor.last_action}</strong></div>
          <div className="stat"><span>AI FPS</span><strong>{aiFrame.fps?.toFixed(1) ?? "-"}</strong></div>
          <div className="stat"><span>Detections</span><strong>{aiFrame.detections.length}</strong></div>
        </div>

        <div className="panel">
          <div className="header"><h2>Event Log</h2></div>
          <div className="log">
            {logLines.map((line, idx) => (
              <div key={idx}>{line}</div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
