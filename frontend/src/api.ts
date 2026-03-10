import type { MotorStatus } from "./types";

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

export function uiWsUrl() {
  const fallback = "ws://localhost:8000/ws/ui";
  try {
    const api = API_BASE.replace(/^http/, "ws");
    return `${api}/ws/ui`;
  } catch {
    return fallback;
  }
}
