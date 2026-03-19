import type { RefObject } from "react";
import type { AiFrame, VideoConfig } from "../types";
import type { RunState } from "../utils/ui";

type VisionPanelProps = {
  connectionState: string;
  videoRef: RefObject<HTMLVideoElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  runState: RunState;
  aiFrame: AiFrame;
  manualMode: boolean;
  lightCount: number;
  videoConfig: VideoConfig;
  videoError: string;
  onOpenCutSettings: () => void;
  onOpenLightSettings: () => void;
  onOpenManual: () => void;
  onSetAuto: () => void;
  onEmergencyStop: () => void;
};

export function VisionPanel(props: VisionPanelProps) {
  const {
    connectionState,
    videoRef,
    canvasRef,
    runState,
    aiFrame,
    manualMode,
    lightCount,
    videoConfig,
    videoError,
    onOpenCutSettings,
    onOpenLightSettings,
    onOpenManual,
    onSetAuto,
    onEmergencyStop
  } = props;

  return (
    <section className="panel vision-panel">
      <div className="header">
        <h2>实时画面</h2>
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
            <span className="step-name">检测</span>
            <strong>{aiFrame.detections.length > 0 ? "运行中" : "待机"}</strong>
          </div>
          <div className={`process-step ${aiFrame.cut_request ? "active" : ""}`}>
            <span className="step-index">02</span>
            <span className="step-name">切割位</span>
            <strong>{aiFrame.cut_request ? "到位" : "监测中"}</strong>
          </div>
          <div className={`process-step ${manualMode ? "active" : ""}`}>
            <span className="step-index">03</span>
            <span className="step-name">模式</span>
            <strong>{manualMode ? "手动" : "自动"}</strong>
          </div>
          <div className={`process-step ${lightCount > 0 ? "active" : ""}`}>
            <span className="step-index">04</span>
            <span className="step-name">灯光</span>
            <strong>{lightCount} / 16</strong>
          </div>
        </div>

        <div className="spec-line">
          <span>模式</span>
          <strong>
            {videoConfig.width}x{videoConfig.height}@{videoConfig.fps} {videoConfig.encoder}
          </strong>
        </div>
        <div className="spec-line">
          <span>切割</span>
          <strong>{aiFrame.cut_request ? "已触发" : "空闲"}</strong>
        </div>
        <div className="spec-line">
          <span>目标数</span>
          <strong>{aiFrame.detections.length}</strong>
        </div>

        <div className="vision-control-strip">
          <button className="surface-button" onClick={onOpenCutSettings}>
            切割位设置
          </button>
          <button className="surface-button" onClick={onOpenLightSettings}>
            灯光设置
          </button>
          <button className={manualMode ? "surface-button warning" : "surface-button"} onClick={onOpenManual}>
            {manualMode ? "手动调试中" : "手动调试"}
          </button>
          <button className="surface-button" onClick={onSetAuto} disabled={!manualMode}>
            回到自动
          </button>
          <button className="surface-button danger" onClick={onEmergencyStop}>
            急停
          </button>
        </div>
        {videoError ? <div className="error-text">{videoError}</div> : null}
      </div>
    </section>
  );
}
