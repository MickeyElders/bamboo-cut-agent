import type { CutConfig, MotorStatus, SystemStatus, VideoConfig } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

export async function sendMotorCommand(
  command:
    | "mode_manual"
    | "mode_auto"
    | "feed_start"
    | "feed_stop"
    | "clamp_engage"
    | "clamp_release"
    | "cutter_down"
    | "cutter_up"
    | "light_on"
    | "light_off"
    | "emergency_stop"
) {
  const res = await fetch(`${API_BASE}/api/motor/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command })
  });
  if (!res.ok) {
    throw new Error(`Command failed: ${command}`);
  }
  return (await res.json()) as MotorStatus;
}

export async function fetchMotorStatus() {
  const res = await fetch(`${API_BASE}/api/motor/status`);
  if (!res.ok) {
    throw new Error("Failed to fetch motor status");
  }
  return (await res.json()) as MotorStatus;
}

export async function fetchVideoConfig() {
  const res = await fetch(`${API_BASE}/api/video/config`);
  if (!res.ok) {
    throw new Error("Failed to fetch video config");
  }
  return (await res.json()) as VideoConfig;
}

export async function fetchSystemStatus() {
  const res = await fetch(`${API_BASE}/api/system/status`);
  if (!res.ok) {
    throw new Error("Failed to fetch system status");
  }
  return (await res.json()) as SystemStatus;
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
