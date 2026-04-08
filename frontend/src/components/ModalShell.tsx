import type { ReactNode } from "react";

type ModalShellProps = {
  title: string;
  badge?: string;
  badgeTone?: "ok" | "warn";
  onClose: () => void;
  closeOnBackdrop?: boolean;
  panelClassName?: string;
  bodyClassName?: string;
  children: ReactNode;
};

export function ModalShell({
  title,
  badge,
  badgeTone = "ok",
  onClose,
  closeOnBackdrop = true,
  panelClassName,
  bodyClassName,
  children,
}: ModalShellProps) {
  return (
    <div className="modal-backdrop" onClick={closeOnBackdrop ? onClose : undefined}>
      <div className={panelClassName ? `modal-panel ${panelClassName}` : "modal-panel"} onClick={(event) => event.stopPropagation()}>
        <div className="header">
          <h2>{title}</h2>
          {badge ? <span className={`badge ${badgeTone}`}>{badge}</span> : null}
        </div>
        <div className={bodyClassName ? `modal-body ${bodyClassName}` : "modal-body"}>{children}</div>
      </div>
    </div>
  );
}
