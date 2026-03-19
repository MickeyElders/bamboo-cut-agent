import type { AiFrame } from "../types";
import type { RunState } from "../utils/ui";
import { SummaryTileGrid } from "./SummaryTileGrid";

type DeviceControlPanelProps = {
  aiFrame: AiFrame;
  runState: RunState;
  manualMode: boolean;
  videoConnected: boolean;
  lightCount: number;
  lightBrightness: number;
  lightColor: string;
  lightSummary: string;
  onOpenLightSettings: () => void;
  onOpenManual: () => void;
  onSetAuto: () => void;
  onEmergencyStop: () => void;
};

export function DeviceControlPanel(props: DeviceControlPanelProps) {
  const {
    aiFrame,
    runState,
    manualMode,
    videoConnected,
    lightCount,
    lightBrightness,
    lightColor,
    lightSummary,
    onOpenLightSettings,
    onOpenManual,
    onSetAuto,
    onEmergencyStop
  } = props;

  return (
    <section className="panel side-panel">
      <div className="header">
        <h2>设备控制</h2>
        <span className={`badge ${manualMode ? "warn" : "ok"}`}>{manualMode ? "手动调试" : "自动运行"}</span>
      </div>

      <div className="machine-schema">
        <div className={`schema-node ${aiFrame.detections.length > 0 ? "active" : ""}`}>
          <span>识别</span>
          <strong>{aiFrame.detections.length > 0 ? "运行中" : "待机"}</strong>
        </div>
        <div className={`schema-link ${aiFrame.cut_request ? "active" : ""}`}>{">"}</div>
        <div className={`schema-node ${aiFrame.cut_request ? "active" : ""}`}>
          <span>切割位</span>
          <strong>{aiFrame.cut_request ? "到位" : "监测中"}</strong>
        </div>
        <div className={`schema-link ${videoConnected ? "active" : ""}`}>{">"}</div>
        <div className={`schema-node ${!manualMode ? "active" : ""}`}>
          <span>模式</span>
          <strong>{manualMode ? "手动" : "自动"}</strong>
        </div>
      </div>

      <SummaryTileGrid
        tone="success"
        items={[
          { label: "状态", value: runState.label, tone: aiFrame.cut_request ? "danger" : "success" },
          { label: "目标", value: aiFrame.detections.length },
          { label: "切割", value: aiFrame.cut_request ? "触发" : "待命" },
          { label: "视频", value: videoConnected ? "正常" : "断开", tone: videoConnected ? "success" : "warning" }
        ]}
      />

      <SummaryTileGrid
        tone="info"
        items={[
          { label: "灯珠", value: `${lightCount} / 16` },
          { label: "亮度", value: `${lightBrightness} / 255` },
          {
            label: "颜色",
            value: (
              <span className="light-color-value">
                <span className="light-color-chip" style={{ backgroundColor: lightColor }} />
                {lightColor.toUpperCase()}
              </span>
            )
          }
        ]}
      />

      <div className="summary-card summary-card-info">
        <span>灯光</span>
        <strong>{lightSummary}</strong>
      </div>

      <div className="config-entry config-entry-info" onClick={onOpenLightSettings} role="button" tabIndex={0}>
        <div className="config-entry-copy">
          <span className="config-entry-kicker">配置</span>
          <strong>灯光设置</strong>
          <p>亮度、颜色与点亮数量。</p>
        </div>
        <div className="config-entry-action">
          <span className="config-entry-label">设置</span>
        </div>
      </div>

      <div
        className={`config-entry config-entry-warning ${manualMode ? "is-active" : ""}`}
        onClick={onOpenManual}
        role="button"
        tabIndex={0}
      >
        <div className="config-entry-copy">
          <span className="config-entry-kicker">调试</span>
          <strong>{manualMode ? "手动调试" : "进入手动"}</strong>
          <p>{manualMode ? "当前为手动模式。" : "安装与联调用。进入前会二次确认。"}</p>
        </div>
        <div className="config-entry-action">
          <span className="config-entry-label">{manualMode ? "继续" : "进入"}</span>
        </div>
      </div>

      <div className="controls controls-single">
        <button onClick={onSetAuto} disabled={!manualMode}>
          回到自动
        </button>
        <button className="danger" onClick={onEmergencyStop}>
          急停
        </button>
      </div>
    </section>
  );
}
