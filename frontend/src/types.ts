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
};

export type MotorStatus = {
  feed_running: boolean;
  cutter_down: boolean;
  last_action: string;
};
