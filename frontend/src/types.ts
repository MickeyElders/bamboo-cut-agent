export type Detection = {
  label: string;
  score: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type AiFrame = {
  timestamp: number;
  fps?: number;
  detections: Detection[];
  canmv_status?: CanMvSystemStatus;
};

export type MotorStatus = {
  feed_running: boolean;
  cutter_down: boolean;
  last_action: string;
};

export type VideoConfig = {
  enabled: boolean;
  detail?: string;
  device: string;
  width: number;
  height: number;
  fps: number;
  encoder: string;
  bitrate_kbps: number;
};

export type CanMvSystemStatus = {
  cpu_percent?: number | null;
  kpu_percent?: number | null;
  memory_percent?: number | null;
  temperature_c?: number | null;
};

export type PiSystemStatus = {
  hostname: string;
  cpu_percent?: number | null;
  memory_percent?: number | null;
  uptime_seconds?: number | null;
};

export type SystemStatus = {
  raspberry_pi: PiSystemStatus;
  canmv_connected: boolean;
  canmv_last_seen_seconds?: number | null;
  canmv_fps?: number | null;
  canmv_status?: CanMvSystemStatus | null;
};
