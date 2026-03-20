import { ModalShell } from "./ModalShell";

const LIGHT_PRESETS = [
  { label: "白光", color: "#ffffff" },
  { label: "红光", color: "#ff3b30" },
  { label: "黄光", color: "#ffd60a" },
  { label: "绿光", color: "#34c759" }
];

type LightSettingsModalProps = {
  open: boolean;
  count: number;
  brightness: number;
  color: string;
  applying: boolean;
  onCountChange: (value: number) => void;
  onBrightnessChange: (value: number) => void;
  onColorChange: (value: string) => void;
  onReset: () => void;
  onClose: () => void;
  onApply: () => void;
};

export function LightSettingsModal(props: LightSettingsModalProps) {
  const {
    open,
    count,
    brightness,
    color,
    applying,
    onCountChange,
    onBrightnessChange,
    onColorChange,
    onReset,
    onClose,
    onApply
  } = props;

  if (!open) return null;

  return (
    <ModalShell title="灯光设置" badge="手动配置" onClose={onClose}>
      <div className="slider-block">
        <div className="slider-head">
          <span>亮灯数量</span>
          <strong>{count} / 16</strong>
        </div>
        <input
          className="slider"
          type="range"
          min="0"
          max="16"
          step="1"
          value={count}
          disabled={applying}
          onChange={(event) => onCountChange(Number(event.target.value))}
        />
      </div>

      <div className="slider-block">
        <div className="slider-head">
          <span>亮度</span>
          <strong>{brightness} / 255</strong>
        </div>
        <input
          className="slider"
          type="range"
          min="0"
          max="255"
          step="1"
          value={brightness}
          disabled={applying}
          onChange={(event) => onBrightnessChange(Number(event.target.value))}
        />
      </div>

      <div className="color-picker-row">
        <span>颜色</span>
        <label className="color-picker">
          <input type="color" value={color} disabled={applying} onChange={(event) => onColorChange(event.target.value)} />
          <strong>{color.toUpperCase()}</strong>
        </label>
      </div>

      <div className="preset-row">
        {LIGHT_PRESETS.map((preset) => (
          <button
            key={preset.label}
            className={`preset-button ${color.toLowerCase() === preset.color ? "active" : ""}`}
            disabled={applying}
            onClick={() => onColorChange(preset.color)}
          >
            <span className="light-color-chip" style={{ backgroundColor: preset.color }} />
            {preset.label}
          </button>
        ))}
      </div>

      <div className="light-preview">
        <span>预览</span>
        <div className="light-preview-bar">
          {Array.from({ length: 16 }, (_, index) => (
            <span
              key={index}
              className={`light-preview-led ${index < count ? "active" : ""}`}
              style={index < count ? { backgroundColor: color, opacity: Math.max(brightness / 255, 0.15) } : undefined}
            />
          ))}
        </div>
      </div>

      <div className="modal-actions">
        <button onClick={onReset} disabled={applying}>恢复默认</button>
        <button onClick={onClose} disabled={applying}>取消</button>
        <button className="primary" onClick={onApply} disabled={applying}>
          {applying ? "应用中..." : "应用设置"}
        </button>
      </div>
    </ModalShell>
  );
}
