import { useMemo, useState } from "react";
import type { EventItem } from "../types";
import { formatTime } from "../utils/ui";
import { ModalShell } from "./ModalShell";

type EventHistoryModalProps = {
  open: boolean;
  events: EventItem[];
  loading: boolean;
  error: string;
  onClose: () => void;
  onRefresh: () => void;
};

export function EventHistoryModal({ open, events, loading, error, onClose, onRefresh }: EventHistoryModalProps) {
  const [levelFilter, setLevelFilter] = useState<"all" | "info" | "warning" | "error">("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | "runtime" | "control" | "fault" | "hardware" | "system">("all");

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      const levelMatched = levelFilter === "all" || event.level === levelFilter;
      const categoryMatched = categoryFilter === "all" || (event.category ?? "runtime") === categoryFilter;
      return levelMatched && categoryMatched;
    });
  }, [categoryFilter, events, levelFilter]);

  if (!open) return null;

  return (
    <ModalShell title="运行事件" badge="历史记录" badgeTone="ok" onClose={onClose}>
      <div className="maintenance-stack">
        <section className="maintenance-section">
          <div className="header">
            <h2>事件历史</h2>
            <div className="modal-toolbar">
              <button onClick={onRefresh} disabled={loading}>
                {loading ? "刷新中..." : "刷新"}
              </button>
            </div>
          </div>

          <div className="filter-row">
            <button className={`filter-button ${levelFilter === "all" ? "active" : ""}`} onClick={() => setLevelFilter("all")}>
              全部
            </button>
            <button className={`filter-button ${levelFilter === "info" ? "active" : ""}`} onClick={() => setLevelFilter("info")}>
              信息
            </button>
            <button className={`filter-button ${levelFilter === "warning" ? "active" : ""}`} onClick={() => setLevelFilter("warning")}>
              告警
            </button>
            <button className={`filter-button ${levelFilter === "error" ? "active" : ""}`} onClick={() => setLevelFilter("error")}>
              故障
            </button>
          </div>

          <div className="filter-row">
            <button className={`filter-button ${categoryFilter === "all" ? "active" : ""}`} onClick={() => setCategoryFilter("all")}>
              全部分组
            </button>
            <button className={`filter-button ${categoryFilter === "runtime" ? "active" : ""}`} onClick={() => setCategoryFilter("runtime")}>
              运行
            </button>
            <button className={`filter-button ${categoryFilter === "control" ? "active" : ""}`} onClick={() => setCategoryFilter("control")}>
              控制
            </button>
            <button className={`filter-button ${categoryFilter === "fault" ? "active" : ""}`} onClick={() => setCategoryFilter("fault")}>
              故障
            </button>
            <button className={`filter-button ${categoryFilter === "hardware" ? "active" : ""}`} onClick={() => setCategoryFilter("hardware")}>
              硬件
            </button>
            <button className={`filter-button ${categoryFilter === "system" ? "active" : ""}`} onClick={() => setCategoryFilter("system")}>
              系统
            </button>
          </div>

          {filteredEvents.length > 0 ? (
            <div className="maintenance-interface-list">
              {filteredEvents.map((event) => (
                <div className="maintenance-interface-item" key={`${event.timestamp}-${event.code}`}>
                  <div className="maintenance-interface-meta">
                    <strong>{formatTime(event.timestamp)}</strong>
                    <span>{event.category ?? "runtime"} / {event.level}</span>
                  </div>
                  <div className="maintenance-interface-meta">
                    <strong>{event.message}</strong>
                    <span>{event.code}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="summary-card summary-card-info">
              <span>运行事件</span>
              <strong>{loading ? "正在读取事件历史..." : "当前筛选下暂无记录"}</strong>
            </div>
          )}

          {error ? <div className="error-text">{error}</div> : null}
        </section>
      </div>
    </ModalShell>
  );
}
