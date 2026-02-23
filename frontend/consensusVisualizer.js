/**
 * Consensus & Communication Visualizer
 * 
 * This module provides visual effects for distributed consensus algorithms.
 * Algorithm developers can trigger visualizations by sending events via WebSocket.
 * 
 * Event Types:
 * - message: { type: "message", from: "veh_id", to: "veh_id" | "broadcast", msgType: "PREPARE"|"COMMIT"|"REPLY", data: any }
 * - state_change: { type: "state_change", vehicle: "veh_id", state: "idle"|"preparing"|"prepared"|"committing"|"committed"|"failed" }
 * - consensus_progress: { type: "consensus_progress", phase: "prepare"|"commit"|"reply", current: number, required: number }
 * - decision_zone: { type: "decision_zone", vehicles: ["veh_id", ...], active: boolean }
 * - topology_update: { type: "topology_update", links: [{ from: "veh_id", to: "veh_id", strength: 0-1 }] }
 */

export class ConsensusVisualizer {
    constructor(canvas, ctx, vehicleStates, sumoState) {
        this.canvas = canvas;
        this.ctx = ctx;
        this.vehicleStatesRef = vehicleStates;
        this.sumoStateRef = sumoState;

        // Active visual effects
        this.messageParticles = [];
        this.vehicleConsensusStates = {}; // { vehicleId: { state: string, timestamp: number } }
        this.consensusProgress = { phase: 'idle', current: 0, required: 4, timestamp: 0 };
        this.decisionZoneVehicles = new Set();
        this.topologyLinks = [];
        this.eventLog = [];
        this.maxLogEntries = 50;

        // Animation settings
        this.particleSpeed = 5;
        this.particleLifetime = 1500; // ms

        // Communication range visualization
        this.showCommRange = false;
        this.commRange = 50; // meters

        // Analytics data
        this.analytics = {
            messagesByType: {
                PREPARE: 0,
                PRE_PREPARE: 0,
                COMMIT: 0,
                REPLY: 0,
                REQUEST: 0,
                HEARTBEAT: 0,
                OTHER: 0
            },
            stateDistribution: {
                idle: 0,
                preparing: 0,
                committing: 0,
                committed: 0,
                failed: 0
            },
            activityHistory: [], // messages per second over time
            roundsCompleted: 0,
            totalLatency: 0,
            successfulRounds: 0,
            lastSecondMessages: 0,
            lastSecondTimestamp: Date.now()
        };

        // State colors with glow effects
        this.stateColors = {
            idle: { fill: '#6e7681', glow: 'rgba(110, 118, 129, 0.4)' },
            preparing: { fill: '#f0883e', glow: 'rgba(240, 136, 62, 0.6)' },
            prepared: { fill: '#f0883e', glow: 'rgba(240, 136, 62, 0.8)' },
            committing: { fill: '#4ecdc4', glow: 'rgba(78, 205, 196, 0.6)' },
            committed: { fill: '#2ea043', glow: 'rgba(46, 160, 67, 0.8)' },
            failed: { fill: '#f85149', glow: 'rgba(248, 81, 73, 0.8)' },
            leader: { fill: '#a371f7', glow: 'rgba(163, 113, 247, 0.8)' }
        };

        // Message type colors
        this.messageColors = {
            PREPARE: '#f0883e',
            PRE_PREPARE: '#d29922',
            COMMIT: '#4ecdc4',
            REPLY: '#2ea043',
            REQUEST: '#a371f7',
            HEARTBEAT: '#8b949e',
            DEFAULT: '#ffffff'
        };
    }

    /**
     * Process incoming events from WebSocket
     */
    processEvents(events) {
        if (!events || !Array.isArray(events)) return;

        const now = Date.now();

        events.forEach(event => {
            switch (event.type) {
                case 'message':
                    this.addMessageParticle(event, now);
                    this.logEvent(event, now);
                    // Update analytics
                    this.updateMessageStats(event);
                    break;
                case 'state_change':
                    this.updateVehicleState(event, now);
                    this.logEvent(event, now);
                    break;
                case 'consensus_progress':
                    this.updateConsensusProgress(event, now);
                    // Track completed rounds
                    if (event.current >= event.required && event.phase !== 'idle') {
                        this.analytics.roundsCompleted++;
                        this.analytics.successfulRounds++;
                    }
                    break;
                case 'decision_zone':
                    this.updateDecisionZone(event);
                    break;
                case 'topology_update':
                    this.updateTopology(event);
                    break;
            }
        });

        // Update activity tracking
        this.updateActivityTracking(now);
    }

