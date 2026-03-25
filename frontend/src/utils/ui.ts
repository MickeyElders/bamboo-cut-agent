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

export function formatTime(value?: number | null) {
  if (value == null) return "-";
  const date = new Date(value * 1000);
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatRatio(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatDisk(used?: number | null, total?: number | null, percent?: number | null) {
  if (used == null || total == null || percent == null) return "-";
  return `${used.toFixed(1)} / ${total.toFixed(1)} GB (${percent.toFixed(1)}%)`;
}

export function formatInterfaceKind(value: string) {
  switch (value) {
    case "wifi":
      return "无线";
    case "ethernet":
      return "有线";
    case "other":
      return "其他";
    default:
      return "未知";
  }
}

export function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  return {
    red: parseInt(value.slice(0, 2), 16),
    green: parseInt(value.slice(2, 4), 16),
    blue: parseInt(value.slice(4, 6), 16),
  };
}

export function deriveRunState(frame: AiFrame, videoConnected: boolean): RunState {
  if (!videoConnected) {
    return {
      code: "video-offline",
      label: "画面离线",
      detail: "等待视频链路恢复。",
    };
  }
  if (frame.cut_request) {
    return {
      code: "position-ready",
      label: "到达切割位",
      detail: "CanMV 已确认目标进入切割触发区。",
    };
  }
  if (frame.detections.length > 0) {
    return {
      code: "feeding",
      label: "识别运行中",
      detail: "正在跟踪目标，等待进入切割位。",
    };
  }
  return {
    code: "manual-ready",
    label: "待机",
    detail: "当前未检测到目标。",
  };
}

export function getLightSummary(count: number, brightness: number, color: string) {
  return `${count}/16 颗 | 亮度 ${brightness}/255 | ${color.toUpperCase()}`;
}

export function getCutSummary(cutConfig: CutConfig) {
  return `位置 ${formatRatio(cutConfig.line_ratio_x)} | 容差 ${formatRatio(cutConfig.tolerance_ratio_x)} | 命中 ${cutConfig.min_hits} 次 | 保持 ${cutConfig.hold_ms} ms | ${cutConfig.show_guide ? "显示辅助线" : "隐藏辅助线"}`;
}

export function formatAutoState(value?: string | null) {
  switch (value) {
    case "manual_ready":
      return "手动待机";
    case "feeding":
      return "送料中";
    case "position_reached":
      return "到达切割位";
    case "clamping":
      return "压紧中";
    case "cutting":
      return "切割中";
    case "blade_return":
      return "刀片回程";
    case "release":
      return "释放中";
    case "emergency_stop":
      return "急停";
    case "auto_armed":
      return "自动就绪";
    case "waiting_cut_signal":
      return "等待切割信号";
    case "unknown":
    case undefined:
    case null:
      return "-";
    default:
      return value;
  }
}

export function formatLastAction(value?: string | null) {
  switch (value) {
    case "init":
      return "初始化";
    case "mode_manual":
      return "切换手动";
    case "mode_auto":
      return "切换自动";
    case "feed_start":
      return "启动送料";
    case "feed_stop":
      return "停止送料";
    case "clamp_engage":
      return "压紧夹持";
    case "clamp_release":
      return "释放夹持";
    case "cutter_down":
      return "刀片下压";
    case "cutter_up":
      return "刀片抬起";
    case "light_off":
      return "关闭灯光";
    case "light_set_count":
      return "调整亮灯数量";
    case "light_config":
      return "更新灯光配置";
    case "cut_request_received":
      return "收到切割请求";
    case "feed_stop_auto":
      return "自动停止送料";
    case "clamp_engage_auto":
      return "自动压紧";
    case "cutter_down_auto":
      return "自动下刀";
    case "cutter_up_auto":
      return "自动抬刀";
    case "clamp_release_auto":
      return "自动释放";
    case "cycle_complete":
      return "切割完成";
    case "emergency_stop":
      return "急停";
    case undefined:
    case null:
      return "-";
    default:
      return value;
  }
}
