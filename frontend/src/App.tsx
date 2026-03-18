import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchCutConfig,
  fetchVideoConfig,
  saveCutConfig,
  sendMotorCommand,
  uiWsUrl,
  videoWsUrl
} from "./api";
import type { AiFrame, CutConfig, SystemStatus, VideoConfig } from "./types";

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

const DEFAULT_CUT_CONFIG: CutConfig = {
  line_ratio_x: 0.5,
  tolerance_ratio_x: 0.015,
  show_guide: false,
  min_hits: 3,
  hold_ms: 200
};

function drawVisionOverlay(
  canvas: HTMLCanvasElement,
  detections: AiFrame["detections"],
  cutConfig: CutConfig,
  cutRequest: boolean
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 2;
  ctx.font = "14px sans-serif";

  if (cutConfig.show_guide) {
    const lineX = Math.round(canvas.width * cutConfig.line_ratio_x);
    const tolPx = Math.max(1, Math.round(canvas.width * cutConfig.tolerance_ratio_x));

    ctx.strokeStyle = cutRequest ? "#f04a32" : "#ffd34d";
    ctx.lineWidth = cutRequest ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(lineX, 0);
    ctx.lineTo(lineX, canvas.height);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 211, 77, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(lineX - tolPx, 0);
    ctx.lineTo(lineX - tolPx, canvas.height);
    ctx.moveTo(lineX + tolPx, 0);
    ctx.lineTo(lineX + tolPx, canvas.height);
    ctx.stroke();
  }

  ctx.lineWidth = 2;
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
  return value == null ? "-" : `${value.toFixed(1)} 摄氏度`;
}

