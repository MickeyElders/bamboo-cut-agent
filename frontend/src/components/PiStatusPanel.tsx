import type { PiSystemStatus } from "../types";
import { formatPercent, formatSeconds } from "../utils/ui";
import { SummaryTileGrid } from "./SummaryTileGrid";

type PiStatusPanelProps = {
  status: PiSystemStatus;
};

export function PiStatusPanel({ status }: PiStatusPanelProps) {
  return (
    <section className="panel side-panel">
      <div className="header">
        <h2>树莓派状态</h2>
        <span className="badge ok">{status.hostname}</span>
      </div>

      <SummaryTileGrid
        tone="info"
        items={[
          { label: "CPU", value: formatPercent(status.cpu_percent) },
          { label: "内存", value: formatPercent(status.memory_percent) },
          { label: "运行时长", value: formatSeconds(status.uptime_seconds) }
        ]}
      />
    </section>
  );
}
