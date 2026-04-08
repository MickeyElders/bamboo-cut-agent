import type { CutterAxisState } from "../../types";
import { ModalShell } from "../../components/ModalShell";
import { SummaryTileGrid } from "../../components/SummaryTileGrid";
import { formatCutterDriverState, formatCutterPosition, formatCutterTravel, formatCutterZeroState, getCutterAxisSummary } from "./formatters";

type CutterCalibrationModalProps = {
  open: boolean;
  manualMode: boolean;
  state: CutterAxisState;
  strokeInput: string;
  jogStepInput: string;
  saving: boolean;
  zeroing: boolean;
  jogging: boolean;
  error: string;
  onClose: () => void;
  onStrokeInputChange: (value: string) => void;
  onJogStepInputChange: (value: string) => void;
  onSaveStroke: () => void;
  onSetZero: () => void;
  onJogForward: () => void;
  onJogReverse: () => void;
};

export function CutterCalibrationModal(props: CutterCalibrationModalProps) {
  const {
    open,
    manualMode,
    state,
    strokeInput,
    jogStepInput,
    saving,
    zeroing,
    jogging,
    error,
    onClose,
    onStrokeInputChange,
    onJogStepInputChange,
    onSaveStroke,
    onSetZero,
    onJogForward,
    onJogReverse,
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
          { label: "当前位置", value: formatCutterPosition(state), tone },
          { label: "刀轴行程", value: formatCutterTravel(state), tone: state.stroke_mm != null ? "info" : "warning" },
          { label: "驱动", value: formatCutterDriverState(state, error), tone: error || state.error ? "danger" : state.available ? "info" : "warning" },
        ]}
      />

      <div className="summary-card summary-card-warning">
        <span>设零条件</span>
        <strong>{zeroHelp}</strong>
      </div>

      <div className="summary-card summary-card-info">
        <span>零点设置</span>
        <strong>先用临时调整把刀轴移动到基准位置，再点击“设当前点为零点”。</strong>
      </div>

      <div className="controls controls-single">
        <button className="primary" onClick={onSetZero} disabled={!manualMode || zeroing}>
          {zeroing ? "正在设零..." : "设当前点为零点"}
        </button>
      </div>

      <div className="summary-card summary-card-info">
        <span>临时调整</span>
        <strong>
          {state.jog_supported
            ? "用于找零点时的小步点动。正转/反转是临时调整，不会覆盖已保存的刀轴行程。"
            : "当前刀轴驱动不支持按毫米临时调整。"}
        </strong>
      </div>

      <div className="controls controls-single">
        <input
          type="number"
          min="0.001"
          step="0.001"
          value={jogStepInput}
          onChange={(event) => onJogStepInputChange(event.target.value)}
          placeholder="临时调整步长 mm"
          disabled={!state.jog_supported || jogging}
        />
        <button onClick={onJogReverse} disabled={!manualMode || !state.jog_supported || jogging}>
          {jogging ? "调整中..." : "电机反转"}
        </button>
        <button className="primary" onClick={onJogForward} disabled={!manualMode || !state.jog_supported || jogging}>
          {jogging ? "调整中..." : "电机正转"}
        </button>
      </div>

      <div className="summary-card summary-card-info">
        <span>行程保存</span>
        <strong>零点确定后，再保存完整刀轴行程，系统后续的下压/抬起动作会基于这个行程运行。</strong>
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
