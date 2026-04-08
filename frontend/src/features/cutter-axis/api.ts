import type { CutterAxisState } from "../../types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

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
