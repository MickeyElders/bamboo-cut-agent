from __future__ import annotations

import json
import time
from pathlib import Path

from .models import CutterAxisState, CutterAxisUpdate


class CutterAxisStore:
    def __init__(self, path: str | None = None) -> None:
        default_path = Path(__file__).resolve().parent.parent / "data" / "cutter_axis.json"
        self._path = Path(path) if path else default_path
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._state = self._load()

    def get(self) -> CutterAxisState:
        return self._state.model_copy(deep=True)

    def update(self, patch: CutterAxisUpdate) -> CutterAxisState:
        merged = self._state.model_dump()
        merged.update(patch.model_dump(exclude_unset=True, exclude_none=True))
        merged["updated_at"] = time.time()
        self._state = CutterAxisState.model_validate(merged)
        self._save()
        return self.get()

    def mark_zero_here(self) -> CutterAxisState:
        return self.update(CutterAxisUpdate(position_known=True, current_position_mm=0.0))

    def apply_motion(self, *, down: bool) -> CutterAxisState:
        state = self._state
        if not state.position_known:
            return self.get()
        if down and state.stroke_down_mm is None:
            return self.get()
        if (not down) and state.stroke_up_mm is None:
            return self.get()

        delta = state.stroke_down_mm if down else -state.stroke_up_mm
        current = round(state.current_position_mm + delta, 4)
        return self.update(CutterAxisUpdate(current_position_mm=current))

    def _load(self) -> CutterAxisState:
        if not self._path.exists():
            state = self._default_state()
            self._state = state
            self._save()
            return state

        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
            return CutterAxisState.model_validate(data)
        except Exception:
            state = self._default_state()
            self._state = state
            self._save()
            return state

    def _default_state(self) -> CutterAxisState:
        return CutterAxisState(
            updated_at=time.time(),
        )

    def _save(self) -> None:
        self._path.write_text(
            json.dumps(self._state.model_dump(), ensure_ascii=True, indent=2),
            encoding="utf-8",
        )
