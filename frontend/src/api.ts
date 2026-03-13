import type { MotorStatus, SystemStatus, VideoConfig } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

export async function sendMotorCommand(command: "feed_start" | "feed_stop" | "cutter_down" | "cutter_up" | "emergency_stop") {
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
