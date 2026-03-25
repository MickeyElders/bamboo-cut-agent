import { ModalShell } from "./ModalShell";

type ConfirmActionModalProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  loading?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmActionModal(props: ConfirmActionModalProps) {
  const { open, title, description, confirmLabel, cancelLabel = "取消", loading = false, error = "", onConfirm, onCancel } = props;

  if (!open) return null;

  return (
    <ModalShell title={title} badge="二次确认" badgeTone="warn" onClose={onCancel}>
      <div className="summary-card summary-card-warning">
        <span>提示</span>
        <strong>{description}</strong>
      </div>

      {loading ? (
        <div className="summary-card summary-card-info">
          <span>处理中</span>
          <strong>正在执行，请稍候...</strong>
        </div>
      ) : null}

      {error ? <div className="error-text">{error}</div> : null}

      <div className="modal-actions modal-actions-dual">
        <button onClick={onCancel} disabled={loading}>
          {cancelLabel}
        </button>
        <button className="primary" onClick={onConfirm} disabled={loading}>
          {loading ? "处理中..." : confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}
