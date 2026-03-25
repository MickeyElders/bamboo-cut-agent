import type { AiFrame, SystemStatus } from "../types";
import { formatAutoState, formatLastAction, formatTime, type RunState } from "../utils/ui";
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
  onResetFault: () => void;
  onOpenEventHistory: () => void;
};

export function DeviceControlPanel(props: DeviceControlPanelProps) {
  const { aiFrame, systemStatus, runState, manualMode, videoConnected, lightCount, lightBrightness, lightColor, lightSummary, onResetFault, onOpenEventHistory } =
    props;

  const jobStatus = systemStatus.job_status;
  const alerts = systemStatus.alerts ?? [];
  const startupChecks = systemStatus.startup_checks ?? [];
  const recentEvents = systemStatus.recent_events ?? [];
  const inputSignals = systemStatus.input_signals ?? [];

  return (
    <section className="panel side-panel">
      <div className={`panel-section-tag ${jobStatus?.fault_active ? "panel-section-tag-danger" : manualMode ? "panel-section-tag-warning" : "panel-section-tag-accent"}`}>
        <span>运行监控</span>
      </div>
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
          {
            label: "当前状态",
            value: jobStatus?.fault_active ? "保护停机" : runState.label,
            tone: jobStatus?.fault_active ? "danger" : aiFrame.cut_request ? "danger" : "success",
          },
          { label: "识别目标", value: aiFrame.detections.length },
          { label: "切割请求", value: aiFrame.cut_request ? "已触发" : "待命" },
          { label: "画面状态", value: videoConnected ? "正常" : "断开", tone: videoConnected ? "success" : "warning" },
        ]}
      />

      <SummaryTileGrid
        tone="info"
        items={[
          { label: "自动阶段", value: formatAutoState(jobStatus?.auto_state) },
          { label: "最近动作", value: formatLastAction(jobStatus?.last_action) },
          { label: "累计循环", value: jobStatus?.cycle_count ?? 0 },
          { label: "切割信号", value: jobStatus?.cut_request_active ? "活跃" : "空闲" },
        ]}
      />

      <SummaryTileGrid
        tone={jobStatus?.fault_active ? "danger" : "default"}
        items={[
          {
            label: "保护状态",
            value: jobStatus?.fault_active ? "故障锁定" : "正常",
            tone: jobStatus?.fault_active ? "danger" : "success",
          },
          { label: "故障代码", value: jobStatus?.fault_code ?? "-" },
          { label: "故障说明", value: jobStatus?.fault_detail ?? "-" },
        ]}
      />

      <div className="modal-actions modal-actions-dual">
        <button className="surface-button secondary-action-button" onClick={onOpenEventHistory}>
          查看事件历史
        </button>
        {jobStatus?.fault_active ? (
          <button className="surface-button warning fault-action-button" onClick={onResetFault}>
            故障复位
          </button>
        ) : null}
      </div>

      <SummaryTileGrid
        tone="info"
        items={(startupChecks.length > 0 ? startupChecks : [{ label: "启动自检", detail: "暂无数据", status: "default" }]).slice(0, 4).map((item) => ({
          label: item.label,
          value: item.detail,
          tone: item.status === "ok" ? "success" : item.status === "warn" ? "warning" : item.status === "danger" ? "danger" : "default",
        }))}
      />

      <SummaryTileGrid
        tone="info"
        items={(inputSignals.length > 0 ? inputSignals : [{ label: "输入反馈", detail: "未配置", available: false, active: null }]).slice(0, 4).map((item) => ({
          label: item.label,
          value: item.available ? (item.active ? "触发" : "正常") : item.detail,
          tone: !item.available ? "default" : item.active ? "warning" : "success",
        }))}
      />

      {alerts.length > 0 ? (
        <div className="summary-card summary-card-warning">
          <span>当前告警</span>
          <strong>{alerts[0].title}</strong>
          <p>{alerts[0].detail}</p>
        </div>
      ) : (
        <div className="summary-card summary-card-info">
          <span>当前告警</span>
          <strong>未发现活动告警</strong>
        </div>
      )}

      <SummaryTileGrid
        tone="info"
        items={[
          { label: "亮灯数量", value: `${lightCount} / 16` },
          { label: "灯光亮度", value: `${lightBrightness} / 255` },
          {
            label: "灯光颜色",
            value: (
              <span className="light-color-value">
                <span className="light-color-chip" style={{ backgroundColor: lightColor }} />
                {lightColor.toUpperCase()}
              </span>
            ),
          },
        ]}
      />

      <div className="summary-card summary-card-info">
        <span>灯光摘要</span>
        <strong>{lightSummary}</strong>
      </div>

      <div className="summary-card">
        <span>最近事件</span>
        <strong>{recentEvents.length > 0 ? `${recentEvents.length} 条运行记录` : "暂无运行记录"}</strong>
        {recentEvents.length > 0 ? (
          <div className="compact-info-list">
            {recentEvents.slice(0, 4).map((event) => (
              <div className="compact-info-row" key={`${event.timestamp}-${event.code}`}>
                <span>{formatTime(event.timestamp)}</span>
                <strong>{event.message}</strong>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
