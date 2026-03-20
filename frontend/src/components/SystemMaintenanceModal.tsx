import type { SystemMaintenanceSnapshot } from "../types";
import { formatDisk, formatInterfaceKind } from "../utils/ui";
import { ModalShell } from "./ModalShell";
import { SummaryTileGrid } from "./SummaryTileGrid";

type SystemMaintenanceModalProps = {
  open: boolean;
  snapshot: SystemMaintenanceSnapshot | null;
  loading: boolean;
  applyingAction: string | null;
  error: string;
  onClose: () => void;
  onRefresh: () => void;
  onAction: (action: string) => void;
};

export function SystemMaintenanceModal(props: SystemMaintenanceModalProps) {
  const { open, snapshot, loading, applyingAction, error, onClose, onRefresh, onAction } = props;

  if (!open) return null;

  return (
    <ModalShell title="设备维护" badge="维护入口" badgeTone="warn" onClose={onClose}>
      <div className="maintenance-stack">
        <section className="maintenance-section">
          <div className="header">
            <h2>设备概览</h2>
            <button onClick={onRefresh} disabled={loading || applyingAction !== null}>
              {loading ? "刷新中..." : "刷新"}
            </button>
          </div>

          {snapshot ? (
            <>
              <SummaryTileGrid
                tone="info"
                items={[
                  { label: "设备名称", value: snapshot.hostname },
                  { label: "网络状态", value: snapshot.network_online ? "在线" : "离线", tone: snapshot.network_online ? "success" : "warning" },
                  { label: "默认接口", value: snapshot.default_interface ?? "-" },
                  { label: "Wi-Fi", value: snapshot.wifi_ssid ?? "未连接", tone: snapshot.wifi_ssid ? "success" : "warning" },
                ]}
              />

              <SummaryTileGrid
                tone="default"
                items={[
                  { label: "当前 IP", value: snapshot.ip_addresses.length > 0 ? snapshot.ip_addresses.join(", ") : "-" },
                  { label: "本机地址", value: snapshot.device_url },
                  { label: "存储状态", value: formatDisk(snapshot.disk_used_gb, snapshot.disk_total_gb, snapshot.disk_percent) },
                  { label: "剩余空间", value: snapshot.disk_free_gb == null ? "-" : `${snapshot.disk_free_gb.toFixed(1)} GB` },
                ]}
              />
            </>
          ) : (
            <div className="summary-card summary-card-info">
              <span>维护信息</span>
              <strong>{loading ? "正在读取设备维护信息..." : "暂无可用信息"}</strong>
            </div>
          )}
        </section>

        <section className="maintenance-section">
          <div className="header">
            <h2>网络接口</h2>
          </div>
          <div className="maintenance-interface-list">
            {snapshot?.interfaces.length ? (
              snapshot.interfaces.map((item) => (
                <div className="maintenance-interface-item" key={item.name}>
                  <div className="maintenance-interface-meta">
                    <strong>{item.name}</strong>
                    <span>{formatInterfaceKind(item.kind)}</span>
                  </div>
                  <div className="maintenance-interface-meta">
                    <strong>{item.is_up ? "在线" : "离线"}</strong>
                    <span>{item.ipv4.length > 0 ? item.ipv4.join(", ") : "无 IPv4"}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="summary-card">
                <span>网络</span>
                <strong>未检测到可用接口</strong>
              </div>
            )}
          </div>
        </section>

        <section className="maintenance-section">
          <div className="header">
            <h2>维护操作</h2>
          </div>
          <div className="maintenance-action-grid">
            <button className="surface-button" onClick={() => onAction("restart_app")} disabled={applyingAction !== null}>
              {applyingAction === "restart_app" ? "界面重启中..." : "重启界面"}
            </button>
            <button className="surface-button" onClick={() => onAction("restart_network")} disabled={applyingAction !== null}>
              {applyingAction === "restart_network" ? "网络重启中..." : "重启网络"}
            </button>
            <button className="surface-button warning" onClick={() => onAction("reboot_device")} disabled={applyingAction !== null}>
              {applyingAction === "reboot_device" ? "设备重启中..." : "重启设备"}
            </button>
            <button className="surface-button danger" onClick={() => onAction("shutdown_device")} disabled={applyingAction !== null}>
              {applyingAction === "shutdown_device" ? "设备关机中..." : "设备关机"}
            </button>
          </div>
        </section>

        {error ? <div className="error-text">{error}</div> : null}
      </div>
    </ModalShell>
  );
}
