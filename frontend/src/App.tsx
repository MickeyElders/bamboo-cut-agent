import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyLightSettings,
  engageClamp,
  executeSystemAction,
  fetchCutterAxis,
  fetchCutConfig,
  fetchSystemEvents,
  fetchSystemMaintenance,
  fetchVideoConfig,
  releaseClamp,
  resetFault,
  saveCutterAxis,
  saveCutConfig,
  setAutoMode,
  setManualMode,
  signalEmergencyStop,
  startCutter,
  startFeed,
  setCutterAxisZero,
  stopCutter,
  stopFeed,
  uiWsUrl,
  videoWsUrl,
} from "./api";
import { ConfirmActionModal } from "./components/ConfirmActionModal";
import { CutSettingsModal } from "./components/CutSettingsModal";
import { DeviceControlPanel } from "./components/DeviceControlPanel";
import { EventHistoryModal } from "./components/EventHistoryModal";
import { LightSettingsModal } from "./components/LightSettingsModal";
import { ManualControlModal } from "./components/ManualControlModal";
import { SystemMaintenanceModal } from "./components/SystemMaintenanceModal";
import { SystemStatusStrip } from "./components/SystemStatusStrip";
import { VisionPanel } from "./components/VisionPanel";
import type { AiFrame, CutConfig, CutterAxisState, EventItem, SystemMaintenanceSnapshot, SystemStatus, VideoConfig } from "./types";
import { deriveRunState, formatRatio, getCutSummary, getLightSummary, hexToRgb } from "./utils/ui";

const EMPTY_VIDEO: VideoConfig = {
  enabled: false,
  detail: "",
  device: "-",
  width: 0,
  height: 0,
  fps: 0,
  encoder: "-",
  bitrate_kbps: 0,
};

const EMPTY_SYSTEM: SystemStatus = {
  raspberry_pi: {
    hostname: "raspberrypi",
    cpu_percent: null,
    memory_percent: null,
    uptime_seconds: null,
  },
  canmv_connected: false,
  canmv_last_seen_seconds: null,
  canmv_fps: null,
  canmv_status: null,
  job_status: null,
};

const DEFAULT_CUT_CONFIG: CutConfig = {
  line_ratio_x: 0.5,
  tolerance_ratio_x: 0.015,
  show_guide: false,
  min_hits: 3,
  hold_ms: 200,
};

const DEFAULT_LIGHT = {
  count: 16,
  brightness: 255,
  color: "#ffffff",
};

const DEFAULT_CUTTER_AXIS: CutterAxisState = {
  position_known: false,
  current_position_mm: 0,
  stroke_up_mm: null,
  stroke_down_mm: null,
};

type UiMessage = { type: "ai_frame"; payload: AiFrame } | { type: "system_status"; payload: SystemStatus };

