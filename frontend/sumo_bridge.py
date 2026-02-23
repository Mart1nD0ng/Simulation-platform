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
import socket
import time
from typing import Dict, List, Any

# Global variable to store latest consensus data
latest_consensus_data: Dict[str, Any] = {
    "phase": "idle",
    "proposal_dir": "",
    "nodes": [],
    "links": [],
    "metrics": {
        "decision_latency_ms": 0,
        "topology_stability_score": 0,
        "throughput_gain_pct": 0
    }
}

try:
    import traci  # type: ignore
    from sumolib import checkBinary  # type: ignore
except ImportError as exc:  # pragma: no cover - environment-specific
    raise SystemExit(
        "SUMO/TraCI not found. Install SUMO and ensure SUMO_HOME is set."
    ) from exc


async def udp_listener():
    """Background task to listen for OMNeT++ UDP packets on port 8766"""
    global latest_consensus_data
    
    # Setup UDP socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", 8766))
    sock.setblocking(False)
    
    while True:
        try:
            # Check for data without blocking
            data, addr = sock.recvfrom(8192)
            payload = json.loads(data.decode('utf-8'))
            
            if payload.get("type") == "view_change":
                # Handle view change event if needed
                pass
            elif payload.get("type") == "topology_update" and "consensus" in payload:
                # Aggregate links from different vehicles
                if "links" in payload["consensus"]:
                    new_links = payload["consensus"]["links"]
                    # Convert existing links to a dictionary keyed by (from, to) for easy updating
                    links_dict = { (l["from"], l["to"]): l for l in latest_consensus_data.get("links", []) }
                    for link in new_links:
                        links_dict[(link["from"], link["to"])] = link
                    latest_consensus_data["links"] = list(links_dict.values())
            elif "consensus" in payload:
                # Update latest consensus data
                for key, value in payload["consensus"].items():
                    # Don't overwrite the aggregated links with empty/missing ones
                    if key != "links" or not latest_consensus_data.get("links"):
                        latest_consensus_data[key] = value
                
                # Apply traffic light commands immediately based on phase
                phase = latest_consensus_data.get("phase", "idle")
                apply_traffic_lights(phase, latest_consensus_data.get("proposal_dir", ""))
                
        except BlockingIOError:
            pass # No data available
        except Exception as e:
            print(f"UDP Error: {e}")
            
        await asyncio.sleep(0.01) # Poll at 100Hz

def apply_traffic_lights(phase: str, proposal_dir: str):
    """Control SUMO traffic lights via TraCI based on PBFT phases"""
    try:
        # Assuming the traffic light ID in crossroad is 'J1' for example, check your specific sim
        tl_id = traci.trafficlight.getIDList()[0] # Grab first one
        
        if phase in ["pre_prepare", "prepare"]:
            # Yellow blinking for negotiation
            traci.trafficlight.setRedYellowGreenState(tl_id, "yyyyyyyyyyyy")
        elif phase == "commit" and proposal_dir:
            # Set green for the winning direction
            # Assuming N=0-2, E=3-5, S=6-8, W=9-11 map depending on crossroad.net.xml
            # You might need to adjust the exact string based on your crossing
            state_list = ["r"] * 12
            if proposal_dir == "N":
                for i in range(0, 3): state_list[i] = "G"
            elif proposal_dir == "S":
                for i in range(6, 9): state_list[i] = "G"
            elif proposal_dir == "E":
                for i in range(3, 6): state_list[i] = "G"
            elif proposal_dir == "W":
                for i in range(9, 12): state_list[i] = "G"
            traci.trafficlight.setRedYellowGreenState(tl_id, "".join(state_list))
    except Exception as e:
        print(f"TraCI TL Error: {e}")

async def stream_state(step_length: float, clients: "set[asyncio.Queue[str]]") -> None:
    step = 0
    
    # Broadcast frequency limiter (e.g. 4Hz = 0.25s)
    BROADCAST_INTERVAL = 0.25
    last_broadcast_time = time.time()
    
    while traci.simulation.getMinExpectedNumber() > 0:
        traci.simulationStep()
        
        current_time = time.time()
        
        # Only broadcast at fixed interval
        if current_time - last_broadcast_time >= BROADCAST_INTERVAL:
            last_broadcast_time = current_time
            
            vehicles: List[Dict[str, float]] = []
            for vid in traci.vehicle.getIDList():
                x, y = traci.vehicle.getPosition(vid)
                speed = traci.vehicle.getSpeed(vid)
                angle = traci.vehicle.getAngle(vid)  # SUMO angle: 0=North, clockwise in degrees
                vehicles.append({"id": vid, "x": float(x), "y": float(y), "speed": float(speed), "angle": float(angle)})

            # Build dict mapping
            tls_dict = {}
            if len(traci.trafficlight.getIDList()) > 0:
                tl_id = traci.trafficlight.getIDList()[0]
                tl_state = traci.trafficlight.getRedYellowGreenState(tl_id)
                # Parse to compass directions (assuming standard layout N, E, S, W)
                # You must tailor this logic to your net.xml TL program
                tls_dict = {
                    "N": tl_state[0], # Using first char of group
                    "E": tl_state[3] if len(tl_state)>3 else 'r',
                    "S": tl_state[6] if len(tl_state)>6 else 'r',
                    "W": tl_state[9] if len(tl_state)>9 else 'r'
                }

            payload_dict = {
                "step": step, 
                "traffic": {
                    "vehicles": vehicles,
                    "traffic_lights": tls_dict
                },
                "consensus": latest_consensus_data
            }
            
            payload = json.dumps(payload_dict)
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

    import time
    import psutil
    
    print("Waiting for OMNeT++ (via sumo-launchd.py) to launch SUMO and expose the TraCI port...")
    connected = False
    sumo_port = None
    
    while not connected:
        # Scan for sumo or sumo-gui processes
        for proc in psutil.process_iter(['name', 'cmdline']):
            try:
                name = proc.info.get('name', '').lower()
                cmd = proc.info.get('cmdline') or []
                
                if 'sumo' in name:
                    # Look for the port argument (usually -remote-port or --remote-port)
                    for i, arg in enumerate(cmd):
                        if (arg == '--remote-port' or arg == '-remote-port') and i + 1 < len(cmd):
                            sumo_port = int(cmd[i+1])
                            break
                    if sumo_port:
                        break
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
                
        if sumo_port:
            try:
                # Try to connect to the discovered port (sumo-launchd uses the local loopback)
                traci.init(port=sumo_port, host="127.0.0.1", numClients=2, label="bridge")
                traci.setOrder(2)
                connected = True
                print(f"✅ Successfully attached to SUMO TraCI on port {sumo_port} as Client #2")
            except Exception as e:
                # Mismatch or SUMO not fully ready, sleep and retry
                time.sleep(1)
        else:
            time.sleep(1)

    clients: set[asyncio.Queue[str]] = set()

    import websockets

    server = await websockets.serve(
        lambda ws, path: websocket_handler(ws, path, clients),
        host="0.0.0.0",
        port=args.port,
    )
    
    # Start UDP listener task
    udp_task = asyncio.create_task(udp_listener())

    try:
        await stream_state(args.step_length, clients)
    finally:
        udp_task.cancel()
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
