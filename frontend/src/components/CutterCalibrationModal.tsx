import type { CutterAxisState } from "../types";
import { formatCutterDriverState, formatCutterStroke, formatCutterZeroState, getCutterAxisSummary, formatMillimeters } from "../utils/ui";
import { ModalShell } from "./ModalShell";
import { SummaryTileGrid } from "./SummaryTileGrid";

type CutterCalibrationModalProps = {
  open: boolean;
  manualMode: boolean;
  state: CutterAxisState;
  strokeUpInput: string;
  strokeDownInput: string;
  saving: boolean;
  zeroing: boolean;
  error: string;
  onClose: () => void;
  onStrokeUpInputChange: (value: string) => void;
  onStrokeDownInputChange: (value: string) => void;
  onSaveStroke: () => void;
  onSetZero: () => void;
};

export function CutterCalibrationModal(props: CutterCalibrationModalProps) {
  const {
    open,
    manualMode,
    state,
    strokeUpInput,
    strokeDownInput,
    saving,
    zeroing,
    error,
    onClose,
    onStrokeUpInputChange,
    onStrokeDownInputChange,
    onSaveStroke,
    onSetZero,
  } = props;

  if (!open) return null;

  const tone = error || state.error ? "danger" : state.position_known ? "info" : "warning";
  const displayError = error || state.error || "";
  const zeroHelp = manualMode
    ? "当前处于手动模式，可以把刀轴当前物理位置设为零点。"
    : "设零属于现场标定动作，请先进入手动调试，再执行设零。";

  return (
    <ModalShell title="刀轴标定" badge={manualMode ? "手动可设零" : "自动只读"} badgeTone={manualMode ? "warn" : "ok"} onClose={onClose}>
      <div className="summary-card summary-card-info">
        <span>标定说明</span>
        <strong>步长是固定参数，零点是当前物理位置。建议先保存步长，再在基准位执行设零。</strong>
      </div>

      <SummaryTileGrid
        tone={tone}
        items={[
          { label: "零点状态", value: formatCutterZeroState(state.position_known), tone: state.position_known ? "success" : "warning" },
          { label: "当前位置", value: state.position_known ? formatMillimeters(state.current_position_mm) : "未校准", tone },
          { label: "程序步长", value: formatCutterStroke(state), tone: state.stroke_up_mm != null && state.stroke_down_mm != null ? "info" : "warning" },
          { label: "驱动", value: formatCutterDriverState(state, error), tone: error || state.error ? "danger" : state.available ? "info" : "warning" },
        ]}
      />

      <div className="summary-card summary-card-warning">
        <span>设零条件</span>
        <strong>{zeroHelp}</strong>
      </div>

      <div className="controls controls-single">
        <input
          type="number"
          min="0.001"
          step="0.001"
          value={strokeUpInput}
          onChange={(event) => onStrokeUpInputChange(event.target.value)}
          placeholder="上升步长 mm"
        />
        <input
          type="number"
          min="0.001"
          step="0.001"
          value={strokeDownInput}
          onChange={(event) => onStrokeDownInputChange(event.target.value)}
          placeholder="下降步长 mm"
        />
        <button className="primary" onClick={onSaveStroke} disabled={saving}>
          {saving ? "正在保存..." : "保存步长"}
        </button>
      </div>

      <div className="summary-card">
        <span>当前摘要</span>
        <strong>{getCutterAxisSummary(state, error)}</strong>
      </div>

      <div className="modal-actions modal-actions-dual">
        <button onClick={onClose}>关闭</button>
        <button className="primary" onClick={onSetZero} disabled={!manualMode || zeroing}>
          {zeroing ? "正在设零..." : "设当前位置为零点"}
        </button>
      </div>

      {displayError ? <div className="error-text">{displayError}</div> : null}
    </ModalShell>
  );
}