    /**
     * Update message statistics
     */
    updateMessageStats(event) {
        const msgType = event.msgType || 'OTHER';
        if (this.analytics.messagesByType[msgType] !== undefined) {
            this.analytics.messagesByType[msgType]++;
        } else {
            this.analytics.messagesByType.OTHER++;
        }
        this.analytics.lastSecondMessages++;
    }

    /**
     * Update activity tracking (messages per second)
     */
    updateActivityTracking(now) {
        const elapsed = now - this.analytics.lastSecondTimestamp;
        if (elapsed >= 1000) {
            this.analytics.activityHistory.push(this.analytics.lastSecondMessages);
            if (this.analytics.activityHistory.length > 60) {
                this.analytics.activityHistory.shift();
            }
            this.analytics.lastSecondMessages = 0;
            this.analytics.lastSecondTimestamp = now;
        }
    }

    /**
     * Calculate state distribution
     */
    calculateStateDistribution() {
        const distribution = { idle: 0, preparing: 0, committing: 0, committed: 0, failed: 0 };
        const totalVehicles = this.sumoStateRef.vehicles ? this.sumoStateRef.vehicles.length : 0;

        Object.values(this.vehicleConsensusStates).forEach(state => {
            const s = state.state;
            if (s === 'preparing' || s === 'prepared') {
                distribution.preparing++;
            } else if (s === 'committing') {
                distribution.committing++;
            } else if (s === 'committed') {
                distribution.committed++;
            } else if (s === 'failed') {
                distribution.failed++;
            }
        });

        // Remaining vehicles are idle
        const tracked = distribution.preparing + distribution.committing + distribution.committed + distribution.failed;
        distribution.idle = Math.max(0, totalVehicles - tracked);

        this.analytics.stateDistribution = distribution;
        return distribution;
    }

    /**
     * Add a message particle animation
     */
    addMessageParticle(event, timestamp) {
        const { from, to, msgType, data } = event;
        const color = this.messageColors[msgType] || this.messageColors.DEFAULT;

        if (to === 'broadcast') {
            // Broadcast to all vehicles
            const vehicles = this.sumoStateRef.vehicles || [];
            vehicles.forEach(v => {
                if (v.id !== from) {
                    this.messageParticles.push({
                        from: from,
                        to: v.id,
                        color: color,
                        msgType: msgType,
                        progress: 0,
                        timestamp: timestamp,
                        data: data
                    });
                }
            });
        } else {
            this.messageParticles.push({
                from: from,
                to: to,
                color: color,
                msgType: msgType,
                progress: 0,
                timestamp: timestamp,
                data: data
            });
        }
    }

    /**
     * Update vehicle consensus state
     */
    updateVehicleState(event, timestamp) {
        this.vehicleConsensusStates[event.vehicle] = {
            state: event.state,
            timestamp: timestamp,
            pulsePhase: 0
        };
    }

    /**
     * Update consensus progress
     */
    updateConsensusProgress(event, timestamp) {
        this.consensusProgress = {
            phase: event.phase || 'prepare',
            current: event.current || 0,
            required: event.required || 4,
            timestamp: timestamp
        };
    }

    /**
     * Update decision zone
     */
    updateDecisionZone(event) {
        if (event.active) {
            event.vehicles.forEach(v => this.decisionZoneVehicles.add(v));
        } else {
            event.vehicles.forEach(v => this.decisionZoneVehicles.delete(v));
        }
    }

    /**
     * Update network topology
     */
    updateTopology(event) {
        this.topologyLinks = event.links || [];
    }

    /**
     * Log an event
     */
    logEvent(event, timestamp) {
        this.eventLog.unshift({
            ...event,
            timestamp: timestamp,
            id: Math.random().toString(36).substr(2, 9)
        });

        if (this.eventLog.length > this.maxLogEntries) {
            this.eventLog.pop();
        }
    }

