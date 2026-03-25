import type { SystemMaintenanceSnapshot, SystemStatus } from "../types";
import { formatDisk, formatPercent, formatSeconds, formatTemp } from "../utils/ui";
import { SummaryTileGrid, type SummaryTileTone } from "./SummaryTileGrid";

type SystemStatusStripProps = {
  status: SystemStatus;
  maintenance: SystemMaintenanceSnapshot | null;
  videoConnected: boolean;
};

function getDiskTone(percent?: number | null): SummaryTileTone {
  if (percent == null) return "default";
  if (percent >= 90) return "danger";
  if (percent >= 75) return "warning";
  return "success";
}

function getDeviceStatus(maintenance: SystemMaintenanceSnapshot | null, videoConnected: boolean, aiConnected: boolean) {
  if ((maintenance?.disk_percent ?? 0) >= 90) {
    return {
      tone: "danger" as SummaryTileTone,
      title: "存储空间紧张",
      detail: "建议尽快清理存储空间。",
    };
  }
  if (maintenance && !maintenance.network_online) {
    return {
      tone: "warning" as SummaryTileTone,
      title: "网络连接受限",
      detail: "当前没有可用 IP，远程访问会受影响。",
    };
  }
  if (!videoConnected) {
    return {
      tone: "warning" as SummaryTileTone,
      title: "画面链路异常",
      detail: "请检查视频采集与传输链路。",
    };
  }
  if (!aiConnected) {
    return {
      tone: "warning" as SummaryTileTone,
      title: "AI 识别离线",
      detail: "CanMV 暂未在线，识别与切割触发不可用。",
    };
  }
  return {
    tone: "success" as SummaryTileTone,
    title: "设备运行正常",
    detail: maintenance ? "网络、画面、AI 与存储状态正常。" : "实时状态正常，静态设备信息加载中。",
  };
}

export function SystemStatusStrip({ status, maintenance, videoConnected }: SystemStatusStripProps) {
  const aiConnected = status.canmv_connected;
  const device = getDeviceStatus(maintenance, videoConnected, aiConnected);

  return (
    <section className="panel side-panel">
      <div className={`panel-section-tag panel-section-tag-${device.tone}`}>
        <span>系统总览</span>
      </div>
      <div className="header">
        <h2>设备状态</h2>
      </div>

      <div className={`system-health-banner tone-${device.tone}`}>
        <span>实时状态</span>
        <strong>{device.title}</strong>
        <p>{device.detail}</p>
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
            <span className={`badge ${aiConnected ? "ok" : "warn"}`}>{aiConnected ? "在线" : "离线"}</span>
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

      <SummaryTileGrid
        tone={device.tone}
        className="island-grid island-grid-primary"
        items={[
          { label: "设备状态", value: device.title, tone: device.tone },
          {
            label: "网络状态",
            value: maintenance ? (maintenance.network_online ? "在线" : "离线") : "加载中",
            tone: maintenance ? (maintenance.network_online ? "success" : "warning") : "default",
          },
          { label: "画面状态", value: videoConnected ? "正常" : "异常", tone: videoConnected ? "success" : "warning" },
          { label: "AI 识别", value: aiConnected ? "在线" : "离线", tone: aiConnected ? "success" : "warning" },
        ]}
      />

      <div className="summary-card">
        <span>设备信息</span>
        <strong>{maintenance ? "网络与存储信息已同步" : "正在同步网络与存储信息"}</strong>
      </div>

      <SummaryTileGrid
        tone="info"
        className="island-grid island-grid-secondary"
        items={[
          { label: "当前 IP", value: maintenance?.ip_addresses?.[0] ?? "-" },
          { label: "Wi-Fi", value: maintenance?.wifi_ssid ?? "未连接", tone: maintenance?.wifi_ssid ? "success" : "warning" },
          { label: "默认接口", value: maintenance?.default_interface ?? "-" },
          { label: "剩余空间", value: maintenance?.disk_free_gb == null ? "-" : `${maintenance.disk_free_gb.toFixed(1)} GB` },
        ]}
      />

      <SummaryTileGrid
        tone="default"
        className="island-grid island-grid-tertiary"
        items={[
          {
            label: "存储状态",
            value: formatDisk(maintenance?.disk_used_gb, maintenance?.disk_total_gb, maintenance?.disk_percent),
            tone: getDiskTone(maintenance?.disk_percent),
          },
          {
            label: "存储余量",
            value: maintenance?.disk_free_gb == null ? "-" : `${maintenance.disk_free_gb.toFixed(1)} GB`,
            tone: getDiskTone(maintenance?.disk_percent),
          },
        ]}
      />
    </section>
  );
}
