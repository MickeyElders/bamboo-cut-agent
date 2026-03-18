import type { ReactNode } from "react";

type ModalShellProps = {
  title: string;
  badge?: string;
  badgeTone?: "ok" | "warn";
  onClose: () => void;
  children: ReactNode;
};

export function ModalShell({ title, badge, badgeTone = "ok", onClose, children }: ModalShellProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(event) => event.stopPropagation()}>
        <div className="header">
          <h2>{title}</h2>
          {badge ? <span className={`badge ${badgeTone}`}>{badge}</span> : null}
        </div>
        {children}
      </div>
    </div>
  );
}
