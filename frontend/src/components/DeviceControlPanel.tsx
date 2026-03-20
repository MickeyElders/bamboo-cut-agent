import type { AiFrame, SystemStatus } from "../types";
import { formatAutoState, formatLastAction, type RunState } from "../utils/ui";
import { SummaryTileGrid } from "./SummaryTileGrid";

type DeviceControlPanelProps = {
  aiFrame: AiFrame;
  systemStatus: SystemStatus;
  runState: RunState;
  manualMode: boolean;
  videoConnected: boolean;
  lightCount: number;
  lightBrightness: number;
  lightColor: string;
  lightSummary: string;
};

export function DeviceControlPanel(props: DeviceControlPanelProps) {
  const {
    aiFrame,
    systemStatus,
    runState,
    manualMode,
    videoConnected,
    lightCount,
    lightBrightness,
    lightColor,
    lightSummary
  } = props;

  const jobStatus = systemStatus.job_status;

  return (
    <section className="panel side-panel">
      <div className="header">
        <h2>运行信息</h2>
        <span className={`badge ${manualMode ? "warn" : "ok"}`}>{manualMode ? "手动调试" : "自动运行"}</span>
      </div>

      <div className="status-inline-strip">
        <div className={`status-pill ${aiFrame.detections.length > 0 ? "active" : ""}`}>
          <span>识别</span>
          <strong>{aiFrame.detections.length > 0 ? "运行中" : "待机"}</strong>
        </div>
        <div className={`status-pill ${aiFrame.cut_request ? "active" : ""}`}>
          <span>切割位</span>
          <strong>{aiFrame.cut_request ? "到位" : "监测中"}</strong>
        </div>
        <div className={`status-pill ${!manualMode ? "active" : ""}`}>
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
          { label: "阶段", value: formatAutoState(jobStatus?.auto_state) },
          { label: "最近动作", value: formatLastAction(jobStatus?.last_action) },
          { label: "累计循环", value: jobStatus?.cycle_count ?? 0 },
          { label: "切割请求", value: jobStatus?.cut_request_active ? "活跃" : "空闲" }
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
    </section>
  );
}
