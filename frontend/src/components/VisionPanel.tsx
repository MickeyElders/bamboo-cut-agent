import type { RefObject } from "react";
import type { AiFrame } from "../types";
import type { RunState } from "../utils/ui";

type VisionPanelProps = {
  connectionState: string;
  videoRef: RefObject<HTMLVideoElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  runState: RunState;
  aiFrame: AiFrame;
  manualMode: boolean;
  lightCount: number;
  videoError: string;
  onOpenCutSettings: () => void;
  onOpenCutterCalibration: () => void;
  onOpenLightSettings: () => void;
  onOpenSystemMaintenance: () => void;
  onOpenManual: () => void;
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
    videoError,
    onOpenCutSettings,
    onOpenCutterCalibration,
    onOpenLightSettings,
    onOpenSystemMaintenance,
    onOpenManual,
    onEmergencyStop,
  } = props;

  return (
    <section className="panel vision-panel">
      <div className="header vision-osd-header">
        <div className="vision-osd-title">
          <span className="vision-osd-kicker">Vision Monitor</span>
          <h2>实时画面</h2>
        </div>
        <div className="vision-osd-meta">
          <span className={`vision-osd-pill ${connectionState === "在线" ? "is-online" : "is-warning"}`}>{connectionState}</span>
          <span className={`vision-osd-pill ${manualMode ? "is-warning" : "is-online"}`}>{manualMode ? "手动调试" : "自动运行"}</span>
        </div>
      </div>

      <div className="video-wrap hero-video">
        <video ref={videoRef} autoPlay playsInline muted />
        <canvas ref={canvasRef} className="overlay" />
      </div>

      <div className="vision-footer">
        <div className={`run-inline-bar run-${runState.code}`}>
          <span className="run-inline-label">{runState.label}</span>
          <span className="run-inline-detail">{runState.detail}</span>
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
          <div className={`process-step ${lightCount > 0 ? "active" : ""}`}>
            <span className="step-index">03</span>
            <span className="step-name">灯光</span>
            <strong>{lightCount} / 16</strong>
          </div>
        </div>

        <div className="vision-control-strip">
          <div className="vision-control-group">
            <span className="vision-control-group-label">设置</span>
            <div className="vision-control-group-grid vision-control-group-grid-triple">
              <button className="surface-button module-entry-button" onClick={onOpenCutSettings}>
                切割信息
              </button>
              <button className="surface-button module-entry-button calibration-entry-button" onClick={onOpenCutterCalibration}>
                刀轴标定
              </button>
              <button className="surface-button module-entry-button" onClick={onOpenLightSettings}>
                灯光设置
              </button>
            </div>
          </div>

          <div className="vision-control-group">
            <span className="vision-control-group-label">维护</span>
            <div className="vision-control-group-grid">
              <button className="surface-button module-entry-button maintenance-entry-button" onClick={onOpenSystemMaintenance}>
                设备维护
              </button>
              <button className={manualMode ? "surface-button warning manual-entry-button is-live" : "surface-button warning manual-entry-button"} onClick={onOpenManual}>
                {manualMode ? "手动调试中" : "手动调试"}
              </button>
            </div>
          </div>

          <div className="vision-control-group vision-control-group-danger">
            <span className="vision-control-group-label">危险操作</span>
            <div className="vision-control-group-grid">
              <button className="surface-button danger emergency-entry-button" onClick={onEmergencyStop}>
                急停
              </button>
            </div>
          </div>
        </div>
        {videoError ? <div className="error-text">{videoError}</div> : null}
      </div>
    </section>
  );
}
