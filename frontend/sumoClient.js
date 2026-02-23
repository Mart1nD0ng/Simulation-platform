// Lightweight SUMO WebSocket client helper
// Exposes a simple connect/subscribe API so the UI can show live SUMO state.

let socket = null;
let latestState = { step: 0, vehicles: [] };
const subscribers = new Set();

function notifySubscribers() {
    subscribers.forEach((cb) => {
        try {
            cb(latestState);
        } catch (err) {
            console.error("SUMO subscriber error", err);
        }
    });
}

export function subscribeSumo(callback) {
    subscribers.add(callback);
    callback(latestState);
    return () => subscribers.delete(callback);
}

export function getLatestSumoState() {
    return latestState;
}

export function connectToSumo(url, onStatusChange) {
    if (socket) {
        socket.close();
        socket = null;
    }

    if (!url) {
        onStatusChange && onStatusChange("missing-url");
        return () => {};
    }

    onStatusChange && onStatusChange("connecting");
    socket = new WebSocket(url);

    socket.onopen = () => {
        onStatusChange && onStatusChange("connected");
    };

    socket.onclose = () => {
        onStatusChange && onStatusChange("disconnected");
        socket = null;
    };

    socket.onerror = () => {
        onStatusChange && onStatusChange("error");
    };

    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data && Array.isArray(data.vehicles)) {
                latestState = {
                    step: data.step ?? 0,
                    vehicles: data.vehicles,
                    tls: data.tls || [],
                };
                notifySubscribers();
            }
        } catch (err) {
            console.error("Failed to parse SUMO message", err);
        }
    };

    return () => {
        if (socket) {
            socket.close();
            socket = null;
        }
    };
}
