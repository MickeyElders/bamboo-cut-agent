from __future__ import annotations

from fastapi import WebSocket


class WebSocketHub:
    def __init__(self) -> None:
        self.ui_clients: set[WebSocket] = set()

    async def add_ui(self, ws: WebSocket) -> None:
        await ws.accept()
        self.ui_clients.add(ws)

    def remove_ui(self, ws: WebSocket) -> None:
        self.ui_clients.discard(ws)

    async def broadcast_to_ui(self, payload: str) -> None:
        stale: list[WebSocket] = []
        for client in self.ui_clients:
            try:
                await client.send_text(payload)
            except Exception:
                stale.append(client)

        for client in stale:
            self.ui_clients.discard(client)
