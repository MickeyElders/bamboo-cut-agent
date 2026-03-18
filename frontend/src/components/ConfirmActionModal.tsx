import { ModalShell } from "./ModalShell";

type ConfirmActionModalProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmActionModal(props: ConfirmActionModalProps) {
  const {
    open,
    title,
    description,
    confirmLabel,
    cancelLabel = "取消",
    onConfirm,
    onCancel
  } = props;

  if (!open) return null;

  return (
    <ModalShell title={title} badge="二次确认" badgeTone="warn" onClose={onCancel}>
      <div className="summary-card summary-card-warning">
        <span>提示</span>
        <strong>{description}</strong>
      </div>

      <div className="modal-actions modal-actions-dual">
        <button onClick={onCancel}>{cancelLabel}</button>
        <button className="primary" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}