    /**
     * Update all animations (call each frame)
     */
    update(deltaTime) {
        const now = Date.now();

        // Update message particles
        this.messageParticles = this.messageParticles.filter(p => {
            p.progress += deltaTime / this.particleLifetime;
            return p.progress < 1;
        });

        // Update pulse phases for state rings
        Object.values(this.vehicleConsensusStates).forEach(state => {
            state.pulsePhase = (state.pulsePhase + deltaTime * 0.003) % (Math.PI * 2);
        });
    }

    /**
     * Draw communication range circles around vehicles
     */
    drawCommunicationRanges(transform, scale) {
        if (!this.showCommRange) return;

        const c = this.ctx;
        const vehicleStates = this.vehicleStatesRef;
        const rangePixels = this.commRange * scale;
        const time = Date.now() * 0.001;

        // Draw range circles for each vehicle
        Object.entries(vehicleStates).forEach(([vehicleId, vState]) => {
            const x = transform.x(vState.sx);
            const y = transform.y(vState.sy);

            // Animated dashed circle
            c.save();
            c.strokeStyle = 'rgba(78, 205, 196, 0.3)';
            c.lineWidth = 1.5;
            c.setLineDash([8, 4]);
            c.lineDashOffset = -time * 20;

            c.beginPath();
            c.arc(x, y, rangePixels, 0, Math.PI * 2);
            c.stroke();

            // Inner gradient fill
            const gradient = c.createRadialGradient(x, y, 0, x, y, rangePixels);
            gradient.addColorStop(0, 'rgba(78, 205, 196, 0.02)');
            gradient.addColorStop(0.8, 'rgba(78, 205, 196, 0.01)');
            gradient.addColorStop(1, 'rgba(78, 205, 196, 0)');

            c.fillStyle = gradient;
            c.beginPath();
            c.arc(x, y, rangePixels, 0, Math.PI * 2);
            c.fill();

            c.restore();
        });

        // Draw overlapping connections
        const vehicles = Object.entries(vehicleStates);
        for (let i = 0; i < vehicles.length; i++) {
            for (let j = i + 1; j < vehicles.length; j++) {
                const [id1, v1] = vehicles[i];
                const [id2, v2] = vehicles[j];

                const dx = v1.sx - v2.sx;
                const dy = v1.sy - v2.sy;
                const dist = Math.sqrt(dx * dx + dy * dy);

                // If within communication range
                if (dist <= this.commRange * 2) {
                    const x1 = transform.x(v1.sx);
                    const y1 = transform.y(v1.sy);
                    const x2 = transform.x(v2.sx);
                    const y2 = transform.y(v2.sy);

                    // Connection strength based on distance
                    const strength = Math.max(0, 1 - dist / (this.commRange * 2));

                    c.strokeStyle = `rgba(78, 205, 196, ${strength * 0.5})`;
                    c.lineWidth = 1 + strength;
                    c.setLineDash([]);

                    c.beginPath();
                    c.moveTo(x1, y1);
                    c.lineTo(x2, y2);
                    c.stroke();
                }
            }
        }

        c.setLineDash([]);
    }

    /**
     * Draw decision zone highlights on the ground
     */
    drawDecisionZone(transform, scale, jx1, jx2, jy1, jy2) {
        const c = this.ctx;

        // Decision zone radius (30m from junction)
        const zoneRadius = 30;
        const cx = (jx1 + jx2) / 2;
        const cy = (jy1 + jy2) / 2;

        // Draw subtle highlight around junction based on consensus phase
        const phase = (this.sumoStateRef.consensus && this.sumoStateRef.consensus.phase) ? this.sumoStateRef.consensus.phase.toLowerCase() : 'idle';
        if (phase === 'prepare' || phase === 'commit') {
            const glowColor = phase === 'commit' ? 'rgba(78, 205, 196' : 'rgba(240, 136, 62'; // Teal for commit, orange for prepare
            const gradient = c.createRadialGradient(
                transform.x(cx), transform.y(cy), 0,
                transform.x(cx), transform.y(cy), zoneRadius * scale
            );
            gradient.addColorStop(0, `${glowColor}, 0.2)`);
            gradient.addColorStop(0.7, `${glowColor}, 0.05)`);
            gradient.addColorStop(1, `${glowColor}, 0)`);

            c.fillStyle = gradient;
            c.beginPath();
            c.arc(transform.x(cx), transform.y(cy), zoneRadius * scale, 0, Math.PI * 2);
            c.fill();

            // Animated ring
            const time = Date.now() * 0.001;
            const ringRadius = (zoneRadius - 5 + Math.sin(time * 2) * 3) * scale;
            c.strokeStyle = `${glowColor}, 0.4)`;
            c.lineWidth = 2;
            c.setLineDash([10, 5]);
            c.beginPath();
            c.arc(transform.x(cx), transform.y(cy), ringRadius, 0, Math.PI * 2);
            c.stroke();
            c.setLineDash([]);
        }
    }

