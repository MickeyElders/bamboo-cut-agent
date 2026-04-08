import { useCallback, useEffect, useState } from "react";
import type { CutterAxisState } from "../../types";
import { fetchCutterAxis, saveCutterAxis, setCutterAxisZero } from "./api";

const DEFAULT_CUTTER_AXIS: CutterAxisState = {
  position_known: false,
  current_position_mm: 0,
  stroke_mm: null,
  available: false,
  driver: null,
  error: null,
};

export function useCutterAxis() {
  const [state, setState] = useState<CutterAxisState>(DEFAULT_CUTTER_AXIS);
  const [error, setError] = useState("");
  const [strokeInput, setStrokeInput] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [zeroing, setZeroing] = useState(false);
  const [saving, setSaving] = useState(false);

  const syncFromSnapshot = useCallback((snapshot?: CutterAxisState | null) => {
    if (!snapshot) return;
    setState(snapshot);
    setError("");
    setStrokeInput((current) => current || (snapshot.stroke_mm != null ? String(snapshot.stroke_mm) : ""));
  }, []);

  const load = useCallback(async () => {
    try {
      const snapshot = await fetchCutterAxis();
      setState(snapshot);
      setError("");
      setStrokeInput(snapshot.stroke_mm != null ? String(snapshot.stroke_mm) : "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "获取刀轴位置失败");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveStroke = useCallback(async () => {
    const stroke = Number(strokeInput);
    if (!(stroke > 0)) {
      setError("请先填写有效的刀轴行程");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const next = await saveCutterAxis({ stroke_mm: stroke });
      setState(next);
      setStrokeInput(next.stroke_mm != null ? String(next.stroke_mm) : "");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存刀轴行程失败");
    } finally {
      setSaving(false);
    }
  }, [strokeInput]);

  const setZero = useCallback(async () => {
    setZeroing(true);
    setError("");
    try {
      const next = await setCutterAxisZero();
      setState(next);
    } catch (zeroError) {
      setError(zeroError instanceof Error ? zeroError.message : "设置刀轴零点失败");
    } finally {
      setZeroing(false);
    }
  }, []);

  const openModal = useCallback(() => {
    setModalOpen(true);
    void load();
  }, [load]);

  const closeModal = useCallback(() => {
    setModalOpen(false);
  }, []);

  return {
    state,
    error,
    strokeInput,
    saving,
    zeroing,
    modalOpen,
    openModal,
    closeModal,
    setStrokeInput,
    saveStroke,
    setZero,
    syncFromSnapshot,
    reload: load,
  };
}
