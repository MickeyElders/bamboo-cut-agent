from __future__ import annotations

import json
from pathlib import Path

from .models import CutConfig, CutConfigUpdate


class CutConfigStore:
    def __init__(self, path: str | None = None) -> None:
        default_path = Path(__file__).resolve().parent.parent / "data" / "cut_config.json"
        self._path = Path(path) if path else default_path
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._config = self._load()

    def get(self) -> CutConfig:
        return self._config.model_copy(deep=True)

    def update(self, patch: CutConfigUpdate) -> CutConfig:
        merged = self._config.model_dump()
        merged.update(patch.model_dump(exclude_unset=True, exclude_none=True))
        self._config = CutConfig.model_validate(merged)
        self._save()
        return self.get()

    def _load(self) -> CutConfig:
        if not self._path.exists():
            config = CutConfig()
            self._config = config
            self._save()
            return config

        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
            return CutConfig.model_validate(data)
        except Exception:
            config = CutConfig()
            self._config = config
            self._save()
            return config

    def _save(self) -> None:
        self._path.write_text(
            json.dumps(self._config.model_dump(), ensure_ascii=True, indent=2),
            encoding="utf-8",
        )
