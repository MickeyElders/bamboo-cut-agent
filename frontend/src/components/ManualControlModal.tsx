import { ModalShell } from "./ModalShell";

type ManualControlModalProps = {
  open: boolean;
  manualMode: boolean;
  error: string;
  onClose: () => void;
  onSetManual: () => void;
  onSetAuto: () => void;
  onStartFeed: () => void;
  onStopFeed: () => void;
  onEngageClamp: () => void;
  onReleaseClamp: () => void;
  onStartCutter: () => void;
  onStopCutter: () => void;
  onOpenLightSettings: () => void;
  onLightOff: () => void;
};

export function ManualControlModal(props: ManualControlModalProps) {
  const {
    open,
    manualMode,
    error,
    onClose,
    onSetManual,
    onSetAuto,
    onStartFeed,
    onStopFeed,
    onEngageClamp,
    onReleaseClamp,
    onStartCutter,
    onStopCutter,
    onOpenLightSettings,
    onLightOff
  } = props;

  if (!open) return null;

  return (
    <ModalShell
      title="手动调试"
      badge={manualMode ? "手动模式" : "自动模式"}
      badgeTone={manualMode ? "warn" : "ok"}
      onClose={onClose}
    >
      <div className="summary-card summary-card-warning">
        <span>说明</span>
        <strong>
          {manualMode
            ? "当前已进入手动模式，可执行安装调试动作。正常生产请完成后切回自动运行。"
            : "当前仍处于自动模式。如需调试，请先在主界面完成进入手动的确认操作。"}
        </strong>
      </div>

      {manualMode ? (
        <div className="mode-row mode-row-single">
          <button className="mode-button" onClick={onSetAuto}>
            切回自动
          </button>
        </div>
      ) : null}

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
        <button className="primary" onClick={onOpenLightSettings} disabled={!manualMode}>
          设置灯光
        </button>
        <button onClick={onLightOff} disabled={!manualMode}>
          关灯
        </button>
      </div>

      {error ? <div className="error-text">{error}</div> : null}
    </ModalShell>
  );
}