function drawVisionOverlay(
  canvas: HTMLCanvasElement,
  detections: AiFrame["detections"],
  cutConfig: CutConfig,
  cutRequest: boolean,
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
  const aiFrameRef = useRef<AiFrame>({
    timestamp: Date.now() / 1000,
    detections: [],
    cut_request: false,
  });
  const cutConfigRef = useRef<CutConfig>(DEFAULT_CUT_CONFIG);
  const videoConfigRef = useRef<VideoConfig>(EMPTY_VIDEO);
  const overlayFrameRef = useRef<number | null>(null);
  const aiFrameUiPendingRef = useRef<number | null>(null);

  const [systemStatus, setSystemStatus] = useState<SystemStatus>(EMPTY_SYSTEM);
  const [systemMaintenance, setSystemMaintenance] = useState<SystemMaintenanceSnapshot | null>(null);
  const [systemEvents, setSystemEvents] = useState<EventItem[]>([]);
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [eventLoading, setEventLoading] = useState(false);
  const [eventError, setEventError] = useState("");
  const [faultResetConfirmOpen, setFaultResetConfirmOpen] = useState(false);
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
  const [manualModeSwitching, setManualModeSwitching] = useState(false);
  const [manualModeError, setManualModeError] = useState("");
  const [cutterAxis, setCutterAxis] = useState<CutterAxisState>(DEFAULT_CUTTER_AXIS);
  const [cutterStrokeUpInput, setCutterStrokeUpInput] = useState("");
  const [cutterStrokeDownInput, setCutterStrokeDownInput] = useState("");
  const [cutterZeroing, setCutterZeroing] = useState(false);
  const [cutterSaving, setCutterSaving] = useState(false);
  const [systemModalOpen, setSystemModalOpen] = useState(false);
  const [systemLoading, setSystemLoading] = useState(false);
  const [systemApplyingAction, setSystemApplyingAction] = useState<string | null>(null);
  const [systemError, setSystemError] = useState("");
  const [systemConfirmAction, setSystemConfirmAction] = useState<string | null>(null);
  const [aiFrame, setAiFrame] = useState<AiFrame>({
    timestamp: Date.now() / 1000,
    detections: [],
    cut_request: false,
  });
  const [wsConnected, setWsConnected] = useState(false);
  const [videoConnected, setVideoConnected] = useState(false);
  const [videoError, setVideoError] = useState("");

  const manualMode = controlMode === "manual";
  const runState = useMemo(() => deriveRunState(aiFrame, videoConnected), [aiFrame, videoConnected]);
  const connectionState = wsConnected ? "在线" : "离线";
  const cutSummary = useMemo(() => getCutSummary(cutConfig), [cutConfig]);
  const lightSummary = useMemo(() => getLightSummary(lightCount, lightBrightness, lightColor), [lightCount, lightBrightness, lightColor]);

  useEffect(() => {
    cutDirtyRef.current = cutDirty;
  }, [cutDirty]);

  useEffect(() => {
    aiFrameRef.current = aiFrame;
  }, [aiFrame]);

  useEffect(() => {
    cutConfigRef.current = cutConfig;
  }, [cutConfig]);

  useEffect(() => {
    videoConfigRef.current = videoConfig;
  }, [videoConfig]);

  useEffect(() => {
    fetchVideoConfig()
      .then((config) => {
        setVideoConfig(config);
        if (!config.enabled) {
          setVideoError(config.detail || "视频服务不可用");
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
        setCutError("获取切割配置失败");
      });

    fetchCutterAxis()
      .then((state) => {
        setCutterAxis(state);
        setCutterStrokeUpInput(state.stroke_up_mm != null ? String(state.stroke_up_mm) : "");
        setCutterStrokeDownInput(state.stroke_down_mm != null ? String(state.stroke_down_mm) : "");
      })
      .catch(() => {
        setControlError("获取刀轴位置失败");
      });

    void loadSystemMaintenance();
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
        aiFrameRef.current = frame;
        if (aiFrameUiPendingRef.current === null) {
          aiFrameUiPendingRef.current = window.setTimeout(() => {
            aiFrameUiPendingRef.current = null;
            setAiFrame(aiFrameRef.current);
          }, 50);
        }
        setSystemStatus((prev) => ({
          ...prev,
          canmv_connected: true,
          canmv_last_seen_seconds: 0,
          canmv_fps: frame.fps ?? prev.canmv_fps,
          canmv_status: frame.canmv_status ?? prev.canmv_status,
        }));
        if (!cutDirtyRef.current && frame.cut_config) {
          setCutConfig(frame.cut_config);
        }
        return;
      }

      setSystemStatus(message.payload);
      if (message.payload.cutter_axis) {
        setCutterAxis(message.payload.cutter_axis);
        setCutterStrokeUpInput((current) => current || (message.payload.cutter_axis?.stroke_up_mm != null ? String(message.payload.cutter_axis.stroke_up_mm) : ""));
        setCutterStrokeDownInput((current) => current || (message.payload.cutter_axis?.stroke_down_mm != null ? String(message.payload.cutter_axis.stroke_down_mm) : ""));
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

    const syncCanvasSize = () => {
      const width = video.videoWidth || videoConfigRef.current.width || 1280;
      const height = video.videoHeight || videoConfigRef.current.height || 720;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    };

    const drawCurrentOverlay = () => {
      syncCanvasSize();
      const frame = aiFrameRef.current;
      drawVisionOverlay(canvas, frame.detections, cutConfigRef.current, Boolean(frame.cut_request));
    };

    type VideoWithFrameCallback = HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: () => void) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    };

    const videoWithFrameCallback = video as VideoWithFrameCallback;
    let rafId = 0;

    if (typeof videoWithFrameCallback.requestVideoFrameCallback === "function") {
      const tick = () => {
        drawCurrentOverlay();
        overlayFrameRef.current = videoWithFrameCallback.requestVideoFrameCallback?.(tick) ?? null;
      };
      overlayFrameRef.current = videoWithFrameCallback.requestVideoFrameCallback(tick);
    } else {
      const tick = () => {
        drawCurrentOverlay();
        rafId = window.requestAnimationFrame(tick);
      };
      rafId = window.requestAnimationFrame(tick);
      overlayFrameRef.current = rafId;
    }

    return () => {
      if (typeof videoWithFrameCallback.cancelVideoFrameCallback === "function" && overlayFrameRef.current !== null) {
        videoWithFrameCallback.cancelVideoFrameCallback(overlayFrameRef.current);
      }
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      overlayFrameRef.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (aiFrameUiPendingRef.current !== null) {
        window.clearTimeout(aiFrameUiPendingRef.current);
      }
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
    const transceiver = peer.addTransceiver("video", { direction: "recvonly" });
    const receiver = transceiver.receiver as RTCRtpReceiver & { playoutDelayHint?: number; jitterBufferTarget?: number };
    if ("playoutDelayHint" in receiver) {
      receiver.playoutDelayHint = 0;
    }
    if ("jitterBufferTarget" in receiver) {
      receiver.jitterBufferTarget = 0;
    }

    peer.ontrack = (event) => {
      if (videoRef.current) {
        try {
          event.track.contentHint = "motion";
        } catch {
          // ignore unsupported browsers
        }
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
          setVideoError(msg.detail ?? "视频服务异常");
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
            sdpMLineIndex: event.candidate.sdpMLineIndex ?? 0,
          }),
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
      setCutError("保存切割配置失败");
    } finally {
      setCutSaving(false);
    }
  }

  async function handleApplyLightSettings() {
    const { red, green, blue } = hexToRgb(lightColor);
    setLightApplying(true);
    try {
      await runControl(() => applyLightSettings(lightCount, lightBrightness, red, green, blue), () => setLightModalOpen(false));
    } finally {
      setLightApplying(false);
    }
  }

  async function loadSystemMaintenance() {
    setSystemLoading(true);
    try {
      const snapshot = await fetchSystemMaintenance();
      setSystemMaintenance(snapshot);
      setSystemError("");
    } catch (error) {
      setSystemError(error instanceof Error ? error.message : "获取设备维护信息失败");
    } finally {
      setSystemLoading(false);
    }
  }

  async function loadSystemEvents() {
    setEventLoading(true);
    try {
      const events = await fetchSystemEvents(120);
      setSystemEvents(events);
      setEventError("");
    } catch (error) {
      setEventError(error instanceof Error ? error.message : "获取运行事件失败");
    } finally {
      setEventLoading(false);
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
    setManualModeError("");
    setManualConfirmOpen(true);
  }

  async function handleConfirmManualMode() {
    setManualModeSwitching(true);
    setManualModeError("");
    try {
      await setManualMode();
      setControlMode("manual");
      setManualModalOpen(true);
      setManualConfirmOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "进入手动调试失败";
      setControlError(message);
      setManualModeError(message);
    } finally {
      setManualModeSwitching(false);
    }
  }

  function handleReturnAutoMode() {
    void runControl(setAutoMode, () => {
      setControlMode("auto");
      setManualModalOpen(false);
      setManualConfirmOpen(false);
    });
  }

  async function handleSetCutterZero() {
    setCutterZeroing(true);
    setControlError("");
    try {
      const state = await setCutterAxisZero();
      setCutterAxis(state);
    } catch (error) {
      setControlError(error instanceof Error ? error.message : "设置刀轴零点失败");
    } finally {
      setCutterZeroing(false);
    }
  }

  async function handleSaveCutterStroke() {
    const up = Number(cutterStrokeUpInput);
    const down = Number(cutterStrokeDownInput);
    if (!(up > 0) || !(down > 0)) {
      setControlError("请先填写有效的上升和下降步长");
      return;
    }

    setCutterSaving(true);
    setControlError("");
    try {
      const state = await saveCutterAxis({
        stroke_up_mm: up,
        stroke_down_mm: down,
      });
      setCutterAxis(state);
      setCutterStrokeUpInput(state.stroke_up_mm != null ? String(state.stroke_up_mm) : "");
      setCutterStrokeDownInput(state.stroke_down_mm != null ? String(state.stroke_down_mm) : "");
    } catch (error) {
      setControlError(error instanceof Error ? error.message : "保存刀轴步长失败");
    } finally {
      setCutterSaving(false);
    }
  }

  function handleOpenSystemMaintenance() {
    setSystemModalOpen(true);
    void loadSystemMaintenance();
  }

  function handleOpenEventHistory() {
    setEventModalOpen(true);
    void loadSystemEvents();
  }

  function handleRequestSystemAction(action: string) {
    setSystemConfirmAction(action);
  }

  async function handleConfirmSystemAction() {
    if (!systemConfirmAction) return;
    const action = systemConfirmAction;
    setSystemConfirmAction(null);
    setSystemApplyingAction(action);
    setSystemError("");
    try {
      const ack = await executeSystemAction(action);
      setSystemError(ack.detail);
      if (action === "restart_network") {
        await loadSystemMaintenance();
      }
    } catch (error) {
      setSystemError(error instanceof Error ? error.message : "设备维护操作执行失败");
    } finally {
      setSystemApplyingAction(null);
    }
  }

  function getSystemActionMeta(action: string | null) {
    switch (action) {
      case "restart_app":
        return {
          title: "重启界面",
          description: "将重启当前控制界面，画面会短暂中断。",
          confirmLabel: "确认重启界面",
        };
      case "restart_network":
        return {
          title: "重启网络",
          description: "将重启设备网络，远程连接会短暂中断。",
          confirmLabel: "确认重启网络",
        };
      case "reboot_device":
        return {
          title: "重启设备",
          description: "设备将立即重启，请确认当前允许中断运行。",
          confirmLabel: "确认重启设备",
        };
      case "shutdown_device":
        return {
          title: "设备关机",
          description: "设备将立即关机，请确认当前可以安全关机。",
          confirmLabel: "确认设备关机",
        };
      case "fault_reset":
        return {
          title: "故障复位",
          description: "将清除当前故障锁定，并恢复到可操作状态。请先确认现场已安全。",
          confirmLabel: "确认故障复位",
        };
      default:
        return {
          title: "设备维护",
          description: "确认执行当前维护操作。",
          confirmLabel: "确认执行",
        };
    }
  }

  const systemActionMeta = getSystemActionMeta(systemConfirmAction);

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
          videoError={videoError}
          onOpenCutSettings={() => setCutModalOpen(true)}
          onOpenLightSettings={() => setLightModalOpen(true)}
          onOpenSystemMaintenance={handleOpenSystemMaintenance}
          onOpenManual={handleRequestManualMode}
          onEmergencyStop={() => void runControl(signalEmergencyStop)}
        />

        <aside className="sidebar">
          <SystemStatusStrip status={systemStatus} maintenance={systemMaintenance} videoConnected={videoConnected} />

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
              <span>切割摘要</span>
              <strong>{cutSummary}</strong>
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
            onResetFault={() => setSystemConfirmAction("fault_reset")}
            onOpenEventHistory={handleOpenEventHistory}
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
        cutterPositionKnown={cutterAxis.position_known}
        cutterPositionMm={cutterAxis.current_position_mm}
        cutterStrokeUpMm={cutterAxis.stroke_up_mm}
        cutterStrokeDownMm={cutterAxis.stroke_down_mm}
        cutterStrokeUpInput={cutterStrokeUpInput}
        cutterStrokeDownInput={cutterStrokeDownInput}
        zeroing={cutterZeroing}
        saving={cutterSaving}
        onExit={handleReturnAutoMode}
        onSetZero={() => void handleSetCutterZero()}
        onStrokeUpInputChange={setCutterStrokeUpInput}
        onStrokeDownInputChange={setCutterStrokeDownInput}
        onSaveStroke={() => void handleSaveCutterStroke()}
        onStartFeed={() => void runControl(startFeed)}
        onStopFeed={() => void runControl(stopFeed)}
        onEngageClamp={() => void runControl(engageClamp)}
        onReleaseClamp={() => void runControl(releaseClamp)}
        onStartCutter={() => void runControl(startCutter)}
        onStopCutter={() => void runControl(stopCutter)}
      />

      <SystemMaintenanceModal
        open={systemModalOpen}
        snapshot={systemMaintenance}
        loading={systemLoading}
        applyingAction={systemApplyingAction}
        error={systemError}
        onClose={() => setSystemModalOpen(false)}
        onRefresh={() => void loadSystemMaintenance()}
        onAction={handleRequestSystemAction}
      />

      <EventHistoryModal
        open={eventModalOpen}
        events={systemEvents}
        loading={eventLoading}
        error={eventError}
        onClose={() => setEventModalOpen(false)}
        onRefresh={() => void loadSystemEvents()}
      />

      <ConfirmActionModal
        open={manualConfirmOpen}
        title="进入手动调试"
        description="进入手动模式后，设备将退出自动运行。该模式仅用于安装和调试。"
        confirmLabel="确认进入手动"
        loading={manualModeSwitching}
        error={manualModeError}
        onConfirm={() => void handleConfirmManualMode()}
        onCancel={() => {
          if (manualModeSwitching) return;
          setManualConfirmOpen(false);
          setManualModeError("");
        }}
      />

      <ConfirmActionModal
        open={systemConfirmAction !== null}
        title={systemActionMeta.title}
        description={systemActionMeta.description}
        confirmLabel={systemActionMeta.confirmLabel}
        onConfirm={() => {
          if (systemConfirmAction === "fault_reset") {
            void runControl(resetFault, () => setSystemConfirmAction(null));
            return;
          }
          void handleConfirmSystemAction();
        }}
        onCancel={() => setSystemConfirmAction(null)}
      />
    </>
  );
}
