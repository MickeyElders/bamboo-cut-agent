import type { CommandAck, CutConfig, EventItem, SystemActionAck, SystemMaintenanceSnapshot, VideoConfig } from "./types";

function resolveApiBase() {
  const configured = import.meta.env.VITE_API_BASE?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  if (typeof window === "undefined") {
    return "http://localhost:8000";
  }

  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  const hostname = window.location.hostname || "localhost";
  const port = import.meta.env.VITE_API_PORT?.trim() || "8000";
  return `${protocol}//${hostname}:${port}`;
}

const API_BASE = resolveApiBase();

function buildWsUrl(path: string) {
  try {
    const url = new URL(API_BASE);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = path;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

async function postCommand(path: string, body?: Record<string, unknown>) {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new Error(`无法连接设备控制服务: ${API_BASE}`);
  }

  if (!res.ok) {
    let detail = "";
    try {
      const payload = (await res.json()) as { detail?: string };
      detail = payload.detail ?? "";
    } catch {
      detail = "";
    }
    throw new Error(detail || `控制命令执行失败: ${path}`);
  }

  return (await res.json()) as CommandAck;
}

export function setManualMode() {
  return postCommand("/api/control/mode", { mode: "manual" });
}

export function setAutoMode() {
  return postCommand("/api/control/mode", { mode: "auto" });
}

export function startFeed() {
  return postCommand("/api/control/feed", { action: "start" });
}

export function stopFeed() {
  return postCommand("/api/control/feed", { action: "stop" });
}

export function engageClamp() {
  return postCommand("/api/control/clamp", { action: "engage" });
}

export function releaseClamp() {
  return postCommand("/api/control/clamp", { action: "release" });
}

export function startCutter() {
  return postCommand("/api/control/cutter", { action: "down" });
}

export function stopCutter() {
  return postCommand("/api/control/cutter", { action: "up" });
}

export function stopCutterMotion() {
  return postCommand("/api/control/cutter", { action: "stop" });
}

export function applyLightCount(count: number) {
  return postCommand("/api/control/light", { action: "set_count", value: count });
}

export function applyLightSettings(count: number, brightness: number, red: number, green: number, blue: number) {
  return postCommand("/api/control/light", {
    action: "configure",
    value: count,
    brightness,
    red,
    green,
    blue,
  });
}

export function switchLightOff() {
  return postCommand("/api/control/light", { action: "off" });
}

export function signalEmergencyStop() {
  return postCommand("/api/control/emergency-stop");
}

export function resetFault() {
  return postCommand("/api/control/fault-reset");
}

export async function fetchVideoConfig() {
  const res = await fetch(`${API_BASE}/api/video/config`);
  if (!res.ok) {
    throw new Error("Failed to fetch video config");
  }
  return (await res.json()) as VideoConfig;
}

export async function fetchCutConfig() {
  const res = await fetch(`${API_BASE}/api/cut-config`);
  if (!res.ok) {
    throw new Error("Failed to fetch cut config");
  }
  return (await res.json()) as CutConfig;
}

export async function saveCutConfig(config: Partial<CutConfig>) {
  const res = await fetch(`${API_BASE}/api/cut-config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    throw new Error("Failed to save cut config");
  }
  return (await res.json()) as CutConfig;
}

export async function fetchSystemMaintenance() {
  const res = await fetch(`${API_BASE}/api/system/maintenance`);
  if (!res.ok) {
    throw new Error("获取设备维护信息失败");
  }
  return (await res.json()) as SystemMaintenanceSnapshot;
}

type EventQuery = {
  limit?: number;
  category?: string;
  level?: string;
  since?: number;
};

export async function fetchSystemEvents(limitOrQuery: number | EventQuery = 100) {
  const query: EventQuery = typeof limitOrQuery === "number" ? { limit: limitOrQuery } : limitOrQuery;
  const params = new URLSearchParams();

  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.category) params.set("category", query.category);
  if (query.level) params.set("level", query.level);
  if (query.since !== undefined) params.set("since", String(query.since));

  const res = await fetch(`${API_BASE}/api/system/events?${params.toString()}`);
  if (!res.ok) {
    throw new Error("获取运行事件失败");
  }
  return (await res.json()) as EventItem[];
}

export async function executeSystemAction(action: string) {
  const res = await fetch(`${API_BASE}/api/system/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const payload = (await res.json()) as { detail?: string };
      detail = payload.detail ?? "";
    } catch {
      detail = "";
    }
    throw new Error(detail || `设备维护操作执行失败: ${action}`);
  }
  return (await res.json()) as SystemActionAck;
}

export function uiWsUrl() {
  return buildWsUrl("/ws/ui") || "ws://localhost:8000/ws/ui";
}

export function videoWsUrl() {
  return buildWsUrl("/ws/video") || "ws://localhost:8000/ws/video";
}
