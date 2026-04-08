import type { CutterAxisState } from "../../types";
import { formatMillimeters } from "../../utils/ui";

export function formatCutterZeroState(positionKnown: boolean) {
  return positionKnown ? "已设零" : "未设零";
}

export function formatCutterTravel(state: CutterAxisState) {
  if (state.stroke_mm != null) {
    return formatMillimeters(state.stroke_mm);
  }
  return "未配置";
}

export function formatCutterPosition(state: CutterAxisState) {
  if (state.available === false && !state.position_known) {
    return "无反馈";
  }
  return formatMillimeters(state.current_position_mm);
}

export function formatCutterDriverState(state: CutterAxisState, fallbackError = "") {
  if (fallbackError || state.error) return "异常";
  if (state.available === false) return "离线";
  if (state.available === true) return state.driver ? `在线 · ${state.driver}` : "在线";
  return "同步中";
}

export function getCutterAxisSummary(state: CutterAxisState, fallbackError = "") {
  const jogState = state.jog_supported ? "可微调" : "不可微调";
  return `${formatCutterZeroState(state.position_known)} | 行程 ${formatCutterTravel(state)} | ${formatCutterDriverState(state, fallbackError)} | ${jogState}`;
}
