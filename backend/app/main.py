from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import api_router, control_router, system_router, ws_router
from .services import runtime


def create_app() -> FastAPI:
    app = FastAPI(title="Bamboo Cut Backend", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router)
    app.include_router(control_router)
    app.include_router(system_router)
    app.include_router(ws_router)

    @app.on_event("startup")
    async def startup() -> None:
        await runtime.startup()

    @app.on_event("shutdown")
    async def shutdown() -> None:
        await runtime.shutdown()

    return app


app = create_app()
