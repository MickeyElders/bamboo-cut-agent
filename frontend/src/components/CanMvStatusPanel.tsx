import type { SystemStatus } from "../types";
import { formatPercent, formatSeconds, formatTemp } from "../utils/ui";
import { SummaryTileGrid } from "./SummaryTileGrid";

type CanMvStatusPanelProps = {
  status: SystemStatus;
};

export function CanMvStatusPanel({ status }: CanMvStatusPanelProps) {
  return (
    <section className="panel side-panel">
      <div className="header">
        <h2>CanMV</h2>
        <span className={`badge ${status.canmv_connected ? "ok" : "warn"}`}>
          {status.canmv_connected ? "在线" : "离线"}
        </span>
      </div>

      <SummaryTileGrid
        tone={status.canmv_connected ? "success" : "warning"}
        items={[
          { label: "CPU", value: formatPercent(status.canmv_status?.cpu_percent) },
          { label: "KPU", value: formatPercent(status.canmv_status?.kpu_percent) },
          { label: "内存", value: formatPercent(status.canmv_status?.memory_percent) },
          { label: "温度", value: formatTemp(status.canmv_status?.temperature_c) },
          { label: "FPS", value: status.canmv_fps?.toFixed(1) ?? "-" },
          { label: "最近上报", value: formatSeconds(status.canmv_last_seen_seconds) }
        ]}
      />
    </section>
  );
}