    /**
     * Draw network topology links between vehicles
     */
    drawTopologyLinks(transform) {
        const c = this.ctx;
        const vehicleStates = this.vehicleStatesRef;
        const links = (this.sumoStateRef.consensus && this.sumoStateRef.consensus.links) ? this.sumoStateRef.consensus.links : [];

        links.forEach(link => {
            const fromState = vehicleStates[link.from];
            const toState = vehicleStates[link.to];

            if (fromState && toState) {
                const fromX = transform.x(fromState.sx);
                const fromY = transform.y(fromState.sy);
                const toX = transform.x(toState.sx);
                const toY = transform.y(toState.sy);

                const letScore = link.let_score || 0;

                if (letScore > 80) {
                    // Stable link
                    c.strokeStyle = `rgba(46, 160, 67, 0.8)`; // Green
                    c.lineWidth = 3;
                    c.setLineDash([]);
                } else if (letScore < 40) {
                    // Unstable link
                    c.strokeStyle = `rgba(240, 136, 62, 0.6)`; // Orange
                    c.lineWidth = 1;
                    c.setLineDash([4, 4]);
                } else {
                    // Medium stability
                    c.strokeStyle = `rgba(78, 205, 196, 0.6)`; // Teal
                    c.lineWidth = 2;
                    c.setLineDash([8, 4]);
                }

                c.beginPath();
                c.moveTo(fromX, fromY);
                c.lineTo(toX, toY);
                c.stroke();

                c.setLineDash([]);
            }
        });
    }

    /**
     * Draw consensus state rings around vehicles
     */
    drawVehicleStateRings(transform, scale) {
        const c = this.ctx;
        const vehicleStates = this.vehicleStatesRef;

        Object.entries(this.vehicleConsensusStates).forEach(([vehicleId, consensusState]) => {
            const vState = vehicleStates[vehicleId];
            if (!vState) return;

            const x = transform.x(vState.sx);
            const y = transform.y(vState.sy);
            const colors = this.stateColors[consensusState.state] || this.stateColors.idle;

            // Pulsing ring radius
            const baseRadius = 12 + scale * 0.8;
            const pulseAmount = Math.sin(consensusState.pulsePhase) * 3;
            const radius = baseRadius + pulseAmount;

            // Outer glow
            const glowGradient = c.createRadialGradient(x, y, radius, x, y, radius + 8);
            glowGradient.addColorStop(0, colors.glow);
            glowGradient.addColorStop(1, 'rgba(0,0,0,0)');
            c.fillStyle = glowGradient;
            c.beginPath();
            c.arc(x, y, radius + 8, 0, Math.PI * 2);
            c.fill();

            // State ring
            c.strokeStyle = colors.fill;
            c.lineWidth = 3;
            c.beginPath();
            c.arc(x, y, radius, 0, Math.PI * 2);
            c.stroke();

            // State indicator dots (for multi-phase states)
            if (consensusState.state === 'preparing' || consensusState.state === 'committing') {
                const dotCount = 3;
                for (let i = 0; i < dotCount; i++) {
                    const angle = (Date.now() * 0.003 + i * (Math.PI * 2 / dotCount)) % (Math.PI * 2);
                    const dotX = x + Math.cos(angle) * radius;
                    const dotY = y + Math.sin(angle) * radius;

                    c.fillStyle = '#ffffff';
                    c.beginPath();
                    c.arc(dotX, dotY, 3, 0, Math.PI * 2);
                    c.fill();
                }
            }
        });
    }

