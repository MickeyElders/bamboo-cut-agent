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
          <span>视觉识别</span>
          <strong>{aiFrame.detections.length > 0 ? "运行中" : "等待中"}</strong>
        </div>
        <div className={`schema-link ${aiFrame.cut_request ? "active" : ""}`}>{">"}</div>
        <div className={`schema-node ${aiFrame.cut_request ? "active" : ""}`}>
          <span>到位信号</span>
          <strong>{aiFrame.cut_request ? "已到位" : "未到位"}</strong>
        </div>
        <div className={`schema-link ${videoConnected ? "active" : ""}`}>{">"}</div>
        <div className={`schema-node ${!manualMode ? "active" : ""}`}>
          <span>运行模式</span>
          <strong>{manualMode ? "手动" : "自动"}</strong>
        </div>
      </div>

      <SummaryTileGrid
        tone="success"
        items={[
          { label: "运行状态", value: runState.label, tone: aiFrame.cut_request ? "danger" : "success" },
          { label: "检测框数量", value: aiFrame.detections.length },
          { label: "切割信号", value: aiFrame.cut_request ? "触发" : "未触发" },
          { label: "视频链路", value: videoConnected ? "正常" : "断开", tone: videoConnected ? "success" : "warning" }
        ]}
      />

      <SummaryTileGrid
        tone="info"
        items={[
          { label: "灯珠数量", value: `${lightCount} / 16` },
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
        <span>灯光配置摘要</span>
        <strong>{lightSummary}</strong>
      </div>

      <div className="controls controls-single">
        <button className={manualMode ? "primary" : ""} onClick={onOpenManual}>
          {manualMode ? "继续手动调试" : "进入手动调试"}
        </button>
        <button onClick={onSetAuto} disabled={!manualMode}>
          切回自动运行
        </button>
        <button className="danger" onClick={onEmergencyStop}>
          急停
        </button>
      </div>
    </section>
  );
}
