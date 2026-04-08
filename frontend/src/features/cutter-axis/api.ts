import type { CutterAxisState } from "../../types";

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

async function readDetail(res: Response) {
  try {
    const payload = (await res.json()) as { detail?: string };
    return payload.detail ?? "";
  } catch {
    return "";
  }
}

export async function fetchCutterAxis() {
  const res = await fetch(`${API_BASE}/api/cutter-axis`);
  if (!res.ok) {
    throw new Error("获取刀轴位置失败");
  }
  return (await res.json()) as CutterAxisState;
}

export async function setCutterAxisZero() {
  const res = await fetch(`${API_BASE}/api/cutter-axis/zero`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error((await readDetail(res)) || "设置刀轴零点失败");
  }
  return (await res.json()) as CutterAxisState;
}

export async function saveCutterAxis(config: Partial<CutterAxisState>) {
  const res = await fetch(`${API_BASE}/api/cutter-axis`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    throw new Error((await readDetail(res)) || "保存刀轴行程失败");
  }
  return (await res.json()) as CutterAxisState;
}

export async function jogCutterAxis(direction: "forward" | "reverse", distanceMm: number) {
  const res = await fetch(`${API_BASE}/api/cutter-axis/jog`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ direction, distance_mm: distanceMm }),
  });
  if (!res.ok) {
    throw new Error((await readDetail(res)) || "执行刀轴临时调整失败");
  }
  return (await res.json()) as CutterAxisState;
}