    /**
     * Draw message particles
     */
    drawMessageParticles(transform) {
        const c = this.ctx;
        const vehicleStates = this.vehicleStatesRef;

        this.messageParticles.forEach(particle => {
            const fromState = vehicleStates[particle.from];
            const toState = vehicleStates[particle.to];

            if (!fromState || !toState) return;

            const fromX = transform.x(fromState.sx);
            const fromY = transform.y(fromState.sy);
            const toX = transform.x(toState.sx);
            const toY = transform.y(toState.sy);

            // Eased progress for smooth animation
            const eased = this.easeInOutCubic(particle.progress);
            const x = fromX + (toX - fromX) * eased;
            const y = fromY + (toY - fromY) * eased;

            // Draw trail
            const trailLength = 6;
            c.strokeStyle = particle.color;
            c.lineWidth = 2;
            c.lineCap = 'round';

            const trailProgress = Math.max(0, particle.progress - 0.1);
            const trailEased = this.easeInOutCubic(trailProgress);
            const trailX = fromX + (toX - fromX) * trailEased;
            const trailY = fromY + (toY - fromY) * trailEased;

            const gradient = c.createLinearGradient(trailX, trailY, x, y);
            gradient.addColorStop(0, 'rgba(255,255,255,0)');
            gradient.addColorStop(1, particle.color);
            c.strokeStyle = gradient;

            c.beginPath();
            c.moveTo(trailX, trailY);
            c.lineTo(x, y);
            c.stroke();

            // Draw particle head
            c.shadowColor = particle.color;
            c.shadowBlur = 10;
            c.fillStyle = '#ffffff';
            c.beginPath();
            c.arc(x, y, 4, 0, Math.PI * 2);
            c.fill();
            c.shadowBlur = 0;

            // Draw message type label
            c.font = '10px Inter, sans-serif';
            c.fillStyle = particle.color;
            c.fillText(particle.msgType, x + 8, y - 5);
        });
    }

    /**
     * Draw consensus progress bar (overlay)
     */
    drawConsensusProgressBar(canvasWidth) {
        const c = this.ctx;
        const progress = this.consensusProgress;

        if (progress.phase === 'idle') return;

        const barWidth = 200;
        const barHeight = 20;
        const x = canvasWidth - barWidth - 20;
        const y = 150;  // Positioned well below the SIMULATION HUD panel

        // Background
        c.fillStyle = 'rgba(22, 27, 34, 0.9)';
        c.strokeStyle = 'rgba(78, 205, 196, 0.3)';
        c.lineWidth = 1;
        c.beginPath();
        c.roundRect(x - 10, y - 25, barWidth + 20, barHeight + 40, 8);
        c.fill();
        c.stroke();

        // Phase label
        const phaseLabels = {
            prepare: '⏳ PREPARE Phase',
            pre_prepare: '📋 PRE-PREPARE',
            commit: '✅ COMMIT Phase',
            reply: '📨 REPLY Phase'
        };
        c.font = 'bold 11px Inter, sans-serif';
        c.fillStyle = '#e6edf3';
        c.fillText(phaseLabels[progress.phase] || progress.phase.toUpperCase(), x, y - 8);

        // Progress bar background
        c.fillStyle = '#21262d';
        c.beginPath();
        c.roundRect(x, y, barWidth, barHeight, 4);
        c.fill();

        // Progress bar fill
        const fillWidth = (progress.current / progress.required) * barWidth;
        const phaseColors = {
            prepare: '#f0883e',
            pre_prepare: '#d29922',
            commit: '#4ecdc4',
            reply: '#2ea043'
        };

        const fillGradient = c.createLinearGradient(x, y, x + fillWidth, y);
        const baseColor = phaseColors[progress.phase] || '#4ecdc4';
        fillGradient.addColorStop(0, baseColor);
        fillGradient.addColorStop(1, this.lightenColor(baseColor, 20));

        c.fillStyle = fillGradient;
        c.beginPath();
        c.roundRect(x, y, fillWidth, barHeight, 4);
        c.fill();

        // Progress text
        c.font = 'bold 12px JetBrains Mono, monospace';
        c.fillStyle = '#ffffff';
        c.textAlign = 'center';
        c.fillText(`${progress.current}/${progress.required}`, x + barWidth / 2, y + 14);
        c.textAlign = 'left';
    }

