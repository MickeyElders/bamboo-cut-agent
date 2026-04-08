import { formatMillimeters } from "../utils/ui";
import { formatCutterZeroState } from "../features/cutter-axis/formatters";
import { ModalShell } from "./ModalShell";
import { SummaryTileGrid } from "./SummaryTileGrid";

type ManualControlModalProps = {
  open: boolean;
  manualMode: boolean;
  error: string;
  pendingAction: string | null;
  requestTrace?: string;
  cutterMotionActive: boolean;
  cutterMotionDirection: string | null;
  cutterStopSupported: boolean;
  cutterStopRequested: boolean;
  cutterPositionKnown: boolean;
  cutterPositionMm: number;
  cutterJogSupported: boolean;
  cutterJogStepInput: string;
  onExit: () => void;
  onCutterJogStepChange: (value: string) => void;
  onCutterJogForward: () => void;
  onCutterJogReverse: () => void;
  onSetCutterZero: () => void;
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
    requestTrace,
    cutterMotionActive,
    cutterMotionDirection,
    cutterStopSupported,
    cutterStopRequested,
    cutterPositionKnown,
    cutterPositionMm,
    cutterJogSupported,
    cutterJogStepInput,
    onExit,
    onCutterJogStepChange,
    onCutterJogForward,
    onCutterJogReverse,
    onSetCutterZero,
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
      panelClassName="manual-control-panel"
      bodyClassName="manual-control-body"
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
          { label: "当前模式", value: manualMode ? "已进入手动" : "仍在自动", tone: manualMode ? "success" : "warning" },
          { label: "点按能力", value: cutterJogSupported ? "后端已确认" : "后端未确认", tone: cutterJogSupported ? "success" : "warning" },
          { label: "动作锁定", value: cutterMotionActive ? cutterDirectionText : "未锁定", tone: cutterMotionActive ? "warning" : "success" },
          { label: "当前位置", value: cutterPositionKnown ? formatMillimeters(cutterPositionMm) : "未校准" },
          { label: "零点状态", value: formatCutterZeroState(cutterPositionKnown), tone: cutterPositionKnown ? "success" : "warning" },
        ]}
      />

      <div className="summary-card summary-card-info">
        <span>调试逻辑</span>
        <strong>先用点按方式正反转刀轴，找到物理零点后设当前位置为零点；下压和抬起用于验证自动切割动作是否到位。</strong>
      </div>

      {pendingAction ? (
        <div className="summary-card summary-card-info">
          <span>请求中</span>
          <strong>{pendingAction}</strong>
        </div>
      ) : null}

      {requestTrace ? (
        <div className="summary-card summary-card-info">
          <span>调用链路</span>
          <strong>{requestTrace}</strong>
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

      <div className="summary-card summary-card-info">
        <span>零点校准</span>
        <strong>安装阶段使用点按调刀轴，确认到达物理零点后，再把当前位置写成软件零点。</strong>
      </div>

      <div className="controls controls-single">
        <input
          type="number"
          min="0.001"
          step="0.001"
          value={cutterJogStepInput}
          onChange={(event) => onCutterJogStepChange(event.target.value)}
          placeholder="点按步长 mm"
          disabled={!manualMode || Boolean(pendingAction)}
        />
        <button type="button" onClick={onCutterJogReverse} disabled={!manualMode || cutterMotionActive || Boolean(pendingAction)}>
          电机反转
        </button>
        <button type="button" className="primary" onClick={onCutterJogForward} disabled={!manualMode || cutterMotionActive || Boolean(pendingAction)}>
          电机正转
        </button>
        <button type="button" className="primary" onClick={onSetCutterZero} disabled={!manualMode || cutterMotionActive || Boolean(pendingAction)}>
          设当前位置为零点
        </button>
      </div>

      {!cutterJogSupported ? (
        <div className="summary-card summary-card-warning">
          <span>点按能力</span>
          <strong>后端当前还没有确认点按能力。按钮仍会尝试发起请求，请结合后端日志检查串口、驱动类型和刀轴状态回传。</strong>
        </div>
      ) : null}

      <div className="summary-card summary-card-info">
        <span>动作验证</span>
        <strong>下压和抬起是自动切割时会触发的正式动作，这里只用于验证刀轴动作方向和到位情况。</strong>
      </div>

      <div className="controls controls-single">
        <button type="button" className="primary" onClick={onStartFeed} disabled={!manualMode || Boolean(pendingAction)}>
          启动送料
        </button>
        <button type="button" onClick={onStopFeed} disabled={!manualMode || Boolean(pendingAction)}>
          停止送料
        </button>
        <button type="button" className="primary" onClick={onEngageClamp} disabled={!manualMode || Boolean(pendingAction)}>
          压紧夹持
        </button>
        <button type="button" onClick={onReleaseClamp} disabled={!manualMode || Boolean(pendingAction)}>
          释放夹持
        </button>
        <button type="button" className="primary" onClick={onStartCutter} disabled={!manualMode || cutterMotionActive || Boolean(pendingAction)}>
          切刀下压
        </button>
        <button type="button" onClick={onStopCutter} disabled={!manualMode || cutterMotionActive || Boolean(pendingAction)}>
          切刀抬起
        </button>
        <button type="button" className="warning" onClick={onAbortCutter} disabled={!manualMode || !cutterMotionActive || !cutterStopSupported || Boolean(pendingAction)}>
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
        <button type="button" className="mode-button" onClick={onExit}>
          退出手动调试
        </button>
      </div>

      {error ? <div className="error-text">{error}</div> : null}
    </ModalShell>
  );
}
