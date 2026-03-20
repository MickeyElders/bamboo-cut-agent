from .api import router as api_router
from .control import router as control_router
from .system import router as system_router
from .ws import router as ws_router

__all__ = ["api_router", "control_router", "system_router", "ws_router"]
