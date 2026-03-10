"""
Desktop-side simulator for CanMV AI frames.
Send mock detections to backend websocket ingest endpoint.

Usage:
  python examples/canmv_ws_sender.py --host 127.0.0.1 --port 8000
"""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import time

import websockets


async def run(uri: str, fps: float) -> None:
    interval = 1.0 / fps
    while True:
        try:
            async with websockets.connect(uri, ping_interval=10, ping_timeout=10) as ws:
                print(f"Connected: {uri}")
                while True:
                    msg = {
                        "timestamp": time.time(),
                        "fps": fps,
                        "detections": [
                            {
                                "label": "node",
                                "score": round(random.uniform(0.8, 0.99), 2),
                                "x": random.randint(50, 700),
                                "y": random.randint(50, 380),
                                "w": random.randint(40, 120),
                                "h": random.randint(30, 90),
                            }
                        ],
                    }
                    await ws.send(json.dumps(msg))
                    await asyncio.sleep(interval)
        except Exception as exc:
            print(f"Reconnect in 2s: {exc}")
            await asyncio.sleep(2)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--fps", type=float, default=10.0)
    return p.parse_args()


def main() -> None:
    args = parse_args()
    uri = f"ws://{args.host}:{args.port}/ws/canmv"
    asyncio.run(run(uri, args.fps))


if __name__ == "__main__":
    main()
