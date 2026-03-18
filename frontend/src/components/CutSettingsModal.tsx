import type { CutConfig } from "../types";
import { ModalShell } from "./ModalShell";

type CutSettingsModalProps = {
  open: boolean;
  cutConfig: CutConfig;
  cutDirty: boolean;
  cutSaving: boolean;
  onChange: <K extends keyof CutConfig>(key: K, value: CutConfig[K]) => void;
  onReset: () => void;
  onClose: () => void;
  onApply: () => void;
};

export function CutSettingsModal(props: CutSettingsModalProps) {
  const { open, cutConfig, cutDirty, cutSaving, onChange, onReset, onClose, onApply } = props;

  if (!open) return null;

  return (
    <ModalShell title="切割位设置" badge={cutDirty ? "待应用" : "已应用"} badgeTone={cutDirty ? "warn" : "ok"} onClose={onClose}>
      <label className="toggle-row">
        <span>显示辅助线</span>
        <input
          type="checkbox"
          checked={cutConfig.show_guide}
          onChange={(event) => onChange("show_guide", event.target.checked)}
        />
      </label>

      <div className="slider-block">
        <div className="slider-head">
          <span>切割线位置</span>
          <strong>{(cutConfig.line_ratio_x * 100).toFixed(1)}%</strong>
        </div>
        <input
          className="slider"
          type="range"
          min="0"
          max="1"
          step="0.001"
          value={cutConfig.line_ratio_x}
          onChange={(event) => onChange("line_ratio_x", Number(event.target.value))}
        />
      </div>

      <div className="slider-block">
        <div className="slider-head">
          <span>触发容差带</span>
          <strong>{(cutConfig.tolerance_ratio_x * 100).toFixed(1)}%</strong>
        </div>
        <input
          className="slider"
          type="range"
          min="0.001"
          max="0.05"
          step="0.001"
          value={cutConfig.tolerance_ratio_x}
          onChange={(event) => onChange("tolerance_ratio_x", Number(event.target.value))}
        />
      </div>

      <div className="slider-block">
        <div className="slider-head">
          <span>最少命中次数</span>
          <strong>{cutConfig.min_hits}</strong>
        </div>
        <input
          className="slider"
          type="range"
          min="1"
          max="20"
          step="1"
          value={cutConfig.min_hits}
          onChange={(event) => onChange("min_hits", Number(event.target.value))}
        />
      </div>

      <div className="slider-block">
        <div className="slider-head">
          <span>保持时间</span>
          <strong>{cutConfig.hold_ms} ms</strong>
        </div>
        <input
          className="slider"
          type="range"
          min="0"
          max="5000"
          step="50"
          value={cutConfig.hold_ms}
          onChange={(event) => onChange("hold_ms", Number(event.target.value))}
        />
      </div>

      <div className="modal-actions">
        <button onClick={onReset}>恢复默认</button>
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={onApply} disabled={cutSaving}>
          {cutSaving ? "保存中..." : "应用到 CanMV"}
        </button>
      </div>
    </ModalShell>
  );
}
