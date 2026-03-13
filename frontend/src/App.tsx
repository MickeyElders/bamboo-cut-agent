import { useEffect, useMemo, useRef, useState } from "react";
import { fetchMotorStatus, fetchSystemStatus, fetchVideoConfig, sendMotorCommand, uiWsUrl, videoWsUrl } from "./api";
import type { AiFrame, MotorStatus, SystemStatus, VideoConfig } from "./types";

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

const EMPTY_SYSTEM: SystemStatus = {
  raspberry_pi: {
    hostname: "raspberrypi",
    cpu_percent: null,
    memory_percent: null,
    uptime_seconds: null
  },
  canmv_connected: false,
  canmv_last_seen_seconds: null,
  canmv_fps: null,
  canmv_status: null
};

function drawDetections(canvas: HTMLCanvasElement, detections: AiFrame["detections"]) {
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

function formatPercent(value?: number | null) {
  return value == null ? "-" : `${value.toFixed(1)}%`;
}

function formatTemp(value?: number | null) {
  return value == null ? "-" : `${value.toFixed(1)} C`;
}

function formatSeconds(value?: number | null) {
  if (value == null) return "-";
  const total = Math.max(0, Math.floor(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const signalRef = useRef<WebSocket | null>(null);

  const [motor, setMotor] = useState<MotorStatus>(EMPTY_STATUS);
  const [systemStatus, setSystemStatus] = useState<SystemStatus>(EMPTY_SYSTEM);
  const [videoConfig, setVideoConfig] = useState<VideoConfig>(EMPTY_VIDEO);
  const [aiFrame, setAiFrame] = useState<AiFrame>({ timestamp: Date.now() / 1000, detections: [] });
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
        }
      })
      .catch(() => {
        setVideoError("Failed to fetch video config");
      });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSystemStatus() {
      try {
        const next = await fetchSystemStatus();
        if (!cancelled) {
          setSystemStatus(next);
        }
      } catch {
        if (!cancelled) {
          setVideoError((prev) => prev || "Failed to fetch system status");
        }
      }
    }

    void loadSystemStatus();
    const timer = window.setInterval(() => {
      void loadSystemStatus();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const ws = new WebSocket(uiWsUrl());
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data) as AiFrame;
      setAiFrame(data);
      setSystemStatus((prev) => ({
        ...prev,
        canmv_connected: true,
        canmv_last_seen_seconds: 0,
        canmv_fps: data.fps ?? prev.canmv_fps,
        canmv_status: data.canmv_status ?? prev.canmv_status
      }));
    };
    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => setWsConnected(false);
    ws.onerror = () => setWsConnected(false);

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
    peer.addTransceiver("video", { direction: "recvonly" });

    peer.ontrack = (event) => {
      if (videoRef.current) {
        videoRef.current.srcObject = event.streams[0];
        void videoRef.current.play().catch(() => {
          setVideoError("Video play failed");
        });
        videoRef.current.onloadedmetadata = () => {
          const canvas = canvasRef.current;
          const video = videoRef.current;
          if (!canvas || !video) return;
          canvas.width = video.videoWidth || videoConfig.width || 1280;
          canvas.height = video.videoHeight || videoConfig.height || 720;
        };
      }
      setVideoConnected(true);
    };

    peer.onconnectionstatechange = () => {
      const state = peer.connectionState;
      if (state === "failed" || state === "disconnected" || state === "closed") {
        setVideoConnected(false);
      }
    };

    const ws = new WebSocket(videoWsUrl());
    signalRef.current = ws;

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data) as { type: string; sdp?: string; candidate?: string; sdpMLineIndex?: number; detail?: string };
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
        }
      } catch {
        setVideoError("WebRTC negotiation failed");
      }
    };

    ws.onclose = () => {
      signalRef.current = null;
      setVideoConnected(false);
    };

    ws.onerror = () => {
      setVideoError("Video signaling failed");
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
  }

  async function handleMotorCommand(cmd: "feed_start" | "feed_stop" | "cutter_down" | "cutter_up" | "emergency_stop") {
    const status = await sendMotorCommand(cmd);
    setMotor(status);
  }

  return (
    <main className="app">
      <section className="panel vision-panel">
        <div className="header">
          <h2>Vision</h2>
          <span className={`badge ${connectionState === "online" ? "ok" : "warn"}`}>{connectionState}</span>
        </div>
        <div className="video-wrap hero-video">
          <video ref={videoRef} autoPlay playsInline muted />
          <canvas ref={canvasRef} className="overlay" />
        </div>
        <div className="vision-footer">
          <div className="spec-line">Source <strong>{videoConfig.device}</strong></div>
          <div className="spec-line">Mode <strong>{videoConfig.width}x{videoConfig.height}@{videoConfig.fps} {videoConfig.encoder}</strong></div>
          <div className="action-row">
            <button className="primary" onClick={startVideo} disabled={videoConnected || !videoConfig.enabled}>Reconnect Video</button>
            <button onClick={stopVideo} disabled={!videoConnected && !signalRef.current}>Stop Video</button>
          </div>
          {videoError ? <div className="error-text">{videoError}</div> : null}
        </div>
      </section>

      <aside className="sidebar">
        <section className="panel side-panel">
          <div className="header">
            <h2>Raspberry Pi</h2>
            <span className="badge ok">{systemStatus.raspberry_pi.hostname}</span>
          </div>
          <div className="stat"><span>CPU</span><strong>{formatPercent(systemStatus.raspberry_pi.cpu_percent)}</strong></div>
          <div className="stat"><span>Memory</span><strong>{formatPercent(systemStatus.raspberry_pi.memory_percent)}</strong></div>
          <div className="stat"><span>Uptime</span><strong>{formatSeconds(systemStatus.raspberry_pi.uptime_seconds)}</strong></div>
        </section>

        <section className="panel side-panel">
          <div className="header">
            <h2>CanMV</h2>
            <span className={`badge ${systemStatus.canmv_connected ? "ok" : "warn"}`}>{systemStatus.canmv_connected ? "online" : "offline"}</span>
          </div>
          <div className="stat"><span>CPU</span><strong>{formatPercent(systemStatus.canmv_status?.cpu_percent)}</strong></div>
          <div className="stat"><span>KPU</span><strong>{formatPercent(systemStatus.canmv_status?.kpu_percent)}</strong></div>
          <div className="stat"><span>Memory</span><strong>{formatPercent(systemStatus.canmv_status?.memory_percent)}</strong></div>
          <div className="stat"><span>Temp</span><strong>{formatTemp(systemStatus.canmv_status?.temperature_c)}</strong></div>
          <div className="stat"><span>FPS</span><strong>{systemStatus.canmv_fps?.toFixed(1) ?? "-"}</strong></div>
          <div className="stat"><span>Last Seen</span><strong>{formatSeconds(systemStatus.canmv_last_seen_seconds)}</strong></div>
        </section>

        <section className="panel side-panel">
          <div className="header">
            <h2>Machine</h2>
            <span className={`badge ${videoConnected ? "ok" : "warn"}`}>{videoConnected ? "streaming" : "idle"}</span>
          </div>
          <div className="stat"><span>Feed Motor</span><strong>{motor.feed_running ? "Running" : "Stopped"}</strong></div>
          <div className="stat"><span>Cutter</span><strong>{motor.cutter_down ? "Down" : "Up"}</strong></div>
          <div className="stat"><span>Last Action</span><strong>{motor.last_action}</strong></div>
          <div className="stat"><span>Detections</span><strong>{aiFrame.detections.length}</strong></div>
          <div className="controls controls-single">
            <button className="primary" onClick={() => handleMotorCommand("feed_start")}>Feed Start</button>
            <button onClick={() => handleMotorCommand("feed_stop")}>Feed Stop</button>
            <button className="primary" onClick={() => handleMotorCommand("cutter_down")}>Cutter Down</button>
            <button onClick={() => handleMotorCommand("cutter_up")}>Cutter Up</button>
            <button className="danger" onClick={() => handleMotorCommand("emergency_stop")}>Emergency Stop</button>
          </div>
        </section>
      </aside>
    </main>
  );
}
