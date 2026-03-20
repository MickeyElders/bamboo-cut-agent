import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyLightSettings,
  engageClamp,
  fetchCutConfig,
  fetchVideoConfig,
  releaseClamp,
  saveCutConfig,
  setAutoMode,
  setManualMode,
  signalEmergencyStop,
  startCutter,
  startFeed,
  stopCutter,
  stopFeed,
  switchLightOff,
  uiWsUrl,
  videoWsUrl
} from "./api";
import { ConfirmActionModal } from "./components/ConfirmActionModal";
import { CutSettingsModal } from "./components/CutSettingsModal";
import { DeviceControlPanel } from "./components/DeviceControlPanel";
import { LightSettingsModal } from "./components/LightSettingsModal";
import { ManualControlModal } from "./components/ManualControlModal";
import { SummaryTileGrid } from "./components/SummaryTileGrid";
import { SystemStatusStrip } from "./components/SystemStatusStrip";
import { VisionPanel } from "./components/VisionPanel";
import type { AiFrame, CutConfig, SystemStatus, VideoConfig } from "./types";
import {
  deriveRunState,
  formatRatio,
  getCutSummary,
  getLightSummary,
  hexToRgb
} from "./utils/ui";

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
  canmv_status: null,
  job_status: null
};

const DEFAULT_CUT_CONFIG: CutConfig = {
  line_ratio_x: 0.5,
  tolerance_ratio_x: 0.015,
  show_guide: false,
  min_hits: 3,
  hold_ms: 200
};

const DEFAULT_LIGHT = {
  count: 16,
  brightness: 255,
  color: "#ffffff"
};

