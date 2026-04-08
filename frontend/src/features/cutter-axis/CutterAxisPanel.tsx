import type { CutterAxisState } from "../../types";
import { formatMillimeters } from "../../utils/ui";
import { SummaryTileGrid } from "../../components/SummaryTileGrid";
import { formatCutterDriverState, formatCutterTravel, formatCutterZeroState, getCutterAxisSummary } from "./formatters";

type CutterAxisPanelProps = {
  state: CutterAxisState;
  error: string;
};

function getPanelTone(state: CutterAxisState, error: string) {
  if (error || state.error) return "danger";
  if (!state.position_known || state.stroke_mm == null) return "warning";
  return "success";
}

function getPanelBadge(state: CutterAxisState, error: string) {
  if (error || state.error) {
    return { label: "异常", badgeTone: "warn" as const, tagTone: "danger" as const };
  }
  if (state.position_known && state.stroke_mm != null) {
    return { label: "已标定", badgeTone: "ok" as const, tagTone: "success" as const };
  }
  return { label: "待标定", badgeTone: "warn" as const, tagTone: "warning" as const };
}

function getHint(state: CutterAxisState, error: string) {
  if (error || state.error) {
    return {
      className: "summary-card summary-card-warning",
      label: "驱动状态",
      value: error || state.error || "刀轴驱动未就绪，请检查控制器连接与串口配置。",
    };
  }
  if (!state.position_known) {
    return {
      className: "summary-card summary-card-warning",
      label: "零点提醒",
      value: "请进入手动调试，将刀轴移动到基准位后，在刀轴标定中执行设零。",
    };
  }
  if (state.stroke_mm == null) {
    return {
      className: "summary-card summary-card-warning",
      label: "行程提醒",
      value: "请先保存刀轴行程，系统才会在下压和抬起动作后正确累计当前位置。",
    };
  }
  return {
    className: "summary-card summary-card-info",
    label: "状态摘要",
    value: "刀轴基准已完成，当前位置会在下压和抬起动作后持续更新并持久化。",
  };
}

export function CutterAxisPanel({ state, error }: CutterAxisPanelProps) {
  const badge = getPanelBadge(state, error);
  const hint = getHint(state, error);
  const tone = getPanelTone(state, error);
  const displayError = error || state.error || "";

  return (
    <section className="panel side-panel">
      <div className={`panel-section-tag panel-section-tag-${badge.tagTone}`}>
        <span>刀轴标定</span>
      </div>
      <div className="header">
        <h2>刀轴基准</h2>
        <span className={`badge ${badge.badgeTone}`}>{badge.label}</span>
      </div>

      <SummaryTileGrid
        tone={tone}
        className="island-grid-secondary"
        items={[
          { label: "零点状态", value: formatCutterZeroState(state.position_known), tone },
          { label: "当前位置", value: state.position_known ? formatMillimeters(state.current_position_mm) : "未校准", tone },
          { label: "刀轴行程", value: formatCutterTravel(state), tone },
          { label: "驱动", value: formatCutterDriverState(state, error), tone: error || state.error ? "danger" : state.available ? "info" : "warning" },
        ]}
      />

      <div className={hint.className}>
        <span>{hint.label}</span>
        <strong>{hint.value}</strong>
      </div>

      <div className="summary-card">
        <span>当前摘要</span>
        <strong>{getCutterAxisSummary(state, error)}</strong>
      </div>

      {displayError ? <div className="error-text">{displayError}</div> : null}
    </section>
  );
}
