import type { SystemMaintenanceSnapshot, SystemStatus } from "../types";
import { formatDisk, formatPercent, formatSeconds, formatTemp } from "../utils/ui";

type SystemStatusStripProps = {
  status: SystemStatus;
  maintenance: SystemMaintenanceSnapshot | null;
  videoConnected: boolean;
};

type StatusTone = "default" | "info" | "success" | "warning" | "danger";

function getDiskTone(percent?: number | null): StatusTone {
  if (percent == null) return "default";
  if (percent >= 90) return "danger";
  if (percent >= 75) return "warning";
  return "success";
}

function getDeviceStatus(maintenance: SystemMaintenanceSnapshot | null, videoConnected: boolean, aiConnected: boolean) {
  if ((maintenance?.disk_percent ?? 0) >= 90) {
    return {
      tone: "danger" as StatusTone,
      title: "存储空间紧张",
      detail: "建议尽快清理存储空间。",
    };
  }
  if (maintenance && !maintenance.network_online) {
    return {
      tone: "warning" as StatusTone,
      title: "网络连接受限",
      detail: "当前没有可用 IP，远程访问会受影响。",
    };
  }
  if (!videoConnected) {
    return {
      tone: "warning" as StatusTone,
      title: "画面链路异常",
      detail: "请检查视频采集与传输链路。",
    };
  }
  if (!aiConnected) {
    return {
      tone: "warning" as StatusTone,
      title: "AI 识别离线",
      detail: "CanMV 暂未在线，识别与切割触发不可用。",
    };
  }
  return {
    tone: "success" as StatusTone,
    title: "设备运行正常",
    detail: maintenance ? "网络、画面、AI 与存储状态正常。" : "实时状态正常，静态设备信息加载中。",
  };
}

function chipToneClass(tone: StatusTone) {
  return `status-chip-${tone}`;
}

export function SystemStatusStrip({ status, maintenance, videoConnected }: SystemStatusStripProps) {
  const aiConnected = status.canmv_connected;
  const device = getDeviceStatus(maintenance, videoConnected, aiConnected);
  const networkOnline = maintenance?.network_online ?? false;
  const primaryIp = maintenance?.ip_addresses?.[0] ?? "-";
  const wifi = maintenance?.wifi_ssid ?? "未连接";
  const storage = formatDisk(maintenance?.disk_used_gb, maintenance?.disk_total_gb, maintenance?.disk_percent);
  const syncLabel = maintenance ? "已同步" : "加载中";

  return (
    <section className="panel side-panel">
      <div className={`panel-section-tag panel-section-tag-${device.tone}`}>
        <span>系统总览</span>
      </div>
      <div className="header">
        <h2>设备状态</h2>
      </div>

      <div className="status-island-stack">
        <article className={`status-island status-island-hero tone-${device.tone}`}>
          <div className="status-island-head">
            <div>
              <span className="status-island-kicker">实时健康</span>
              <strong>{device.title}</strong>
            </div>
            <span className={`status-dot-pill tone-${device.tone}`}>{syncLabel}</span>
          </div>
          <p className="status-island-copy">{device.detail}</p>
          <div className="status-island-pills">
            <span className={`status-chip ${chipToneClass(device.tone)}`}>系统 {device.title}</span>
            <span className={`status-chip ${chipToneClass(networkOnline ? "success" : maintenance ? "warning" : "default")}`}>
              网络 {maintenance ? (networkOnline ? "在线" : "离线") : "加载中"}
            </span>
            <span className={`status-chip ${chipToneClass(videoConnected ? "success" : "warning")}`}>视频 {videoConnected ? "正常" : "异常"}</span>
            <span className={`status-chip ${chipToneClass(aiConnected ? "success" : "warning")}`}>AI {aiConnected ? "在线" : "离线"}</span>
          </div>
        </article>

        <div className="status-island-grid status-island-grid-dual">
          <article className="status-island status-island-subsystem">
            <div className="status-island-head compact">
              <div>
                <span className="status-island-kicker">Raspberry Pi</span>
                <strong>{status.raspberry_pi.hostname}</strong>
              </div>
              <span className="status-dot-pill tone-info">主控</span>
            </div>
            <div className="status-island-metrics compact">
              <div className="status-metric-pill">
                <span>CPU</span>
                <strong>{formatPercent(status.raspberry_pi.cpu_percent)}</strong>
              </div>
              <div className="status-metric-pill">
                <span>内存</span>
                <strong>{formatPercent(status.raspberry_pi.memory_percent)}</strong>
              </div>
              <div className="status-metric-pill status-metric-pill-wide">
                <span>运行时长</span>
                <strong>{formatSeconds(status.raspberry_pi.uptime_seconds)}</strong>
              </div>
            </div>
          </article>

          <article className="status-island status-island-subsystem status-island-subsystem-accent">
            <div className="status-island-head compact">
              <div>
                <span className="status-island-kicker">CanMV</span>
                <strong>{aiConnected ? "识别在线" : "识别离线"}</strong>
              </div>
              <span className={`status-dot-pill tone-${aiConnected ? "success" : "warning"}`}>{aiConnected ? "在线" : "离线"}</span>
            </div>
            <div className="status-island-metrics compact">
              <div className="status-metric-pill">
                <span>KPU</span>
                <strong>{formatPercent(status.canmv_status?.kpu_percent)}</strong>
              </div>
              <div className="status-metric-pill">
                <span>FPS</span>
                <strong>{status.canmv_fps?.toFixed(1) ?? "-"}</strong>
              </div>
              <div className="status-metric-pill">
                <span>温度</span>
                <strong>{formatTemp(status.canmv_status?.temperature_c)}</strong>
              </div>
              <div className="status-metric-pill">
                <span>最近上报</span>
                <strong>{formatSeconds(status.canmv_last_seen_seconds)}</strong>
              </div>
            </div>
          </article>
        </div>

        <div className="status-island-grid status-island-grid-pills">
          <article className="status-pill-island">
            <span>当前 IP</span>
            <strong>{primaryIp}</strong>
          </article>
          <article className="status-pill-island">
            <span>Wi-Fi</span>
            <strong>{wifi}</strong>
          </article>
          <article className="status-pill-island">
            <span>默认接口</span>
            <strong>{maintenance?.default_interface ?? "-"}</strong>
          </article>
          <article className="status-pill-island">
            <span>剩余空间</span>
            <strong>{maintenance?.disk_free_gb == null ? "-" : `${maintenance.disk_free_gb.toFixed(1)} GB`}</strong>
          </article>
        </div>

        <article className="status-island status-island-footer">
          <div className="status-island-head compact">
            <div>
              <span className="status-island-kicker">设备信息</span>
              <strong>{maintenance ? "网络与存储信息已同步" : "正在同步网络与存储信息"}</strong>
            </div>
            <span className={`status-dot-pill tone-${getDiskTone(maintenance?.disk_percent)}`}>存储</span>
          </div>
          <p className="status-island-copy">{storage}</p>
        </article>
      </div>
    </section>
  );
}
