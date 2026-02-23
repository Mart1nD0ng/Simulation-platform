"""
Simple SUMO → WebSocket bridge.

Starts a SUMO simulation (requires SUMO + TraCI) and streams vehicle states to
web clients over WebSocket. Pair it with the browser SUMO client to visualize
vehicle locations alongside the PBFT animation.

Usage examples:
    python sumo_bridge.py --config path/to/scenario.sumocfg
    python sumo_bridge.py --config path/to/scenario.sumocfg --gui --port 8765

Expected WebSocket payload (sent each tick):
    {"step": 0, "vehicles": [{"id": "veh0", "x": 12.3, "y": 4.5, "speed": 10.0}]}

Dependencies:
    pip install websockets
    SUMO must be installed and SUMO_HOME set. TraCI is bundled with SUMO.
"""

import argparse
import asyncio
import json
import os
import sys
from typing import Dict, List

try:
    import traci  # type: ignore
    from sumolib import checkBinary  # type: ignore
except ImportError as exc:  # pragma: no cover - environment-specific
    raise SystemExit(
        "SUMO/TraCI not found. Install SUMO and ensure SUMO_HOME is set."
    ) from exc


async def stream_state(step_length: float, clients: "set[asyncio.Queue[str]]") -> None:
    step = 0
    while traci.simulation.getMinExpectedNumber() > 0:
        traci.simulationStep()
        vehicles: List[Dict[str, float]] = []
        for vid in traci.vehicle.getIDList():
            x, y = traci.vehicle.getPosition(vid)
            speed = traci.vehicle.getSpeed(vid)
            angle = traci.vehicle.getAngle(vid)  # SUMO angle: 0=North, clockwise in degrees
            vehicles.append({"id": vid, "x": float(x), "y": float(y), "speed": float(speed), "angle": float(angle)})

        payload = json.dumps({"step": step, "vehicles": vehicles})
        for queue in clients:
            await queue.put(payload)

        step += 1
        await asyncio.sleep(step_length)


async def websocket_handler(websocket, path, clients: "set[asyncio.Queue[str]]"):
    queue: asyncio.Queue[str] = asyncio.Queue()
    clients.add(queue)
    try:
        while True:
            message = await queue.get()
            await websocket.send(message)
    except asyncio.CancelledError:
        pass
    finally:
        clients.discard(queue)


async def main():
    parser = argparse.ArgumentParser(description="SUMO to WebSocket bridge")
    parser.add_argument("--config", required=True, help="Path to .sumocfg file")
    parser.add_argument("--port", type=int, default=8765, help="WebSocket port")
    parser.add_argument("--gui", action="store_true", help="Use sumo-gui instead of sumo")
    parser.add_argument(
        "--step-length",
        type=float,
        default=0.1,
        help="Seconds between streamed frames",
    )
    args = parser.parse_args()

    binary_name = "sumo-gui" if args.gui else "sumo"
    sumo_binary = checkBinary(binary_name)

    # Launch SUMO with TraCI interface enabled
    # Let TraCI choose a free port (avoids relying on missing constants).
    traci.start([sumo_binary, "-c", args.config, "--start"])

    clients: set[asyncio.Queue[str]] = set()

    import websockets

    server = await websockets.serve(
        lambda ws, path: websocket_handler(ws, path, clients),
        host="0.0.0.0",
        port=args.port,
    )

    try:
        await stream_state(args.step_length, clients)
    finally:
        server.close()
        await server.wait_closed()
        traci.close()


if __name__ == "__main__":
    if os.name == "nt":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nSUMO bridge stopped.")
