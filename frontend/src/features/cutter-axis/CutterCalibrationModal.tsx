import type { CutterAxisState } from "../../types";
import { ModalShell } from "../../components/ModalShell";
import { SummaryTileGrid } from "../../components/SummaryTileGrid";
import { formatCutterDriverState, formatCutterPosition, formatCutterTravel, formatCutterZeroState, getCutterAxisSummary } from "./formatters";

type CutterCalibrationModalProps = {
  open: boolean;
  manualMode: boolean;
  state: CutterAxisState;
  strokeInput: string;
  saving: boolean;
  error: string;
  onClose: () => void;
  onStrokeInputChange: (value: string) => void;
  onSaveStroke: () => void;
};

export function CutterCalibrationModal(props: CutterCalibrationModalProps) {
  const {
    open,
    manualMode,
    state,
    strokeInput,
    saving,
    error,
    onClose,
    onStrokeInputChange,
    onSaveStroke,
  } = props;

  if (!open) return null;

  const tone = error || state.error ? "danger" : state.position_known ? "info" : "warning";
  const displayError = error || state.error || "";
  const zeroHelp = manualMode
    ? "零点设置与点按调整已并入手动调试，用于安装阶段找物理零点。"
    : "如需设零，请先进入手动调试，在手动调试中完成点按找零与设零。";

  return (
    <ModalShell title="刀轴标定" badge={manualMode ? "手动可设零" : "自动只读"} badgeTone={manualMode ? "warn" : "ok"} onClose={onClose}>
      <div className="summary-card summary-card-info">
        <span>标定说明</span>
        <strong>这里专门用于保存刀轴行程参数。零点确定应在手动调试里完成，行程保存后自动切割的下压和抬起都会基于这个行程运行。</strong>
      </div>

      <SummaryTileGrid
        tone={tone}
        items={[
          { label: "零点状态", value: formatCutterZeroState(state.position_known), tone: state.position_known ? "success" : "warning" },
          { label: "当前位置", value: formatCutterPosition(state), tone },
          { label: "刀轴行程", value: formatCutterTravel(state), tone: state.stroke_mm != null ? "info" : "warning" },
          { label: "驱动", value: formatCutterDriverState(state, error), tone: error || state.error ? "danger" : state.available ? "info" : "warning" },
        ]}
      />

      <div className="summary-card summary-card-warning">
        <span>零点流程</span>
        <strong>{zeroHelp}</strong>
      </div>

      <div className="summary-card summary-card-info">
        <span>行程保存</span>
        <strong>零点确定后，再在这里保存完整刀轴行程。这个行程是自动切割正式动作的基准参数。</strong>
      </div>

      <div className="controls controls-single">
        <input
          type="number"
          min="0.001"
          step="0.001"
          value={strokeInput}
          onChange={(event) => onStrokeInputChange(event.target.value)}
          placeholder="刀轴行程 mm"
        />
        <button className="primary" onClick={onSaveStroke} disabled={saving}>
          {saving ? "正在保存..." : "保存行程"}
        </button>
      </div>

      <div className="summary-card">
        <span>当前摘要</span>
        <strong>{getCutterAxisSummary(state, error)}</strong>
      </div>

      <div className="modal-actions modal-actions-single">
        <button onClick={onClose}>关闭</button>
      </div>

      {displayError ? <div className="error-text">{displayError}</div> : null}
    </ModalShell>
  );
}
