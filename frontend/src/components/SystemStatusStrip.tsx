import type { SystemStatus } from "../types";
import { formatPercent, formatSeconds, formatTemp } from "../utils/ui";

type SystemStatusStripProps = {
  status: SystemStatus;
};

export function SystemStatusStrip({ status }: SystemStatusStripProps) {
  return (
    <section className="panel side-panel">
      <div className="header">
        <h2>系统信息</h2>
      </div>

      <div className="system-strip">
        <article className="system-mini-card">
          <div className="system-mini-head">
            <h3>树莓派</h3>
            <span className="badge ok">{status.raspberry_pi.hostname}</span>
          </div>

          <div className="system-mini-metrics">
            <div className="system-mini-metric">
              <span>CPU</span>
              <strong>{formatPercent(status.raspberry_pi.cpu_percent)}</strong>
            </div>
            <div className="system-mini-metric">
              <span>内存</span>
              <strong>{formatPercent(status.raspberry_pi.memory_percent)}</strong>
            </div>
            <div className="system-mini-metric system-mini-metric-wide">
              <span>运行时长</span>
              <strong>{formatSeconds(status.raspberry_pi.uptime_seconds)}</strong>
            </div>
          </div>
        </article>

        <article className="system-mini-card">
          <div className="system-mini-head">
            <h3>CanMV</h3>
            <span className={`badge ${status.canmv_connected ? "ok" : "warn"}`}>
              {status.canmv_connected ? "在线" : "离线"}
            </span>
          </div>

          <div className="system-mini-metrics">
            <div className="system-mini-metric">
              <span>KPU</span>
              <strong>{formatPercent(status.canmv_status?.kpu_percent)}</strong>
            </div>
            <div className="system-mini-metric">
              <span>FPS</span>
              <strong>{status.canmv_fps?.toFixed(1) ?? "-"}</strong>
            </div>
            <div className="system-mini-metric">
              <span>温度</span>
              <strong>{formatTemp(status.canmv_status?.temperature_c)}</strong>
            </div>
            <div className="system-mini-metric">
              <span>最近上报</span>
              <strong>{formatSeconds(status.canmv_last_seen_seconds)}</strong>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