type UiMessage =
  | { type: "ai_frame"; payload: AiFrame }
  | { type: "system_status"; payload: SystemStatus };

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
    const tolerancePx = Math.max(1, Math.round(canvas.width * cutConfig.tolerance_ratio_x));

    ctx.strokeStyle = cutRequest ? "#f04a32" : "#ffd34d";
    ctx.lineWidth = cutRequest ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(lineX, 0);
    ctx.lineTo(lineX, canvas.height);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 211, 77, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(lineX - tolerancePx, 0);
    ctx.lineTo(lineX - tolerancePx, canvas.height);
    ctx.moveTo(lineX + tolerancePx, 0);
    ctx.lineTo(lineX + tolerancePx, canvas.height);
    ctx.stroke();
  }

  for (const det of detections) {
    ctx.strokeStyle = "#2de26d";
    ctx.fillStyle = "#2de26d";
    ctx.strokeRect(det.x, det.y, det.w, det.h);
    ctx.fillText(`${det.label} ${(det.score * 100).toFixed(0)}%`, det.x + 4, Math.max(14, det.y - 6));
  }
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
  const [cutModalOpen, setCutModalOpen] = useState(false);
  const [cutError, setCutError] = useState("");
  const [controlError, setControlError] = useState("");
  const [controlMode, setControlMode] = useState<"manual" | "auto">("auto");
  const [lightCount, setLightCount] = useState(DEFAULT_LIGHT.count);
  const [lightBrightness, setLightBrightness] = useState(DEFAULT_LIGHT.brightness);
  const [lightColor, setLightColor] = useState(DEFAULT_LIGHT.color);
  const [lightModalOpen, setLightModalOpen] = useState(false);
  const [lightApplying, setLightApplying] = useState(false);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualConfirmOpen, setManualConfirmOpen] = useState(false);
  const [aiFrame, setAiFrame] = useState<AiFrame>({
    timestamp: Date.now() / 1000,
    detections: [],
    cut_request: false
  });
  const [wsConnected, setWsConnected] = useState(false);
  const [videoConnected, setVideoConnected] = useState(false);
  const [videoError, setVideoError] = useState("");

  const manualMode = controlMode === "manual";
  const runState = useMemo(() => deriveRunState(aiFrame, videoConnected), [aiFrame, videoConnected]);
  const connectionState = wsConnected ? "在线" : "离线";
  const cutSummary = useMemo(() => getCutSummary(cutConfig), [cutConfig]);
  const lightSummary = useMemo(
    () => getLightSummary(lightCount, lightBrightness, lightColor),
    [lightCount, lightBrightness, lightColor]
  );

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
    void runControl(setAutoMode, () => setControlMode("auto"));
  }, []);

  useEffect(() => {
    const ws = new WebSocket(uiWsUrl());

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data) as UiMessage;
      if (message.type === "ai_frame") {
        const frame = message.payload;
        setAiFrame(frame);
        setSystemStatus((prev) => ({
          ...prev,
          canmv_connected: true,
          canmv_last_seen_seconds: 0,
          canmv_fps: frame.fps ?? prev.canmv_fps,
          canmv_status: frame.canmv_status ?? prev.canmv_status
        }));
        if (!cutDirtyRef.current && frame.cut_config) {
          setCutConfig(frame.cut_config);
        }
        return;
      }

      setSystemStatus(message.payload);
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
    if (signalRef.current || !videoConfig.enabled) return;

    setVideoError("");
    const peer = new RTCPeerConnection({ iceServers: [] });
    peerRef.current = peer;
    peer.addTransceiver("video", { direction: "recvonly" });

    peer.ontrack = (event) => {
      if (videoRef.current) {
        videoRef.current.srcObject = event.streams[0];
        void videoRef.current.play().catch(() => setVideoError("视频播放失败"));
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
      if (["failed", "disconnected", "closed"].includes(peer.connectionState)) {
        setVideoConnected(false);
      }
    };

    const ws = new WebSocket(videoWsUrl());
    signalRef.current = ws;

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data) as {
        type: string;
        sdp?: string;
        candidate?: string;
        sdpMLineIndex?: number;
        detail?: string;
      };

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

    ws.onerror = () => setVideoError("视频信令连接失败");

    peer.onicecandidate = (event) => {
      if (event.candidate && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "ice",
            candidate: event.candidate.candidate,
            sdpMLineIndex: event.candidate.sdpMLineIndex ?? 0
          })
        );
      }
    };
  }

  async function runControl(action: () => Promise<unknown>, onSuccess?: () => void) {
    setControlError("");
    try {
      await action();
      onSuccess?.();
    } catch (error) {
      setControlError(error instanceof Error ? error.message : "控制命令执行失败");
    }
  }

  async function handleSaveCutConfig(closeAfterSave = false) {
    setCutSaving(true);
    setCutError("");
    try {
      const saved = await saveCutConfig(cutConfig);
      setCutConfig(saved);
      setCutDirty(false);
      if (closeAfterSave) {
        setCutModalOpen(false);
      }
    } catch {
      setCutError("保存切割位配置失败");
    } finally {
      setCutSaving(false);
    }
  }

  async function handleApplyLightSettings() {
    const { red, green, blue } = hexToRgb(lightColor);
    setLightApplying(true);
    try {
      await runControl(
        () => applyLightSettings(lightCount, lightBrightness, red, green, blue),
        () => setLightModalOpen(false)
      );
    } finally {
      setLightApplying(false);
    }
  }

  function updateCutConfig<K extends keyof CutConfig>(key: K, value: CutConfig[K]) {
    setCutConfig((prev) => ({ ...prev, [key]: value }));
    setCutDirty(true);
  }

  function resetLightDefaults() {
    setLightCount(DEFAULT_LIGHT.count);
    setLightBrightness(DEFAULT_LIGHT.brightness);
    setLightColor(DEFAULT_LIGHT.color);
  }

  function resetCutDefaults() {
    setCutConfig(DEFAULT_CUT_CONFIG);
    setCutDirty(true);
  }

  function handleRequestManualMode() {
    if (manualMode) {
      setManualModalOpen(true);
      return;
    }
    setManualConfirmOpen(true);
  }

  function handleConfirmManualMode() {
    setManualConfirmOpen(false);
    void runControl(setManualMode, () => {
      setControlMode("manual");
      setManualModalOpen(true);
    });
  }

  function handleReturnAutoMode() {
    void runControl(setAutoMode, () => {
      setControlMode("auto");
      setManualModalOpen(false);
      setManualConfirmOpen(false);
    });
  }

  return (
    <>
      <main className="app">
        <VisionPanel
          connectionState={connectionState}
          videoRef={videoRef}
          canvasRef={canvasRef}
          runState={runState}
          aiFrame={aiFrame}
          manualMode={manualMode}
          lightCount={lightCount}
          videoConfig={videoConfig}
          videoError={videoError}
          onOpenCutSettings={() => setCutModalOpen(true)}
          onOpenLightSettings={() => setLightModalOpen(true)}
          onOpenManual={handleRequestManualMode}
          onEmergencyStop={() => void runControl(signalEmergencyStop)}
        />

        <aside className="sidebar">
          <SystemStatusStrip status={systemStatus} />

          <section className="panel side-panel">
            <div className="header">
              <h2>切割信息</h2>
              <span className={`badge ${cutDirty ? "warn" : "ok"}`}>{cutDirty ? "待应用" : "已应用"}</span>
            </div>

            <div className="compact-info-list compact-info-warning">
              <div className="compact-info-row">
                <span>切割线</span>
                <strong>{formatRatio(cutConfig.line_ratio_x)}</strong>
                <span>容差带</span>
                <strong>{formatRatio(cutConfig.tolerance_ratio_x)}</strong>
              </div>
              <div className="compact-info-row">
                <span>命中次数</span>
                <strong>{cutConfig.min_hits}</strong>
                <span>保持时间</span>
                <strong>{cutConfig.hold_ms} ms</strong>
              </div>
            </div>

            <div className="summary-card summary-card-warning">
              <span>切割位</span>
              <strong>{cutSummary}</strong>
            </div>

            <div className="config-entry config-entry-warning" onClick={() => setCutModalOpen(true)} role="button" tabIndex={0}>
              <div className="config-entry-copy">
                <span className="config-entry-kicker">配置</span>
                <strong>切割位设置</strong>
                <p>位置、容差与触发条件。</p>
              </div>
              <div className="config-entry-action">
                <span className="config-entry-label">设置</span>
              </div>
            </div>
            {cutError ? <div className="error-text">{cutError}</div> : null}
          </section>

          <DeviceControlPanel
            aiFrame={aiFrame}
            systemStatus={systemStatus}
            runState={runState}
            manualMode={manualMode}
            videoConnected={videoConnected}
            lightCount={lightCount}
            lightBrightness={lightBrightness}
            lightColor={lightColor}
            lightSummary={lightSummary}
          />
        </aside>
      </main>

      <LightSettingsModal
        open={lightModalOpen}
        count={lightCount}
        brightness={lightBrightness}
        color={lightColor}
        applying={lightApplying}
        onCountChange={setLightCount}
        onBrightnessChange={setLightBrightness}
        onColorChange={setLightColor}
        onReset={resetLightDefaults}
        onClose={() => setLightModalOpen(false)}
        onApply={() => void handleApplyLightSettings()}
      />

      <CutSettingsModal
        open={cutModalOpen}
        cutConfig={cutConfig}
        cutDirty={cutDirty}
        cutSaving={cutSaving}
        onChange={updateCutConfig}
        onReset={resetCutDefaults}
        onClose={() => setCutModalOpen(false)}
        onApply={() => void handleSaveCutConfig(true)}
      />

      <ManualControlModal
        open={manualModalOpen}
        manualMode={manualMode}
        error={controlError}
        onExit={handleReturnAutoMode}
        onStartFeed={() => void runControl(startFeed)}
        onStopFeed={() => void runControl(stopFeed)}
        onEngageClamp={() => void runControl(engageClamp)}
        onReleaseClamp={() => void runControl(releaseClamp)}
        onStartCutter={() => void runControl(startCutter)}
        onStopCutter={() => void runControl(stopCutter)}
      />

      <ConfirmActionModal
        open={manualConfirmOpen}
        title="进入手动调试"
        description="进入手动模式后，设备将退出自动运行。该模式仅用于安装调试，确认继续吗？"
        confirmLabel="确认进入手动"
        onConfirm={handleConfirmManualMode}
        onCancel={() => setManualConfirmOpen(false)}
      />
    </>
  );
}
