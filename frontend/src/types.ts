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
  cut_request?: boolean;
  cut_config?: CutConfig | null;
};

export type CommandAck = {
  ok: boolean;
  command: string;
  value?: number | null;
  timestamp: number;
};

export type CutterAxisState = {
  position_known: boolean;
  current_position_mm: number;
  stroke_mm?: number | null;
  available?: boolean;
  driver?: string | null;
  error?: string | null;
  updated_at?: number | null;
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

export type JobStatus = {
  mode: string;
  auto_state: string;
  cycle_count: number;
  last_action: string;
  cut_request_active: boolean;
  fault_active?: boolean;
  fault_code?: string | null;
  fault_detail?: string | null;
};

export type StartupCheck = {
  key: string;
  label: string;
  status: string;
  detail: string;
};

export type AlertItem = {
  level: string;
  code: string;
  title: string;
  detail: string;
};

export type EventItem = {
  timestamp: number;
  category?: string;
  level: string;
  code: string;
  message: string;
};

export type InputSignal = {
  key: string;
  label: string;
  pin?: number | null;
  active?: boolean | null;
  available: boolean;
  pull_up: boolean;
  active_high: boolean;
  detail: string;
};

export type SystemStatus = {
  schema_version?: string;
  raspberry_pi: PiSystemStatus;
  canmv_connected: boolean;
  canmv_last_seen_seconds?: number | null;
  canmv_fps?: number | null;
  canmv_status?: CanMvSystemStatus | null;
  job_status?: JobStatus | null;
  cutter_axis?: CutterAxisState | null;
  input_signals?: InputSignal[];
  startup_checks?: StartupCheck[];
  alerts?: AlertItem[];
  recent_events?: EventItem[];
};

export type CutConfig = {
  line_ratio_x: number;
  tolerance_ratio_x: number;
  show_guide: boolean;
  min_hits: number;
  hold_ms: number;
};

export type NetworkInterfaceStatus = {
  name: string;
  is_up: boolean;
  ipv4: string[];
  mac?: string | null;
  kind: string;
};

export type SystemMaintenanceSnapshot = {
  hostname: string;
  device_url: string;
  default_interface?: string | null;
  wifi_ssid?: string | null;
  network_online: boolean;
  ip_addresses: string[];
  interfaces: NetworkInterfaceStatus[];
  disk_total_gb?: number | null;
  disk_used_gb?: number | null;
  disk_free_gb?: number | null;
  disk_percent?: number | null;
  supported_actions: string[];
};

export type SystemActionAck = {
  ok: boolean;
  action: string;
  detail: string;
  timestamp: number;
};

export type DeviceIdentity = {
  schema_version?: string;
  local_uid: string;
  hostname: string;
  model: string;
  hardware_revision?: string | null;
  software_version: string;
};