    /**
     * Get event log for external display
     */
    getEventLog() {
        return this.eventLog;
    }

    /**
     * Clear all visual effects
     */
    clear() {
        this.messageParticles = [];
        this.vehicleConsensusStates = {};
        this.consensusProgress = { phase: 'idle', current: 0, required: 4, timestamp: 0 };
        this.decisionZoneVehicles.clear();
        this.topologyLinks = [];
        this.eventLog = [];
    }

    /**
     * Clear all visualization state and reset analytics
     */
    clear() {
        this.messageParticles = [];
        this.vehicleConsensusStates = {};
        this.consensusProgress = { phase: 'idle', current: 0, required: 4, timestamp: 0 };
        this.decisionZoneVehicles = new Set();
        this.topologyLinks = [];
        this.eventLog = [];

        // Reset analytics
        this.analytics = {
            messagesByType: {
                PREPARE: 0,
                PRE_PREPARE: 0,
                COMMIT: 0,
                REPLY: 0,
                REQUEST: 0,
                HEARTBEAT: 0,
                OTHER: 0
            },
            stateDistribution: {
                idle: 0,
                preparing: 0,
                committing: 0,
                committed: 0,
                failed: 0
            },
            activityHistory: [],
            roundsCompleted: 0,
            totalLatency: 0,
            successfulRounds: 0,
            lastSecondMessages: 0,
            lastSecondTimestamp: Date.now()
        };
    }

    // Utility functions
    easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    lightenColor(hex, percent) {
        const num = parseInt(hex.replace('#', ''), 16);
        const amt = Math.round(2.55 * percent);
        const R = Math.min(255, (num >> 16) + amt);
        const G = Math.min(255, ((num >> 8) & 0x00FF) + amt);
        const B = Math.min(255, (num & 0x0000FF) + amt);
        return `rgb(${R}, ${G}, ${B})`;
    }
}

/**
 * Demo event generator for testing visualizations without backend
 */
export class DemoEventGenerator {
    constructor(visualizer) {
        this.visualizer = visualizer;
        this.running = false;
        this.interval = null;
    }

    start() {
        if (this.running) return;
        this.running = true;

        // Generate demo events periodically
        this.interval = setInterval(() => {
            this.generateDemoEvent();
        }, 2000);
    }

    stop() {
        this.running = false;
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    generateDemoEvent() {
        const vehicles = Object.keys(this.visualizer.vehicleStatesRef);
        if (vehicles.length < 2) return;

        const eventTypes = ['message', 'state_change', 'consensus_progress'];
        const type = eventTypes[Math.floor(Math.random() * eventTypes.length)];

        const events = [];

        if (type === 'message') {
            const from = vehicles[Math.floor(Math.random() * vehicles.length)];
            const to = vehicles.filter(v => v !== from)[Math.floor(Math.random() * (vehicles.length - 1))];
            const msgTypes = ['PREPARE', 'COMMIT', 'REPLY', 'REQUEST'];

            events.push({
                type: 'message',
                from: from,
                to: to || 'broadcast',
                msgType: msgTypes[Math.floor(Math.random() * msgTypes.length)]
            });
        } else if (type === 'state_change') {
            const vehicle = vehicles[Math.floor(Math.random() * vehicles.length)];
            const states = ['preparing', 'prepared', 'committing', 'committed'];

            events.push({
                type: 'state_change',
                vehicle: vehicle,
                state: states[Math.floor(Math.random() * states.length)]
            });
        } else if (type === 'consensus_progress') {
            const phases = ['prepare', 'commit', 'reply'];
            const phase = phases[Math.floor(Math.random() * phases.length)];
            const required = Math.floor(Math.random() * 3) + 3;

            events.push({
                type: 'consensus_progress',
                phase: phase,
                current: Math.floor(Math.random() * (required + 1)),
                required: required
            });
        }

        this.visualizer.processEvents(events);
    }
}
