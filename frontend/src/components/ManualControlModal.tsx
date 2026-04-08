import { formatMillimeters } from "../utils/ui";
import { formatCutterZeroState } from "../features/cutter-axis/formatters";
import { ModalShell } from "./ModalShell";
import { SummaryTileGrid } from "./SummaryTileGrid";

type ManualControlModalProps = {
  open: boolean;
  manualMode: boolean;
  error: string;
  pendingAction: string | null;
  cutterMotionActive: boolean;
  cutterMotionDirection: string | null;
  cutterStopSupported: boolean;
  cutterStopRequested: boolean;
  cutterPositionKnown: boolean;
  cutterPositionMm: number;
  onExit: () => void;
  onStartFeed: () => void;
  onStopFeed: () => void;
  onEngageClamp: () => void;
  onReleaseClamp: () => void;
  onStartCutter: () => void;
  onStopCutter: () => void;
  onAbortCutter: () => void;
};

export function ManualControlModal(props: ManualControlModalProps) {
  const {
    open,
    manualMode,
    error,
    pendingAction,
    cutterMotionActive,
    cutterMotionDirection,
    cutterStopSupported,
    cutterStopRequested,
    cutterPositionKnown,
    cutterPositionMm,
    onExit,
    onStartFeed,
    onStopFeed,
    onEngageClamp,
    onReleaseClamp,
    onStartCutter,
    onStopCutter,
    onAbortCutter
  } = props;
  const cutterDirectionText = cutterMotionDirection === "down" ? "下压中" : cutterMotionDirection === "up" ? "抬起中" : "空闲";

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
        <strong>刀轴行程保存与零点设置已移到主界面的刀轴标定入口，这里只保留动作调试。</strong>
      </div>

      {pendingAction ? (
        <div className="summary-card summary-card-info">
          <span>请求中</span>
          <strong>{pendingAction}</strong>
        </div>
      ) : null}

      <SummaryTileGrid
        tone="info"
        items={[
          { label: "刀轴状态", value: cutterMotionActive ? cutterDirectionText : "空闲", tone: cutterMotionActive ? "warning" : "success" },
          {
            label: "停止能力",
            value: cutterStopSupported ? (cutterStopRequested ? "停止请求已发出" : "可中止") : "未配置",
            tone: cutterStopSupported ? (cutterStopRequested ? "warning" : "success") : "warning",
          },
        ]}
      />

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
        <button className="primary" onClick={onStartCutter} disabled={!manualMode || cutterMotionActive}>
          切刀下压
        </button>
        <button onClick={onStopCutter} disabled={!manualMode || cutterMotionActive}>
          切刀抬起
        </button>
        <button className="warning" onClick={onAbortCutter} disabled={!manualMode || !cutterMotionActive || !cutterStopSupported}>
          停止刀轴
        </button>
      </div>

      {!cutterStopSupported ? (
        <div className="summary-card summary-card-warning">
          <span>安全提示</span>
          <strong>当前刀轴驱动尚未配置“停止当前运动”能力。请在控制器侧补齐停止位后再进行高风险调试。</strong>
        </div>
      ) : null}

      <div className="modal-actions modal-actions-single">
        <button className="mode-button" onClick={onExit}>
          退出手动调试
        </button>
      </div>

      {error ? <div className="error-text">{error}</div> : null}
    </ModalShell>
  );
}
