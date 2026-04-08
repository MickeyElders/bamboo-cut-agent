import { formatCutterZeroState, formatMillimeters } from "../utils/ui";
import { ModalShell } from "./ModalShell";
import { SummaryTileGrid } from "./SummaryTileGrid";

type ManualControlModalProps = {
  open: boolean;
  manualMode: boolean;
  error: string;
  cutterPositionKnown: boolean;
  cutterPositionMm: number;
  onExit: () => void;
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
    onExit,
    onStartFeed,
    onStopFeed,
    onEngageClamp,
    onReleaseClamp,
    onStartCutter,
    onStopCutter
  } = props;

  if (!open) return null;

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

      <SummaryTileGrid
        tone="info"
        items={[
          { label: "当前位置", value: cutterPositionKnown ? formatMillimeters(cutterPositionMm) : "未校准" },
          { label: "零点状态", value: formatCutterZeroState(cutterPositionKnown), tone: cutterPositionKnown ? "success" : "warning" },
        ]}
      />

      <div className="summary-card summary-card-info">
        <span>标定入口</span>
        <strong>步长保存与零点设置已移到主界面的刀轴标定入口，这里只保留动作调试。</strong>
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
