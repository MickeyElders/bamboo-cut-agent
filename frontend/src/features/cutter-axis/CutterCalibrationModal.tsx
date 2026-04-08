import type { CutterAxisState } from "../../types";
import { ModalShell } from "../../components/ModalShell";
import { SummaryTileGrid } from "../../components/SummaryTileGrid";
import { formatMillimeters } from "../../utils/ui";
import { formatCutterDriverState, formatCutterTravel, formatCutterZeroState, getCutterAxisSummary } from "./formatters";

type CutterCalibrationModalProps = {
  open: boolean;
  manualMode: boolean;
  state: CutterAxisState;
  strokeInput: string;
  saving: boolean;
  zeroing: boolean;
  error: string;
  onClose: () => void;
  onStrokeInputChange: (value: string) => void;
  onSaveStroke: () => void;
  onSetZero: () => void;
};

export function CutterCalibrationModal(props: CutterCalibrationModalProps) {
  const {
    open,
    manualMode,
    state,
    strokeInput,
    saving,
    zeroing,
    error,
    onClose,
    onStrokeInputChange,
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
        <strong>刀轴行程是固定参数，零点是当前物理位置。建议先保存行程，再在基准位执行设零。</strong>
      </div>

      <SummaryTileGrid
        tone={tone}
        items={[
          { label: "零点状态", value: formatCutterZeroState(state.position_known), tone: state.position_known ? "success" : "warning" },
          { label: "当前位置", value: state.position_known ? formatMillimeters(state.current_position_mm) : "未校准", tone },
          { label: "刀轴行程", value: formatCutterTravel(state), tone: state.stroke_mm != null ? "info" : "warning" },
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
