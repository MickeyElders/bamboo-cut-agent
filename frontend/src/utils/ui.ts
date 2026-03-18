import type { AiFrame, CutConfig } from "../types";

export type RunState = {
  code: string;
  label: string;
  detail: string;
};

export function formatPercent(value?: number | null) {
  return value == null ? "-" : `${value.toFixed(1)}%`;
}

export function formatTemp(value?: number | null) {
  return value == null ? "-" : `${value.toFixed(1)} °C`;
}

export function formatSeconds(value?: number | null) {
  if (value == null) return "-";
  const total = Math.max(0, Math.floor(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

export function formatRatio(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  return {
    red: parseInt(value.slice(0, 2), 16),
    green: parseInt(value.slice(2, 4), 16),
    blue: parseInt(value.slice(4, 6), 16)
  };
}

export function deriveRunState(frame: AiFrame, videoConnected: boolean): RunState {
  if (!videoConnected) {
    return {
      code: "video-offline",
      label: "视频离线",
      detail: "等待后端视频流与采集设备恢复。"
    };
  }
  if (frame.cut_request) {
    return {
      code: "position-ready",
      label: "到达切割位",
      detail: "CanMV 已报告目标进入切割触发区。"
    };
  }
  if (frame.detections.length > 0) {
    return {
      code: "feeding",
      label: "识别运行中",
      detail: "CanMV 正在跟踪目标，等待到达切割位。"
    };
  }
  return {
    code: "manual-ready",
    label: "待机",
    detail: "当前未发现目标，系统处于等待状态。"
  };
}

export function getLightSummary(count: number, brightness: number, color: string) {
  return `${count}/16 | 亮度 ${brightness}/255 | ${color.toUpperCase()}`;
}

export function getCutSummary(cutConfig: CutConfig) {
  return `位置 ${formatRatio(cutConfig.line_ratio_x)} | 容差 ${formatRatio(cutConfig.tolerance_ratio_x)} | 命中 ${cutConfig.min_hits} | 保持 ${cutConfig.hold_ms}ms | ${cutConfig.show_guide ? "显示辅助线" : "隐藏辅助线"}`;
}
