import type { AiFrame, SystemStatus } from "../types";
import { formatAutoState, formatLastAction, formatTime, type RunState } from "../utils/ui";

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

type Tone = "default" | "info" | "success" | "warning" | "danger";

function getRunTone(manualMode: boolean, faultActive: boolean | undefined, cutRequest: boolean | undefined): Tone {
  if (faultActive) return "danger";
  if (manualMode) return "warning";
  if (cutRequest) return "danger";
  return "success";
}

export function DeviceControlPanel(props: DeviceControlPanelProps) {
  const { aiFrame, systemStatus, runState, manualMode, videoConnected, lightCount, lightBrightness, lightColor, lightSummary, onResetFault, onOpenEventHistory } = props;

  const jobStatus = systemStatus.job_status;
  const alerts = systemStatus.alerts ?? [];
  const startupChecks = systemStatus.startup_checks ?? [];
  const recentEvents = systemStatus.recent_events ?? [];
  const inputSignals = systemStatus.input_signals ?? [];
  const runTone = getRunTone(manualMode, jobStatus?.fault_active, aiFrame.cut_request);
  const leadAlert = alerts[0] ?? null;

  return (
    <section className="panel side-panel">
      <div className={`panel-section-tag ${jobStatus?.fault_active ? "panel-section-tag-danger" : manualMode ? "panel-section-tag-warning" : "panel-section-tag-accent"}`}>
        <span>运行监控</span>
      </div>
      <div className="header">
        <h2>运行信息</h2>
      </div>

      <div className="status-island-stack">
        <article className={`status-island status-island-hero tone-${runTone}`}>
          <div className="status-island-head">
            <div>
              <span className="status-island-kicker">当前运行</span>
              <strong>{jobStatus?.fault_active ? "保护停机" : runState.label}</strong>
            </div>
            <span className={`status-dot-pill tone-${manualMode ? "warning" : "success"}`}>{manualMode ? "手动" : "自动"}</span>
          </div>
          <p className="status-island-copy">{jobStatus?.fault_active ? (jobStatus.fault_detail ?? "检测到故障，等待人工处理。") : runState.detail}</p>
          <div className="status-island-pills">
            <span className={`status-chip status-chip-${aiFrame.detections.length > 0 ? "success" : "default"}`}>识别 {aiFrame.detections.length > 0 ? "运行中" : "待机"}</span>
            <span className={`status-chip status-chip-${aiFrame.cut_request ? "danger" : "info"}`}>切割位 {aiFrame.cut_request ? "到位" : "监测中"}</span>
            <span className={`status-chip status-chip-${videoConnected ? "success" : "warning"}`}>画面 {videoConnected ? "正常" : "断开"}</span>
            <span className={`status-chip status-chip-${jobStatus?.fault_active ? "danger" : "success"}`}>保护 {jobStatus?.fault_active ? "故障锁定" : "正常"}</span>
          </div>
        </article>

        <div className="status-island-grid status-island-grid-dual">
          <article className="status-island status-island-subsystem">
            <div className="status-island-head compact">
              <div>
                <span className="status-island-kicker">流程状态</span>
                <strong>{formatAutoState(jobStatus?.auto_state)}</strong>
              </div>
            </div>
            <div className="status-island-metrics compact">
              <div className="status-metric-pill">
                <span>最近动作</span>
                <strong>{formatLastAction(jobStatus?.last_action)}</strong>
              </div>
              <div className="status-metric-pill">
                <span>累计循环</span>
                <strong>{jobStatus?.cycle_count ?? 0}</strong>
              </div>
              <div className="status-metric-pill">
                <span>切割信号</span>
                <strong>{jobStatus?.cut_request_active ? "活跃" : "空闲"}</strong>
              </div>
              <div className="status-metric-pill">
                <span>目标数</span>
                <strong>{aiFrame.detections.length}</strong>
              </div>
            </div>
          </article>

          <article className={`status-island status-island-subsystem ${leadAlert ? "status-island-alert" : "status-island-subsystem-accent"}`}>
            <div className="status-island-head compact">
              <div>
                <span className="status-island-kicker">告警与灯光</span>
                <strong>{leadAlert ? leadAlert.title : "未发现活动告警"}</strong>
              </div>
              <span className={`status-dot-pill tone-${leadAlert ? "warning" : "info"}`}>{leadAlert ? leadAlert.level : "稳定"}</span>
            </div>
            <p className="status-island-copy">{leadAlert ? leadAlert.detail : lightSummary}</p>
            <div className="status-island-pills">
              <span className="status-chip status-chip-info">亮灯 {lightCount}/16</span>
              <span className="status-chip status-chip-info">亮度 {lightBrightness}/255</span>
              <span className="status-chip status-chip-wide status-chip-info">
                <span className="light-color-chip" style={{ backgroundColor: lightColor }} />
                {lightColor.toUpperCase()}
              </span>
            </div>
          </article>
        </div>

        {jobStatus?.fault_active ? (
          <article className="status-island status-island-alert tone-danger">
            <div className="status-island-head compact">
              <div>
                <span className="status-island-kicker">故障信息</span>
                <strong>{jobStatus.fault_code ?? "未提供代码"}</strong>
              </div>
              <span className="status-dot-pill tone-danger">锁定中</span>
            </div>
            <p className="status-island-copy">{jobStatus.fault_detail ?? "等待人工确认与复位。"}</p>
          </article>
        ) : null}

        <div className="status-island-grid status-island-grid-actions">
          <button className="surface-button secondary-action-button" onClick={onOpenEventHistory}>
            查看事件历史
          </button>
          {jobStatus?.fault_active ? (
            <button className="surface-button warning fault-action-button" onClick={onResetFault}>
              故障复位
            </button>
          ) : null}
        </div>

        <div className="status-island-grid status-island-grid-pills">
          {(startupChecks.length > 0 ? startupChecks : [{ label: "启动自检", detail: "暂无数据", status: "default" }]).slice(0, 2).map((item) => (
            <article className="status-pill-island" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.detail}</strong>
            </article>
          ))}
          {(inputSignals.length > 0 ? inputSignals : [{ label: "输入反馈", detail: "未配置", available: false, active: null }]).slice(0, 2).map((item) => (
            <article className="status-pill-island" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.available ? (item.active ? "触发" : "正常") : item.detail}</strong>
            </article>
          ))}
        </div>

        <article className="status-island status-island-footer">
          <div className="status-island-head compact">
            <div>
              <span className="status-island-kicker">最近事件</span>
              <strong>{recentEvents.length > 0 ? `${recentEvents.length} 条运行记录` : "暂无运行记录"}</strong>
            </div>
          </div>
          {recentEvents.length > 0 ? (
            <div className="compact-info-list status-event-list">
              {recentEvents.slice(0, 4).map((event) => (
                <div className="compact-info-row" key={`${event.timestamp}-${event.code}`}>
                  <span>{formatTime(event.timestamp)}</span>
                  <strong>{event.message}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="status-island-copy">当前没有新的运行事件。</p>
          )}
        </article>
      </div>
    </section>
  );
}
