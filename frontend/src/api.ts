import type { CommandAck, CutConfig, VideoConfig } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

async function postCommand(path: string, body?: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {})
  });

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
    blue
  });
}

export function switchLightOff() {
  return postCommand("/api/control/light", { action: "off" });
}

export function signalEmergencyStop() {
  return postCommand("/api/control/emergency-stop");
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
    body: JSON.stringify(config)
  });
  if (!res.ok) {
    throw new Error("Failed to save cut config");
  }
  return (await res.json()) as CutConfig;
}

export function uiWsUrl() {
  const fallback = "ws://localhost:8000/ws/ui";
  try {
    const api = API_BASE.replace(/^http/, "ws");
    return `${api}/ws/ui`;
  } catch {
    return fallback;
  }
}

export function videoWsUrl() {
  const fallback = "ws://localhost:8000/ws/video";
  try {
    const api = API_BASE.replace(/^http/, "ws");
    return `${api}/ws/video`;
  } catch {
    return fallback;
  }
}
