import { useEffect, useMemo, useRef, useState } from "react";
import { fetchMotorStatus, fetchVideoConfig, sendMotorCommand, uiWsUrl, videoWsUrl } from "./api";
import type { AiFrame, Detection, MotorStatus, VideoConfig } from "./types";

const EMPTY_STATUS: MotorStatus = {
  feed_running: false,
  cutter_down: false,
  last_action: "init"
};

const EMPTY_VIDEO: VideoConfig = {
  enabled: false,
  detail: "",
  device: "-",
  width: 0,
  height: 0,
  fps: 0,
  encoder: "-",
  bitrate_kbps: 0
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
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const signalRef = useRef<WebSocket | null>(null);

  const [motor, setMotor] = useState<MotorStatus>(EMPTY_STATUS);
  const [videoConfig, setVideoConfig] = useState<VideoConfig>(EMPTY_VIDEO);
  const [aiFrame, setAiFrame] = useState<AiFrame>({ timestamp: Date.now() / 1000, detections: [] });
  const [logLines, setLogLines] = useState<string[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [videoConnected, setVideoConnected] = useState(false);
  const [videoError, setVideoError] = useState<string>("");

  const connectionState = useMemo(() => (wsConnected ? "online" : "offline"), [wsConnected]);

  useEffect(() => {
    fetchMotorStatus().then(setMotor).catch(() => undefined);
    fetchVideoConfig()
      .then((config) => {
        setVideoConfig(config);
        if (!config.enabled) {
          setVideoError(config.detail || "Video backend unavailable");
          setLogLines((prev) => [`[ERR] ${config.detail || "Video backend unavailable"}`, ...prev].slice(0, 200));
        }
      })
      .catch((err) => {
        setVideoError("Failed to fetch video config");
        setLogLines((prev) => [`[ERR] video config failed: ${String(err)}`, ...prev].slice(0, 200));
      });
  }, []);

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

    canvas.width = video.videoWidth || videoConfig.width || 1280;
    canvas.height = video.videoHeight || videoConfig.height || 720;
    drawDetections(canvas, aiFrame.detections);
  }, [aiFrame, videoConfig.width, videoConfig.height]);

  useEffect(() => {
    return () => {
      signalRef.current?.close();
      peerRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (videoConfig.enabled && !signalRef.current && !videoConnected) {
      void startVideo();
    }
  }, [videoConfig.enabled, videoConnected]);

  async function startVideo() {
    if (signalRef.current || !videoConfig.enabled) {
      return;
    }

    setVideoError("");
    const peer = new RTCPeerConnection({ iceServers: [] });
    peerRef.current = peer;

    peer.ontrack = (event) => {
      if (videoRef.current) {
        videoRef.current.srcObject = event.streams[0];
        videoRef.current.onloadedmetadata = () => {
          const canvas = canvasRef.current;
          const video = videoRef.current;
          if (!canvas || !video) return;
          canvas.width = video.videoWidth || videoConfig.width || 1280;
          canvas.height = video.videoHeight || videoConfig.height || 720;
        };
      }
      setVideoConnected(true);
      setLogLines((prev) => ["[VIDEO] Track received", ...prev].slice(0, 200));
    };

    peer.onconnectionstatechange = () => {
      const state = peer.connectionState;
      setLogLines((prev) => [`[VIDEO] Peer state=${state}`, ...prev].slice(0, 200));
      if (state === "failed" || state === "disconnected" || state === "closed") {
        setVideoConnected(false);
      }
    };

    const ws = new WebSocket(videoWsUrl());
    signalRef.current = ws;

    ws.onopen = () => {
      setLogLines((prev) => ["[VIDEO] Signaling connected", ...prev].slice(0, 200));
    };

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data) as { type: string; sdp?: string; candidate?: string; sdpMLineIndex?: number; detail?: string; state?: string };
      try {
        if (msg.type === "offer" && msg.sdp) {
          await peer.setRemoteDescription({ type: "offer", sdp: msg.sdp });
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          ws.send(JSON.stringify({ type: "answer", sdp: answer.sdp }));
        } else if (msg.type === "ice" && msg.candidate) {
          await peer.addIceCandidate({ candidate: msg.candidate, sdpMLineIndex: msg.sdpMLineIndex ?? 0 });
        } else if (msg.type === "error") {
          setVideoError(msg.detail ?? "Video backend error");
          setLogLines((prev) => [`[ERR] ${msg.detail ?? "Video backend error"}`, ...prev].slice(0, 200));
        } else if (msg.type === "state") {
          setLogLines((prev) => [`[VIDEO] ${msg.state ?? "state"}`, ...prev].slice(0, 200));
        }
      } catch (err) {
        setVideoError("WebRTC negotiation failed");
        setLogLines((prev) => [`[ERR] WebRTC failed: ${String(err)}`, ...prev].slice(0, 200));
      }
    };

    ws.onclose = () => {
      signalRef.current = null;
      setVideoConnected(false);
      setLogLines((prev) => ["[VIDEO] Signaling disconnected", ...prev].slice(0, 200));
    };

    ws.onerror = () => {
      setVideoError("Video signaling failed");
      setLogLines((prev) => ["[ERR] Video signaling failed", ...prev].slice(0, 200));
    };

    peer.onicecandidate = (event) => {
      if (event.candidate && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "ice",
          candidate: event.candidate.candidate,
          sdpMLineIndex: event.candidate.sdpMLineIndex ?? 0
        }));
      }
    };
  }

  function stopVideo() {
    signalRef.current?.close();
    signalRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setVideoConnected(false);
    setLogLines((prev) => ["[VIDEO] Stream stopped", ...prev].slice(0, 200));
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
          <div>Source: <strong>{videoConfig.device}</strong></div>
          <div>Mode: <strong>{videoConfig.width}x{videoConfig.height}@{videoConfig.fps} {videoConfig.encoder}</strong></div>
          {!videoConfig.enabled ? <div style={{ color: "#9d3020", fontWeight: 600 }}>Backend video disabled: {videoConfig.detail || "unknown error"}</div> : null}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="primary" onClick={startVideo} disabled={videoConnected || !videoConfig.enabled}>Start Stream</button>
            <button onClick={stopVideo} disabled={!videoConnected && !signalRef.current}>Stop Stream</button>
          </div>
          {videoError ? <div style={{ color: "#9d3020", fontWeight: 600 }}>{videoError}</div> : null}
        </div>
      </section>

      <section className="grid">
        <div className="panel">
          <div className="header">
            <h2>Line Control</h2>
            <span className={`badge ${videoConnected ? "ok" : "warn"}`}>{videoConnected ? "streaming" : "idle"}</span>
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
          <div className="stat"><span>Video</span><strong>{videoConnected ? "Connected" : "Disconnected"}</strong></div>
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