function formatSeconds(value?: number | null) {
  if (value == null) return "-";
  const total = Math.max(0, Math.floor(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

function formatRatio(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function deriveRunState(frame: AiFrame, videoConnected: boolean) {
  if (!videoConnected) {
    return { code: "video-offline", label: "视频离线", detail: "正在等待视频流和设备遥测数据。" };
  }
  if (frame.cut_request) {
    return { code: "position-ready", label: "到达切割位", detail: "CanMV 已报告当前竹段到达切割线位置。" };
  }
  if (frame.detections.length > 0) {
    return { code: "feeding", label: "识别中", detail: "CanMV 正在跟踪竹节并等待到达切割位。" };
  }
  return { code: "manual-ready", label: "待命", detail: "当前等待新的识别目标或控制指令。" };
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const signalRef = useRef<WebSocket | null>(null);
  const cutDirtyRef = useRef(false);

  const [systemStatus, setSystemStatus] = useState<SystemStatus>(EMPTY_SYSTEM);
  const [videoConfig, setVideoConfig] = useState<VideoConfig>(EMPTY_VIDEO);
  const [cutConfig, setCutConfig] = useState<CutConfig>(DEFAULT_CUT_CONFIG);
  const [cutDirty, setCutDirty] = useState(false);
  const [cutSaving, setCutSaving] = useState(false);
  const [cutError, setCutError] = useState("");
  const [motorError, setMotorError] = useState("");
  const [controlMode, setControlMode] = useState<"manual" | "auto">("manual");
  const [lightPendingCount, setLightPendingCount] = useState(16);
  const [lightDirty, setLightDirty] = useState(false);
  const [aiFrame, setAiFrame] = useState<AiFrame>({ timestamp: Date.now() / 1000, detections: [], cut_request: false });
  const [wsConnected, setWsConnected] = useState(false);
  const [videoConnected, setVideoConnected] = useState(false);
  const [videoError, setVideoError] = useState("");
  const manualMode = controlMode === "manual";
  const runState = useMemo(() => deriveRunState(aiFrame, videoConnected), [aiFrame, videoConnected]);

  const connectionState = useMemo(() => (wsConnected ? "在线" : "离线"), [wsConnected]);

  useEffect(() => {
    cutDirtyRef.current = cutDirty;
  }, [cutDirty]);

  useEffect(() => {
    fetchVideoConfig()
      .then((config) => {
        setVideoConfig(config);
        if (!config.enabled) {
          setVideoError(config.detail || "视频后端不可用");
        }
      })
      .catch(() => {
        setVideoError("获取视频配置失败");
      });
    fetchCutConfig()
      .then((config) => {
        setCutConfig(config);
        setCutDirty(false);
      })
      .catch(() => {
        setCutError("获取切割位配置失败");
      });
  }, []);

  useEffect(() => {
    const ws = new WebSocket(uiWsUrl());
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data) as
        | { type: "ai_frame"; payload: AiFrame }
        | { type: "system_status"; payload: SystemStatus };

      if (message.type === "ai_frame") {
        const data = message.payload;
        setAiFrame(data);
        setSystemStatus((prev) => ({
          ...prev,
          canmv_connected: true,
          canmv_last_seen_seconds: 0,
          canmv_fps: data.fps ?? prev.canmv_fps,
          canmv_status: data.canmv_status ?? prev.canmv_status
        }));
        if (!cutDirtyRef.current && data.cut_config) {
          setCutConfig(data.cut_config);
        }
        return;
      }

      if (message.type === "system_status") {
        setSystemStatus(message.payload);
      }
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
    drawVisionOverlay(canvas, aiFrame.detections, cutConfig, Boolean(aiFrame.cut_request));
  }, [aiFrame, cutConfig, videoConfig.width, videoConfig.height]);

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
          setVideoError("视频播放失败");
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
          setVideoError(msg.detail ?? "视频后端错误");
        }
      } catch {
        setVideoError("WebRTC 协商失败");
      }
    };

    ws.onclose = () => {
      signalRef.current = null;
      setVideoConnected(false);
    };

    ws.onerror = () => {
      setVideoError("视频信令连接失败");
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

  async function handleMotorCommand(
    cmd:
      | "mode_manual"
      | "mode_auto"
      | "feed_start"
      | "feed_stop"
      | "clamp_engage"
      | "clamp_release"
      | "cutter_down"
      | "cutter_up"
      | "light_on"
      | "light_off"
      | "light_set_count"
      | "emergency_stop"
  ,
    value?: number
  ) {
    setMotorError("");
    try {
      await sendMotorCommand(cmd, value);
      if (cmd === "mode_manual") {
        setControlMode("manual");
      } else if (cmd === "mode_auto") {
        setControlMode("auto");
      } else if (cmd === "light_set_count") {
        setLightDirty(false);
      } else if (cmd === "light_off") {
        setLightPendingCount(0);
        setLightDirty(false);
      }
    } catch (error) {
      setMotorError(error instanceof Error ? error.message : "控制命令执行失败");
    }
  }

  async function handleSaveCutConfig() {
    setCutSaving(true);
    setCutError("");
    try {
      const saved = await saveCutConfig(cutConfig);
      setCutConfig(saved);
      setCutDirty(false);
    } catch {
      setCutError("保存切割位配置失败");
    } finally {
      setCutSaving(false);
    }
  }

  function updateCutConfig<K extends keyof CutConfig>(key: K, value: CutConfig[K]) {
    setCutConfig((prev) => ({ ...prev, [key]: value }));
    setCutDirty(true);
  }

  async function handleApplyLightCount() {
    await handleMotorCommand("light_set_count", lightPendingCount);
  }

  return (
    <main className="app">
      <section className="panel vision-panel">
        <div className="header">
          <h2>视觉画面</h2>
          <span className={`badge ${connectionState === "在线" ? "ok" : "warn"}`}>{connectionState}</span>
        </div>
        <div className="video-wrap hero-video">
          <video ref={videoRef} autoPlay playsInline muted />
          <canvas ref={canvasRef} className="overlay" />
        </div>
        <div className="vision-footer">
          <div className={`run-banner run-${runState.code}`}>
            <div className="run-banner-title">{runState.label}</div>
            <div className="run-banner-detail">{runState.detail}</div>
          </div>
          <div className="process-strip">
            <div className={`process-step ${aiFrame.detections.length > 0 ? "active" : ""}`}>
              <span className="step-index">01</span>
              <span className="step-name">目标检测</span>
              <strong>{aiFrame.detections.length > 0 ? "进行中" : "等待中"}</strong>
            </div>
            <div className={`process-step ${aiFrame.cut_request ? "active" : ""}`}>
              <span className="step-index">02</span>
              <span className="step-name">切割位置</span>
              <strong>{aiFrame.cut_request ? "已到位" : "检测中"}</strong>
            </div>
            <div className={`process-step ${manualMode ? "active" : ""}`}>
              <span className="step-index">03</span>
              <span className="step-name">控制模式</span>
              <strong>{manualMode ? "手动" : "自动"}</strong>
            </div>
            <div className={`process-step ${lightPendingCount > 0 ? "active" : ""}`}>
              <span className="step-index">04</span>
              <span className="step-name">灯带设置</span>
              <strong>{lightPendingCount} / 16</strong>
            </div>
          </div>
          <div className="spec-line">视频源 <strong>{videoConfig.device}</strong></div>
          <div className="spec-line">视频模式 <strong>{videoConfig.width}x{videoConfig.height}@{videoConfig.fps} {videoConfig.encoder}</strong></div>
          <div className="spec-line">切割触发 <strong>{aiFrame.cut_request ? "已触发" : "空闲"}</strong></div>
          <div className="action-row">
            <button className="primary" onClick={startVideo} disabled={videoConnected || !videoConfig.enabled}>重连视频</button>
            <button onClick={stopVideo} disabled={!videoConnected && !signalRef.current}>停止视频</button>
          </div>
          {videoError ? <div className="error-text">{videoError}</div> : null}
        </div>
      </section>

      <aside className="sidebar">
        <section className="panel side-panel">
          <div className="header">
            <h2>树莓派</h2>
            <span className="badge ok">{systemStatus.raspberry_pi.hostname}</span>
          </div>
          <div className="stat"><span>CPU</span><strong>{formatPercent(systemStatus.raspberry_pi.cpu_percent)}</strong></div>
          <div className="stat"><span>内存</span><strong>{formatPercent(systemStatus.raspberry_pi.memory_percent)}</strong></div>
          <div className="stat"><span>运行时长</span><strong>{formatSeconds(systemStatus.raspberry_pi.uptime_seconds)}</strong></div>
        </section>

        <section className="panel side-panel">
          <div className="header">
            <h2>CanMV</h2>
            <span className={`badge ${systemStatus.canmv_connected ? "ok" : "warn"}`}>{systemStatus.canmv_connected ? "在线" : "离线"}</span>
          </div>
          <div className="stat"><span>CPU</span><strong>{formatPercent(systemStatus.canmv_status?.cpu_percent)}</strong></div>
          <div className="stat"><span>KPU</span><strong>{formatPercent(systemStatus.canmv_status?.kpu_percent)}</strong></div>
          <div className="stat"><span>内存</span><strong>{formatPercent(systemStatus.canmv_status?.memory_percent)}</strong></div>
          <div className="stat"><span>温度</span><strong>{formatTemp(systemStatus.canmv_status?.temperature_c)}</strong></div>
          <div className="stat"><span>FPS</span><strong>{systemStatus.canmv_fps?.toFixed(1) ?? "-"}</strong></div>
          <div className="stat"><span>最近上报</span><strong>{formatSeconds(systemStatus.canmv_last_seen_seconds)}</strong></div>
        </section>

        <section className="panel side-panel">
          <div className="header">
            <h2>切割位设置</h2>
            <span className={`badge ${cutDirty ? "warn" : "ok"}`}>{cutDirty ? "待应用" : "已应用"}</span>
          </div>
          <label className="toggle-row">
            <span>显示辅助线</span>
            <input
              type="checkbox"
              checked={cutConfig.show_guide}
              onChange={(event) => updateCutConfig("show_guide", event.target.checked)}
            />
          </label>
          <div className="slider-block">
            <div className="slider-head">
              <span>切割线位置</span>
              <strong>{formatRatio(cutConfig.line_ratio_x)}</strong>
            </div>
            <input
              className="slider"
              type="range"
              min="0"
              max="1"
              step="0.001"
              value={cutConfig.line_ratio_x}
              onChange={(event) => updateCutConfig("line_ratio_x", Number(event.target.value))}
            />
          </div>
          <div className="slider-block">
            <div className="slider-head">
              <span>触发容差带</span>
              <strong>{formatRatio(cutConfig.tolerance_ratio_x)}</strong>
            </div>
            <input
              className="slider"
              type="range"
              min="0.001"
              max="0.05"
              step="0.001"
              value={cutConfig.tolerance_ratio_x}
              onChange={(event) => updateCutConfig("tolerance_ratio_x", Number(event.target.value))}
            />
          </div>
          <div className="stat"><span>最少命中次数</span><strong>{cutConfig.min_hits}</strong></div>
          <div className="stat"><span>保持时间</span><strong>{cutConfig.hold_ms} ms</strong></div>
          <button className="primary wide" onClick={() => void handleSaveCutConfig()} disabled={cutSaving}>
            {cutSaving ? "保存中..." : "应用到 CanMV"}
          </button>
          {cutError ? <div className="error-text">{cutError}</div> : null}
        </section>

        <section className="panel side-panel">
          <div className="header">
            <h2>切割工位</h2>
            <span className={`badge ${videoConnected ? "ok" : "warn"}`}>{videoConnected ? "视频中" : "空闲"}</span>
          </div>
          <div className="mode-row">
            <button
              className={manualMode ? "primary mode-button" : "mode-button"}
              onClick={() => void handleMotorCommand("mode_manual")}
              disabled={manualMode}
            >
              手动
            </button>
            <button
              className={!manualMode ? "primary mode-button" : "mode-button"}
              onClick={() => void handleMotorCommand("mode_auto")}
              disabled={!manualMode}
            >
              自动
            </button>
          </div>
          <div className="machine-schema">
            <div className={`schema-node ${aiFrame.detections.length > 0 ? "active" : ""}`}>
              <span>视觉识别</span>
              <strong>{aiFrame.detections.length > 0 ? "运行中" : "等待中"}</strong>
            </div>
            <div className={`schema-link ${aiFrame.cut_request ? "active" : ""}`}>{">"}</div>
            <div className={`schema-node ${manualMode ? "active" : ""}`}>
              <span>控制模式</span>
              <strong>{manualMode ? "手动" : "自动"}</strong>
            </div>
            <div className={`schema-link ${lightPendingCount > 0 ? "active" : ""}`}>{">"}</div>
            <div className={`schema-node ${lightPendingCount > 0 ? "active" : ""}`}>
              <span>灯带预设</span>
              <strong>{lightPendingCount} / 16</strong>
            </div>
          </div>
          <div className="stat"><span>当前状态</span><strong>{runState.label}</strong></div>
          <div className="stat"><span>模式</span><strong>{manualMode ? "手动" : "自动"}</strong></div>
          <div className="stat"><span>识别状态</span><strong>{aiFrame.detections.length > 0 ? "已识别目标" : "无目标"}</strong></div>
          <div className="stat"><span>切割位信号</span><strong>{aiFrame.cut_request ? "到位" : "未到位"}</strong></div>
          <div className="stat"><span>灯带预设数量</span><strong>{lightPendingCount} / 16</strong></div>
          <div className="stat"><span>识别目标数</span><strong>{aiFrame.detections.length}</strong></div>
          <div className="slider-block">
            <div className="slider-head">
              <span>灯带点亮数量</span>
              <strong>{lightPendingCount} / 16</strong>
            </div>
            <input
              className="slider"
              type="range"
              min="0"
              max="16"
              step="1"
              value={lightPendingCount}
              disabled={!manualMode}
              onChange={(event) => {
                setLightPendingCount(Number(event.target.value));
                setLightDirty(true);
              }}
            />
          </div>
          <div className="controls controls-single">
            <button className="primary" onClick={() => void handleMotorCommand("feed_start")} disabled={!manualMode}>启动送料</button>
            <button onClick={() => void handleMotorCommand("feed_stop")} disabled={!manualMode}>停止送料</button>
            <button className="primary" onClick={() => void handleMotorCommand("clamp_engage")} disabled={!manualMode}>压紧夹持</button>
            <button onClick={() => void handleMotorCommand("clamp_release")} disabled={!manualMode}>释放夹持</button>
            <button className="primary" onClick={() => void handleMotorCommand("cutter_down")} disabled={!manualMode}>切刀下压</button>
            <button onClick={() => void handleMotorCommand("cutter_up")} disabled={!manualMode}>切刀抬起</button>
            <button className="primary" onClick={() => void handleApplyLightCount()} disabled={!manualMode || !lightDirty}>应用灯带设置</button>
            <button onClick={() => void handleMotorCommand("light_off")} disabled={!manualMode}>关灯</button>
            <button className="danger" onClick={() => void handleMotorCommand("emergency_stop")}>急停</button>
          </div>
          {motorError ? <div className="error-text">{motorError}</div> : null}
        </section>
      </aside>
    </main>
  );
}
