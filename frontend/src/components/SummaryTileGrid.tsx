import type { ReactNode } from "react";

export type SummaryTileTone = "default" | "info" | "success" | "warning" | "danger";

export type SummaryTileItem = {
  label: string;
  value: ReactNode;
  tone?: SummaryTileTone;
};

type SummaryTileGridProps = {
  items: SummaryTileItem[];
  tone?: SummaryTileTone;
};

export function SummaryTileGrid({ items, tone = "default" }: SummaryTileGridProps) {
  return (
    <div className={`summary-grid tone-${tone}`}>
      {items.map((item) => (
        <div className={`summary-tile tone-${item.tone ?? tone}`} key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}
