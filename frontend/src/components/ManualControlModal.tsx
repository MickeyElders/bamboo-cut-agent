import { formatMillimeters } from "../utils/ui";
import { ModalShell } from "./ModalShell";

type ManualControlModalProps = {
  open: boolean;
  manualMode: boolean;
  error: string;
  cutterPositionKnown: boolean;
  cutterPositionMm: number;
  cutterStrokeUpMm?: number | null;
  cutterStrokeDownMm?: number | null;
  cutterStrokeUpInput: string;
  cutterStrokeDownInput: string;
  zeroing: boolean;
  saving: boolean;
  onExit: () => void;
  onSetZero: () => void;
  onStrokeUpInputChange: (value: string) => void;
  onStrokeDownInputChange: (value: string) => void;
  onSaveStroke: () => void;
  onStartFeed: () => void;
  onStopFeed: () => void;
  onEngageClamp: () => void;
  onReleaseClamp: () => void;
  onStartCutter: () => void;
  onStopCutter: () => void;
};

export function ManualControlModal(props: ManualControlModalProps) {
  const {
    open,
    manualMode,
    error,
    cutterPositionKnown,
    cutterPositionMm,
    cutterStrokeUpMm,
    cutterStrokeDownMm,
    cutterStrokeUpInput,
    cutterStrokeDownInput,
    zeroing,
    saving,
    onExit,
    onSetZero,
    onStrokeUpInputChange,
    onStrokeDownInputChange,
    onSaveStroke,
    onStartFeed,
    onStopFeed,
    onEngageClamp,
    onReleaseClamp,
    onStartCutter,
    onStopCutter
  } = props;

  if (!open) return null;
  const strokeConfigured = cutterStrokeUpMm != null && cutterStrokeDownMm != null;

  return (
    <ModalShell
      title="手动调试"
      badge={manualMode ? "手动模式" : "自动模式"}
      badgeTone={manualMode ? "warn" : "ok"}
      onClose={onExit}
      closeOnBackdrop={false}
    >
      <div className="summary-card summary-card-warning">
        <span>说明</span>
        <strong>
          {manualMode
            ? "当前已进入手动模式，可执行安装调试动作。正常生产请完成后切回自动运行。"
            : "当前仍处于自动模式。如需调试，请先在主界面完成进入手动的确认操作。"}
        </strong>
      </div>

      <div className="summary-grid tone-info">
        <div className="summary-tile">
          <span>当前位置</span>
          <strong>{cutterPositionKnown ? formatMillimeters(cutterPositionMm) : "未校准"}</strong>
        </div>
        <div className="summary-tile">
          <span>程序步长</span>
          <strong>
            {strokeConfigured
              ? `上升 ${formatMillimeters(cutterStrokeUpMm)} | 下降 ${formatMillimeters(cutterStrokeDownMm)}`
              : "未配置，当前无法准确累计当前位置"}
          </strong>
        </div>
      </div>

      {!strokeConfigured ? (
        <div className="summary-card summary-card-warning">
          <span>步长设置</span>
          <strong>请先设置 DKC 的上升/下降程序实际位移，保存后系统才会持久化并正确记录当前位置。</strong>
        </div>
      ) : null}

      <div className="controls controls-single">
        <input
          type="number"
          min="0.001"
          step="0.001"
          value={cutterStrokeUpInput}
          onChange={(event) => onStrokeUpInputChange(event.target.value)}
          placeholder="上升步长 mm"
        />
        <input
          type="number"
          min="0.001"
          step="0.001"
          value={cutterStrokeDownInput}
          onChange={(event) => onStrokeDownInputChange(event.target.value)}
          placeholder="下降步长 mm"
        />
        <button className="primary" onClick={onSaveStroke} disabled={!manualMode || saving}>
          {saving ? "正在保存..." : "保存步长"}
        </button>
      </div>

      <div className="controls controls-single">
        <button className="primary" onClick={onSetZero} disabled={!manualMode || zeroing}>
          {zeroing ? "正在设零..." : "设当前位置为零点"}
        </button>
      </div>

      <div className="controls controls-single">
        <button className="primary" onClick={onStartFeed} disabled={!manualMode}>
          启动送料
        </button>
        <button onClick={onStopFeed} disabled={!manualMode}>
          停止送料
        </button>
        <button className="primary" onClick={onEngageClamp} disabled={!manualMode}>
          压紧夹持
        </button>
        <button onClick={onReleaseClamp} disabled={!manualMode}>
          释放夹持
        </button>
        <button className="primary" onClick={onStartCutter} disabled={!manualMode}>
          切刀下压
        </button>
        <button onClick={onStopCutter} disabled={!manualMode}>
          切刀抬起
        </button>
      </div>

      <div className="modal-actions modal-actions-single">
        <button className="mode-button" onClick={onExit}>
          退出手动调试
        </button>
      </div>

      {error ? <div className="error-text">{error}</div> : null}
    </ModalShell>
  );
}
