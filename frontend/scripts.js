import { connectToSumo, subscribeSumo } from './sumoClient.js';
import { ConsensusVisualizer, DemoEventGenerator } from './consensusVisualizer.js';

(function () {
    var sumoState = { step: 0, vehicles: [], tls: [], events: [] };
    var sumoDisconnect = null;
    var sumoUnsubscribe = null;
    var speedHistory = [];
    var selectedVehicle = null;
    var vehicleStates = {};
    var frameCount = 0;
    var lastFpsTime = Date.now();
    var currentFps = 0;
    var throughputHistory = [];
    var totalVehiclesPassed = 0;
    var lastVehicleIds = new Set();
    var lastFrameTime = Date.now();
    var totalMessageCount = 0;

    var mainCanvas = document.getElementById("bft_screen");
    var mainCtx = mainCanvas.getContext("2d");
    var chartCanvas = document.getElementById("sumo_chart");
    var chartCtx = chartCanvas.getContext("2d");

    // Consensus Visualizer
    var consensusVisualizer = null;
    var demoGenerator = null;
    var demoModeEnabled = false;

    // Pre-generated textures
    var asphaltPattern = null;
    var grassPattern = null;

    // SUMO Network - exact coordinates from crossroad.net.xml
    const NET = {
        cx: 500, cy: 500,
        jx1: 486.40, jx2: 513.60,
        jy1: 486.40, jy2: 513.60,
        laneW: 3.2,
        lanes: 3,
        roadHalf: 9.6
    };

    // View
    var view = { x: 500, y: 500, span: 120 };
    var drag = { on: false, x: 0, y: 0 };

    // ============ TEXTURE GENERATION ============
    function createAsphaltPattern() {
        var canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        var ctx = canvas.getContext('2d');

        // Base dark gray
        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(0, 0, 64, 64);

        // Add noise for texture
        for (var i = 0; i < 400; i++) {
            var x = Math.random() * 64;
            var y = Math.random() * 64;
            var brightness = 25 + Math.random() * 30;
            ctx.fillStyle = `rgba(${brightness}, ${brightness}, ${brightness}, 0.5)`;
            ctx.fillRect(x, y, 1 + Math.random(), 1 + Math.random());
        }

        // Add some lighter specks
        for (var i = 0; i < 50; i++) {
            var x = Math.random() * 64;
            var y = Math.random() * 64;
            ctx.fillStyle = 'rgba(80, 80, 80, 0.3)';
            ctx.beginPath();
            ctx.arc(x, y, Math.random() * 2, 0, Math.PI * 2);
            ctx.fill();
        }

        return mainCtx.createPattern(canvas, 'repeat');
    }

    function createGrassPattern() {
        var canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        var ctx = canvas.getContext('2d');

        // Base green gradient
        var grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 24);
        grad.addColorStop(0, '#2d5a27');
        grad.addColorStop(1, '#1e4a1a');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 32, 32);

        // Add grass texture noise
        for (var i = 0; i < 100; i++) {
            var x = Math.random() * 32;
            var y = Math.random() * 32;
            var g = 60 + Math.random() * 40;
            ctx.fillStyle = `rgba(30, ${g}, 20, 0.4)`;
            ctx.fillRect(x, y, 1, 2 + Math.random() * 2);
        }

        return mainCtx.createPattern(canvas, 'repeat');
    }

    function initPatterns() {
        asphaltPattern = createAsphaltPattern();
        grassPattern = createGrassPattern();
    }

    function resize() {
        var dpr = window.devicePixelRatio || 1;

        // Get the animation container's size
        var container = document.getElementById('animation_container');
        var containerRect = container.getBoundingClientRect();

        // Calculate the maximum square size that fits in the container
        // Account for padding (16px on each side = 32px total)
        var padding = 32;
        var availableWidth = containerRect.width - padding;
        var availableHeight = containerRect.height - padding;
        var squareSize = Math.min(availableWidth, availableHeight);

        // Ensure minimum size
        squareSize = Math.max(squareSize, 300);

        // Set the canvas display size (CSS pixels)
        mainCanvas.style.width = squareSize + 'px';
        mainCanvas.style.height = squareSize + 'px';

        // Set the canvas internal resolution (actual pixels for sharp rendering)
        mainCanvas.width = squareSize * dpr;
        mainCanvas.height = squareSize * dpr;

        // Handle chart canvas separately
        var chartRect = chartCanvas.getBoundingClientRect();
        chartCanvas.width = chartRect.width * dpr;
        chartCanvas.height = chartRect.height * dpr;

        // Recreate patterns after resize
        initPatterns();
    }

    // Initial resize with a small delay to ensure layout is ready
    setTimeout(resize, 50);
    window.addEventListener("resize", resize);

    // World to screen
    function tx(w, h) {
        var s = Math.min(w, h) / view.span;
        return {
            s: s,
            x: function (wx) { return w / 2 + (wx - view.x) * s; },
            y: function (wy) { return h / 2 - (wy - view.y) * s; }
        };
    }

    function draw() {
        var r = mainCanvas.getBoundingClientRect();
        var w = r.width, h = r.height;
        var c = mainCtx;
        var dpr = window.devicePixelRatio || 1;

        c.setTransform(dpr, 0, 0, dpr, 0, 0);

        var t = tx(w, h);
        var s = t.s;
        var cx = NET.cx, cy = NET.cy;
        var rh = NET.roadHalf;
        var lw = NET.laneW;
        var jx1 = NET.jx1, jx2 = NET.jx2;
        var jy1 = NET.jy1, jy2 = NET.jy2;

        // ============ BACKGROUND - Grass texture ============
        if (grassPattern) {
            c.fillStyle = grassPattern;
        } else {
            c.fillStyle = '#1e4a1a';
        }
        c.fillRect(0, 0, w, h);

        // ============ CURB (路肩) - Slightly raised border ============
        var curbWidth = 0.8;
        c.fillStyle = '#555555';

        // Horizontal road curbs
        c.fillRect(0, t.y(cy + rh + curbWidth), w, curbWidth * 2 * s);
        c.fillRect(0, t.y(cy - rh), w, curbWidth * 2 * s);

        // Vertical road curbs
        c.fillRect(t.x(cx - rh - curbWidth), 0, curbWidth * 2 * s, h);
        c.fillRect(t.x(cx + rh), 0, curbWidth * 2 * s, h);

        // ============ ROADS - Asphalt texture ============
        if (asphaltPattern) {
            c.fillStyle = asphaltPattern;
        } else {
            c.fillStyle = '#2a2a2a';
        }

        // Horizontal road
        c.fillRect(0, t.y(cy + rh), w, rh * 2 * s);
        // Vertical road
        c.fillRect(t.x(cx - rh), 0, rh * 2 * s, h);

        // ============ SIDEWALKS (人行道) - Simplified ============
        // Sidewalks removed for cleaner look
        // Zebra crossings removed as per user request

        // ============ CENTER LINE (中心实线) ============
        c.strokeStyle = '#ffcc00';
        c.lineWidth = Math.max(2, s * 0.15);
        c.setLineDash([]);

        // Horizontal center line (excluding junction)
        c.beginPath();
        c.moveTo(0, t.y(cy));
        c.lineTo(t.x(jx1), t.y(cy));
        c.moveTo(t.x(jx2), t.y(cy));
        c.lineTo(w, t.y(cy));
        c.stroke();

        // Vertical center line
        c.beginPath();
        c.moveTo(t.x(cx), 0);
        c.lineTo(t.x(cx), t.y(jy2));
        c.moveTo(t.x(cx), t.y(jy1));
        c.lineTo(t.x(cx), h);
        c.stroke();

        // ============ LANE MARKINGS - White dashed ============
        c.strokeStyle = '#ffffff';
        c.lineWidth = Math.max(1, s * 0.08);
        c.setLineDash([s * 0.8, s * 0.5]);

        // Horizontal lane dividers (excluding junction)
        [lw, lw * 2].forEach(function (off) {
            c.beginPath();
            c.moveTo(0, t.y(cy + off));
            c.lineTo(t.x(jx1 - 2), t.y(cy + off));
            c.moveTo(t.x(jx2 + 2), t.y(cy + off));
            c.lineTo(w, t.y(cy + off));
            c.stroke();

            c.beginPath();
            c.moveTo(0, t.y(cy - off));
            c.lineTo(t.x(jx1 - 2), t.y(cy - off));
            c.moveTo(t.x(jx2 + 2), t.y(cy - off));
            c.lineTo(w, t.y(cy - off));
            c.stroke();
        });

        // Vertical lane dividers
        [lw, lw * 2].forEach(function (off) {
            c.beginPath();
            c.moveTo(t.x(cx + off), 0);
            c.lineTo(t.x(cx + off), t.y(jy2 + 2));
            c.moveTo(t.x(cx + off), t.y(jy1 - 2));
            c.lineTo(t.x(cx + off), h);
            c.stroke();

            c.beginPath();
            c.moveTo(t.x(cx - off), 0);
            c.lineTo(t.x(cx - off), t.y(jy2 + 2));
            c.moveTo(t.x(cx - off), t.y(jy1 - 2));
            c.lineTo(t.x(cx - off), h);
            c.stroke();
        });
        c.setLineDash([]);

        // ============ STOP LINES ============
        c.strokeStyle = '#ffffff';
        c.lineWidth = Math.max(3, s * 0.25);
        c.lineCap = 'butt';

        // North approach
        c.beginPath();
        c.moveTo(t.x(cx - rh), t.y(jy2 + 0.3));
        c.lineTo(t.x(cx), t.y(jy2 + 0.3));
        c.stroke();

        // South approach
        c.beginPath();
        c.moveTo(t.x(cx), t.y(jy1 - 0.3));
        c.lineTo(t.x(cx + rh), t.y(jy1 - 0.3));
        c.stroke();

        // East approach
        c.beginPath();
        c.moveTo(t.x(jx2 + 0.3), t.y(cy));
        c.lineTo(t.x(jx2 + 0.3), t.y(cy + rh));
        c.stroke();

        // West approach
        c.beginPath();
        c.moveTo(t.x(jx1 - 0.3), t.y(cy - rh));
        c.lineTo(t.x(jx1 - 0.3), t.y(cy));
        c.stroke();

        // ============ DIRECTION ARROWS ============
        drawDirectionArrows(c, t, s, cx, cy, jx1, jx2, jy1, jy2, rh, lw);

        // Traffic light poles at corners removed - using per-lane lights only

        // ============ CONSENSUS VISUALIZATION - BACKGROUND LAYER ============
        if (consensusVisualizer) {
            // Communication range circles (drawn first, behind everything)
            consensusVisualizer.drawCommunicationRanges(t, s);
            // Decision zone highlighting (drawn before vehicles)
            consensusVisualizer.drawDecisionZone(t, s, jx1, jx2, jy1, jy2);
            // Network topology links
            consensusVisualizer.drawTopologyLinks(t);
        }

        // ============ TRAFFIC LIGHTS ============
        drawTrafficLights(c, t, s, cx, cy, jx1, jx2, jy1, jy2, rh, lw);

        // ============ VEHICLES ============
        drawVehicles(c, t, s);

        // ============ CONSENSUS VISUALIZATION - FOREGROUND LAYER ============
        if (consensusVisualizer) {
            // State rings around vehicles
            consensusVisualizer.drawVehicleStateRings(t, s);
            // Message particles (on top of everything)
            consensusVisualizer.drawMessageParticles(t);
            // Consensus progress bar
            consensusVisualizer.drawConsensusProgressBar(w);
        }

        // ============ HUD ============
        drawHUD(c, w, h);

        // ============ SELECTED INFO ============
        if (selectedVehicle) drawSelectedInfo(c, t, w, h);

        // FPS counter
        frameCount++;
        var now = Date.now();
        if (now - lastFpsTime >= 1000) {
            currentFps = frameCount;
            frameCount = 0;
            lastFpsTime = now;
        }
    }

    function drawZebraCrossings(c, t, s, cx, cy, jx1, jx2, jy1, jy2, rh) {
        c.fillStyle = '#ffffff';
        var stripeWidth = 0.6;
        var stripeGap = 0.4;
        var crossingWidth = rh;

        // North crossing
        for (var i = 0; i < 8; i++) {
            var xPos = cx - rh + i * (stripeWidth + stripeGap) * 1.2;
            c.fillRect(t.x(xPos), t.y(jy2 + 2), stripeWidth * s, 2 * s);
        }

        // South crossing
        for (var i = 0; i < 8; i++) {
            var xPos = cx + i * (stripeWidth + stripeGap) * 1.2;
            c.fillRect(t.x(xPos), t.y(jy1 - 0.5), stripeWidth * s, 2 * s);
        }

        // East crossing
        for (var i = 0; i < 8; i++) {
            var yPos = cy + i * (stripeWidth + stripeGap) * 1.2;
            c.fillRect(t.x(jx2 + 0.5), t.y(yPos + stripeWidth), 2 * s, stripeWidth * s);
        }

        // West crossing
        for (var i = 0; i < 8; i++) {
            var yPos = cy - rh + i * (stripeWidth + stripeGap) * 1.2;
            c.fillRect(t.x(jx1 - 2), t.y(yPos + stripeWidth), 2 * s, stripeWidth * s);
        }
    }

    function drawDirectionArrows(c, t, s, cx, cy, jx1, jx2, jy1, jy2, rh, lw) {
        c.fillStyle = 'rgba(255,255,255,0.85)';
        c.shadowColor = 'rgba(0,0,0,0.3)';
        c.shadowBlur = 2;

        function arrow(wx, wy, dir, type) {
            var x = t.x(wx), y = t.y(wy);
            var sz = Math.max(7, s * 0.65); // Larger, clearer arrows
            c.save();
            c.translate(x, y);

            // Coordinate mapping:
            // Canvas standard: +X Right, +Y Down
            // N (-PI/2): +X Up, +Y Left (Forward=Up)
            // S (PI/2): +X Down, +Y Right (Forward=Down)
            // E (0): +X Right, +Y Down (Forward=Right)
            // W (PI): +X Left, +Y Up (Forward=Left)
            // Note: In local coords (Forward = +X):
            // - Left Turn is -Y direction
            // - Right Turn is +Y direction
            var ang = {
                N: -Math.PI / 2,
                S: Math.PI / 2,
                E: 0,
                W: Math.PI
            }[dir] || 0;
            c.rotate(ang);

            c.beginPath();

            var len = sz;
            var wid = sz * 0.35;
            var stemW = sz * 0.14;
            var headLen = sz * 0.45;

            if (type === 'straight') {
                c.moveTo(-len * 0.5, -stemW);
                c.lineTo(len * 0.1, -stemW);
                c.lineTo(len * 0.1, -wid);
                c.lineTo(len * 0.6, 0);
                c.lineTo(len * 0.1, wid);
                c.lineTo(len * 0.1, stemW);
                c.lineTo(-len * 0.5, stemW);
                c.closePath();
            } else if (type === 'left') {
                // Curve Left (Local -Y)
                c.moveTo(-len * 0.5, stemW);
                c.lineTo(-len * 0.2, stemW);
                // Inner curve
                c.quadraticCurveTo(len * 0.15, stemW, len * 0.15, -len * 0.15);
                c.lineTo(len * 0.15, -len * 0.25);
                // Arrow Head
                c.lineTo(len * 0.45, -len * 0.25);
                c.lineTo(0, -len * 0.7);
                c.lineTo(-len * 0.45, -len * 0.25);
                c.lineTo(-len * 0.15, -len * 0.25);
                c.lineTo(-len * 0.15, -len * 0.15);
                // Outer curve
                c.quadraticCurveTo(-len * 0.15, -stemW, -len * 0.2, -stemW);
                c.lineTo(-len * 0.5, -stemW);
                c.closePath();
            } else if (type === 'right') {
                // Curve Right (Local +Y)
                c.moveTo(-len * 0.5, -stemW);
                c.lineTo(-len * 0.2, -stemW);
                // Inner curve
                c.quadraticCurveTo(len * 0.15, -stemW, len * 0.15, len * 0.15);
                c.lineTo(len * 0.15, len * 0.25);
                // Arrow Head
                c.lineTo(len * 0.45, len * 0.25);
                c.lineTo(0, len * 0.7);
                c.lineTo(-len * 0.45, len * 0.25);
                c.lineTo(-len * 0.15, len * 0.25);
                c.lineTo(-len * 0.15, len * 0.15);
                // Outer curve
                c.quadraticCurveTo(-len * 0.15, stemW, -len * 0.2, stemW);
                c.lineTo(-len * 0.5, stemW);
                c.closePath();
            }

            c.fill();
            c.restore();
        }

        // Draw correct arrows for each lane
        // N Approach (Heading South): West side (x < cx). Inner=Left(2), Outer=Right(0)
        arrow(cx - rh + lw * 0.5, jy2 + 8, 'S', 'right');
        arrow(cx - rh + lw * 1.5, jy2 + 8, 'S', 'straight');
        arrow(cx - rh + lw * 2.5, jy2 + 8, 'S', 'left');

        // S Approach (Heading North): East side (x > cx). Inner=Left(0), Outer=Right(2)
        arrow(cx + lw * 0.5, jy1 - 8, 'N', 'left');
        arrow(cx + lw * 1.5, jy1 - 8, 'N', 'straight');
        arrow(cx + lw * 2.5, jy1 - 8, 'N', 'right');

        // E Approach (Heading West): North side (y > cy). Inner=Left(0), Outer=Right(2)
        arrow(jx2 + 8, cy + lw * 0.5, 'W', 'left');
        arrow(jx2 + 8, cy + lw * 1.5, 'W', 'straight');
        arrow(jx2 + 8, cy + lw * 2.5, 'W', 'right');

        // W Approach (Heading East): South side (y < cy). Inner=Left(2), Outer=Right(0)
        arrow(jx1 - 8, cy - rh + lw * 0.5, 'E', 'right');
        arrow(jx1 - 8, cy - rh + lw * 1.5, 'E', 'straight');
        arrow(jx1 - 8, cy - rh + lw * 2.5, 'E', 'left');
    }

    function drawTrafficLightPoles(c, t, s, jx1, jx2, jy1, jy2) {
        var poleHeight = 8;
        var poleWidth = 0.4;
        var armLength = 4;

        // Pole color with gradient effect
        var positions = [
            { x: jx1 - 3, y: jy2 + 3, armDir: 'right' },  // NW corner
            { x: jx2 + 3, y: jy2 + 3, armDir: 'left' },   // NE corner
            { x: jx1 - 3, y: jy1 - 3, armDir: 'right' },  // SW corner
            { x: jx2 + 3, y: jy1 - 3, armDir: 'left' }    // SE corner
        ];

        positions.forEach(function (pos) {
            var px = t.x(pos.x);
            var py = t.y(pos.y);

            // Pole base (darker)
            c.fillStyle = '#333333';
            c.fillRect(px - poleWidth * s / 2, py - poleHeight * s, poleWidth * s, poleHeight * s);

            // Pole highlight (3D effect)
            c.fillStyle = '#555555';
            c.fillRect(px - poleWidth * s / 4, py - poleHeight * s, poleWidth * s / 4, poleHeight * s);

            // Arm
            var armX = pos.armDir === 'right' ? px : px - armLength * s;
            c.fillStyle = '#333333';
            c.fillRect(armX, py - poleHeight * s, armLength * s, poleWidth * s);

            // Signal box
            var boxX = pos.armDir === 'right' ? px + armLength * s * 0.7 : px - armLength * s * 0.9;
            var boxW = 1.5 * s;
            var boxH = 4 * s;

            c.fillStyle = '#1a1a1a';
            c.fillRect(boxX - boxW / 2, py - poleHeight * s - boxH / 2, boxW, boxH);
            c.strokeStyle = '#444444';
            c.lineWidth = 1;
            c.strokeRect(boxX - boxW / 2, py - poleHeight * s - boxH / 2, boxW, boxH);
        });
    }

    function drawTrafficLights(c, t, s, cx, cy, jx1, jx2, jy1, jy2, rh, lw) {
        var tls = sumoState.tls && sumoState.tls[0];
        var sigs = (tls && tls.signals) || [];

        // Build per-lane states: { orientation: { laneIndex: state } }
        var laneStates = { N: {}, S: {}, E: {}, W: {} };
        // Default to red for all
        ['N', 'S', 'E', 'W'].forEach(function (dir) {
            for (var i = 0; i < 3; i++) laneStates[dir][i] = 'r';
        });

        // Parse signals to get per-lane state
        sigs.forEach(function (sig) {
            var st = sig.state.toLowerCase();
            var orient = sig.orientation;
            var lane = sig.lane;
            if (orient && laneStates[orient] && lane !== undefined) {
                if (st === 'g' || st === 'G') laneStates[orient][lane] = 'g';
                else if ((st === 'y' || st === 'Y') && laneStates[orient][lane] !== 'g') laneStates[orient][lane] = 'y';
                else if (laneStates[orient][lane] !== 'g' && laneStates[orient][lane] !== 'y') laneStates[orient][lane] = 'r';
            }
        });

        // Fallback: if no per-lane data, use approach-level
        var approachStates = { N: 'r', S: 'r', E: 'r', W: 'r' };
        sigs.forEach(function (sig) {
            var st = sig.state.toLowerCase();
            if (st === 'g') approachStates[sig.orientation] = 'g';
            else if (st === 'y' && approachStates[sig.orientation] !== 'g') approachStates[sig.orientation] = 'y';
        });

        function getLaneState(dir, lane) {
            if (laneStates[dir] && laneStates[dir][lane] !== undefined) {
                return laneStates[dir][lane];
            }
            return approachStates[dir] || 'r';
        }

        function light(wx, wy, state, size) {
            var x = t.x(wx), y = t.y(wy);
            var r = Math.max(3, (size || 0.3) * s);

            var col = { r: '#ff3333', y: '#ffdd00', g: '#33ff55' }[state] || '#ff3333';
            var glowCol = { r: 'rgba(255,51,51,0.5)', y: 'rgba(255,221,0,0.5)', g: 'rgba(51,255,85,0.5)' }[state];

            // Smaller, cleaner glow
            var gradient = c.createRadialGradient(x, y, 0, x, y, r * 2);
            gradient.addColorStop(0, glowCol);
            gradient.addColorStop(1, 'rgba(0,0,0,0)');
            c.fillStyle = gradient;
            c.beginPath();
            c.arc(x, y, r * 2, 0, Math.PI * 2);
            c.fill();

            // Light body - solid circle
            c.shadowColor = col;
            c.shadowBlur = 10;
            c.fillStyle = col;
            c.beginPath();
            c.arc(x, y, r, 0, Math.PI * 2);
            c.fill();
            c.shadowBlur = 0;

            // Small highlight
            c.fillStyle = 'rgba(255,255,255,0.35)';
            c.beginPath();
            c.arc(x - r * 0.25, y - r * 0.25, r * 0.25, 0, Math.PI * 2);
            c.fill();
        }

        // Draw lights at each lane's stop line position
        // N approach (incoming from north, lanes on left side of road)
        for (var i = 0; i < 3; i++) {
            light(cx - rh + lw * (i + 0.5), jy2 + 1.5, getLaneState('N', i), 0.35);
        }
        // S approach
        for (var i = 0; i < 3; i++) {
            light(cx + lw * (i + 0.5), jy1 - 1.5, getLaneState('S', i), 0.35);
        }
        // E approach
        for (var i = 0; i < 3; i++) {
            light(jx2 + 1.5, cy + lw * (i + 0.5), getLaneState('E', i), 0.35);
        }
        // W approach
        for (var i = 0; i < 3; i++) {
            light(jx1 - 1.5, cy - rh + lw * (i + 0.5), getLaneState('W', i), 0.35);
        }
    }

    function drawVehicles(c, t, s) {
        if (!sumoState.vehicles) return;
        var now = Date.now();

        sumoState.vehicles.forEach(function (v) {
            var st = vehicleStates[v.id];
            if (!st) {
                // Initialize with SUMO angle if available
                // SUMO angle: 0=North, clockwise in degrees
                // Canvas angle: 0=East, counterclockwise in radians
                var initialAngle = 0;
                if (v.angle !== undefined) {
                    // Convert SUMO angle to Canvas angle
                    // SUMO: 0=N, 90=E, 180=S, 270=W (clockwise)
                    // Canvas: 0=E, PI/2=S, PI=W, -PI/2=N (counterclockwise from East)
                    initialAngle = (90 - v.angle) * Math.PI / 180;
                }
                st = vehicleStates[v.id] = {
                    x: v.x, y: v.y,
                    sx: v.x, sy: v.y, sa: initialAngle,
                    speedHistory: [v.speed, v.speed, v.speed], // Keep last 3 speeds
                    angleHistory: [0, 0, 0], // Keep last 3 angle changes
                    braking: false,
                    turnSignal: 0,
                    turnBlinkOn: false,
                    lastBlinkTime: now,
                    lastUpdateTime: now
                };
            }

            // Time-based smooth interpolation (more consistent at varying frame rates)
            var dt = Math.min((now - st.lastUpdateTime) / 16.67, 3); // Normalize to 60fps, cap at 3x
            var interpFactor = 1 - Math.pow(0.1, dt); // Exponential smoothing
            st.sx += (v.x - st.sx) * interpFactor;
            st.sy += (v.y - st.sy) * interpFactor;
            st.lastUpdateTime = now;

            // Calculate target angle - prefer SUMO angle if available
            var targetAngle;
            var angleChange = 0;

            if (v.angle !== undefined) {
                // Use SUMO's angle directly (converted to Canvas coordinates)
                targetAngle = (90 - v.angle) * Math.PI / 180;
            } else {
                // Fallback: calculate from position change
                var dx = v.x - st.x;
                var dy = v.y - st.y;
                if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
                    targetAngle = Math.atan2(dy, dx);
                } else {
                    targetAngle = st.sa; // Keep current angle if not moving
                }
            }

            // Calculate angle difference and normalize to [-PI, PI]
            var angleDiff = targetAngle - st.sa;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

            angleChange = angleDiff;
            // Smooth angle transition (faster response for better visual)
            st.sa += angleDiff * Math.min(interpFactor * 0.8, 0.3);

            // Update angle history for turn detection
            st.angleHistory.push(angleChange);
            if (st.angleHistory.length > 3) st.angleHistory.shift();

            // Update speed history for brake detection
            st.speedHistory.push(v.speed);
            if (st.speedHistory.length > 3) st.speedHistory.shift();

            // Detect braking: compare current speed to average of previous speeds
            var avgPrevSpeed = (st.speedHistory[0] + st.speedHistory[1]) / 2;
            var speedDrop = avgPrevSpeed - v.speed;
            // Increased sensitivity for brake light visualization
            st.braking = speedDrop > 0.2 && v.speed < avgPrevSpeed;

            // Detect turns: check cumulative angle change
            var totalAngleChange = st.angleHistory.reduce((a, b) => a + b, 0);
            if (Math.abs(totalAngleChange) > 0.1) {
                st.turnSignal = totalAngleChange > 0 ? 1 : -1; // 1 = left, -1 = right
            } else if (Math.abs(totalAngleChange) < 0.05) {
                st.turnSignal = 0;
            }

            // Blink logic for turn signals
            if (now - st.lastBlinkTime > 350) {
                st.turnBlinkOn = !st.turnBlinkOn;
                st.lastBlinkTime = now;
            }

            st.x = v.x;
            st.y = v.y;

            // Determine vehicle type based on ID hash
            var hash = v.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
            var vType = hash % 10 < 7 ? 'car' : (hash % 10 < 9 ? 'truck' : 'bus');

            var len, wid, bodyColor;
            if (vType === 'car') {
                len = Math.max(10, 4.5 * s);
                wid = Math.max(5, 2 * s);
                var carColors = ['#3498db', '#e74c3c', '#2ecc71', '#f39c12'];
                bodyColor = carColors[hash % carColors.length];
            } else if (vType === 'truck') {
                len = Math.max(14, 6 * s);
                wid = Math.max(6, 2.5 * s);
                bodyColor = '#95a5a6';
            } else {
                len = Math.max(18, 8 * s);
                wid = Math.max(6, 2.5 * s);
                bodyColor = '#f1c40f';
            }

            var x = t.x(st.sx), y = t.y(st.sy);

            c.save();
            c.translate(x, y);
            c.rotate(-st.sa);

            // Shadow
            c.fillStyle = 'rgba(0,0,0,0.25)';
            c.beginPath();
            c.ellipse(1.5, 1.5, len / 2 * 0.85, wid / 2 * 0.75, 0, 0, Math.PI * 2);
            c.fill();

            // Body
            c.fillStyle = bodyColor;
            drawCarBody(c, len, wid, vType);

            // Windows
            c.fillStyle = '#1a252f';
            if (vType === 'car') {
                c.beginPath();
                c.roundRect(len * 0.1, -wid / 2 + 1.5, len * 0.25, wid - 3, 2);
                c.fill();
                c.beginPath();
                c.roundRect(-len * 0.35, -wid / 2 + 2, len * 0.18, wid - 4, 1);
                c.fill();
            } else if (vType === 'bus') {
                for (var wi = 0; wi < 4; wi++) {
                    c.fillRect(-len * 0.35 + wi * len * 0.18, -wid / 2 + 1, len * 0.12, wid - 2);
                }
            }

            // Headlights (bright when moving)
            c.fillStyle = v.speed > 0.5 ? '#ffffdd' : '#666666';
            c.beginPath();
            c.arc(len / 2 - 1.5, -wid / 3, 1.8, 0, Math.PI * 2);
            c.fill();
            c.beginPath();
            c.arc(len / 2 - 1.5, wid / 3, 1.8, 0, Math.PI * 2);
            c.fill();

            // ========== BRAKE LIGHTS ==========
            if (st.braking) {
                // Bright red brake lights with strong glow
                c.fillStyle = '#ff2222';
                c.shadowColor = '#ff0000';
                c.shadowBlur = 12;
            } else {
                // Dim tail lights
                c.fillStyle = '#880000';
                c.shadowBlur = 0;
            }
            c.beginPath();
            c.arc(-len / 2 + 2, -wid / 3, 2, 0, Math.PI * 2);
            c.fill();
            c.beginPath();
            c.arc(-len / 2 + 2, wid / 3, 2, 0, Math.PI * 2);
            c.fill();
            c.shadowBlur = 0;

            // ========== TURN SIGNALS ==========
            if (st.turnSignal !== 0 && st.turnBlinkOn) {
                c.fillStyle = '#ffaa00';
                c.shadowColor = '#ff8800';
                c.shadowBlur = 8;

                if (st.turnSignal > 0) {
                    // Left turn - lights on left side (negative y in car coords due to rotation)
                    c.beginPath();
                    c.arc(len / 2 - 2, -wid / 2 + 0.5, 1.5, 0, Math.PI * 2);
                    c.fill();
                    c.beginPath();
                    c.arc(-len / 2 + 2, -wid / 2 + 0.5, 1.5, 0, Math.PI * 2);
                    c.fill();
                } else {
                    // Right turn
                    c.beginPath();
                    c.arc(len / 2 - 2, wid / 2 - 0.5, 1.5, 0, Math.PI * 2);
                    c.fill();
                    c.beginPath();
                    c.arc(-len / 2 + 2, wid / 2 - 0.5, 1.5, 0, Math.PI * 2);
                    c.fill();
                }
                c.shadowBlur = 0;
            }

            c.restore();

            // Selection ring
            if (selectedVehicle === v.id) {
                c.strokeStyle = '#00ffff';
                c.lineWidth = 2;
                c.setLineDash([4, 4]);
                c.beginPath();
                c.arc(x, y, Math.max(len, wid) * 0.8, 0, Math.PI * 2);
                c.stroke();
                c.setLineDash([]);
            }
        });

        // Cleanup old
        var ids = new Set(sumoState.vehicles.map(v => v.id));
        Object.keys(vehicleStates).forEach(id => { if (!ids.has(id)) delete vehicleStates[id]; });
    }

    function drawCarBody(c, len, wid, type) {
        if (type === 'car') {
            c.beginPath();
            c.moveTo(-len / 2 + 2, -wid / 2);
            c.lineTo(len / 2 - 3, -wid / 2);
            c.quadraticCurveTo(len / 2, -wid / 2, len / 2, -wid / 4);
            c.lineTo(len / 2, wid / 4);
            c.quadraticCurveTo(len / 2, wid / 2, len / 2 - 3, wid / 2);
            c.lineTo(-len / 2 + 2, wid / 2);
            c.quadraticCurveTo(-len / 2, wid / 2, -len / 2, wid / 4);
            c.lineTo(-len / 2, -wid / 4);
            c.quadraticCurveTo(-len / 2, -wid / 2, -len / 2 + 2, -wid / 2);
            c.closePath();
            c.fill();

            // Outline
            c.strokeStyle = 'rgba(0,0,0,0.5)';
            c.lineWidth = 1;
            c.stroke();
        } else {
            // Truck/Bus - more rectangular
            c.beginPath();
            c.roundRect(-len / 2, -wid / 2, len, wid, 3);
            c.fill();
            c.strokeStyle = 'rgba(0,0,0,0.5)';
            c.lineWidth = 1;
            c.stroke();
        }
    }

    function drawSelectedInfo(c, t, w, h) {
        var v = sumoState.vehicles && sumoState.vehicles.find(x => x.id === selectedVehicle);
        if (!v) { selectedVehicle = null; return; }

        var st = vehicleStates[v.id];
        var x = t.x(st ? st.sx : v.x);
        var y = t.y(st ? st.sy : v.y);

        var bw = 160, bh = 80;
        var bx = Math.max(5, Math.min(w - bw - 5, x - bw / 2));
        var by = Math.max(5, y - bh - 30);

        // Glassmorphism background
        c.fillStyle = 'rgba(13, 17, 23, 0.92)';
        c.beginPath();
        c.roundRect(bx, by, bw, bh, 8);
        c.fill();

        c.strokeStyle = '#4ecdc4';
        c.lineWidth = 2;
        c.stroke();

        // Pointer triangle
        c.fillStyle = 'rgba(13, 17, 23, 0.92)';
        c.beginPath();
        c.moveTo(x - 8, by + bh);
        c.lineTo(x, by + bh + 10);
        c.lineTo(x + 8, by + bh);
        c.closePath();
        c.fill();

        // Vehicle ID
        c.fillStyle = '#4ecdc4';
        c.font = 'bold 12px Inter, sans-serif';
        c.textAlign = 'left';
        c.fillText('🚗 ' + v.id, bx + 10, by + 18);

        // Stats
        c.fillStyle = '#e6edf3';
        c.font = '11px Inter, sans-serif';
        c.fillText('Speed: ' + Number(v.speed).toFixed(2) + ' m/s', bx + 10, by + 36);
        c.fillText('Position: (' + v.x.toFixed(1) + ', ' + v.y.toFixed(1) + ')', bx + 10, by + 52);

        var st = vehicleStates[v.id];
        var status = st && st.braking ? '🔴 Braking' : (v.speed > 5 ? '🟢 Moving' : '🟡 Slow');
        c.fillText('Status: ' + status, bx + 10, by + 68);
    }

    function drawHUD(c, w, h) {
        // Main stats panel (top right)
        var pw = 180, ph = 110;
        var px = w - pw - 12, py = 12;

        // Glassmorphism
        c.fillStyle = 'rgba(13, 17, 23, 0.88)';
        c.beginPath();
        c.roundRect(px, py, pw, ph, 10);
        c.fill();
        c.strokeStyle = 'rgba(78, 205, 196, 0.3)';
        c.lineWidth = 1;
        c.stroke();

        // Title
        c.fillStyle = '#4ecdc4';
        c.font = 'bold 12px Inter, sans-serif';
        c.textAlign = 'left';
        c.fillText('📊 SIMULATION', px + 12, py + 20);

        // Stats
        c.fillStyle = '#e6edf3';
        c.font = '11px Inter, sans-serif';
        var vc = sumoState.vehicles ? sumoState.vehicles.length : 0;
        c.fillText('Step: ' + sumoState.step, px + 12, py + 40);
        c.fillText('Vehicles: ' + vc, px + 100, py + 40);

        var avg = 0;
        if (vc) avg = sumoState.vehicles.reduce((a, v) => a + Number(v.speed || 0), 0) / vc;
        c.fillText('Avg Speed: ' + avg.toFixed(1) + ' m/s', px + 12, py + 58);
        c.fillText('Zoom: ' + view.span.toFixed(0) + 'm', px + 12, py + 76);

        // FPS
        c.fillStyle = currentFps >= 50 ? '#2ea043' : (currentFps >= 30 ? '#f0883e' : '#f85149');
        c.fillText('FPS: ' + currentFps, px + 100, py + 76);

        // Throughput (simplified calculation)
        var currentIds = new Set(sumoState.vehicles ? sumoState.vehicles.map(v => v.id) : []);
        var exited = [...lastVehicleIds].filter(id => !currentIds.has(id)).length;
        if (exited > 0) totalVehiclesPassed += exited;
        lastVehicleIds = currentIds;

        c.fillStyle = '#8b949e';
        c.fillText('Throughput: ' + totalVehiclesPassed + ' veh', px + 12, py + 94);
    }

    // Animation
    function loop() {
        var now = Date.now();
        var deltaTime = now - lastFrameTime;
        lastFrameTime = now;

        // Update consensus visualizer
        if (consensusVisualizer) {
            consensusVisualizer.update(deltaTime);
        }

        draw();
        drawChart();
        updateEventLogUI();
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

    // Events - same as before
    mainCanvas.addEventListener('wheel', function (e) {
        e.preventDefault();
        view.span *= e.deltaY > 0 ? 1.12 : 0.89;
        view.span = Math.max(40, Math.min(400, view.span));
    });

    mainCanvas.addEventListener('mousedown', function (e) {
        drag.on = true;
        drag.x = e.clientX;
        drag.y = e.clientY;
        mainCanvas.style.cursor = 'grabbing';
    });

    mainCanvas.addEventListener('mousemove', function (e) {
        if (!drag.on) return;
        var r = mainCanvas.getBoundingClientRect();
        var t = tx(r.width, r.height);
        view.x -= (e.clientX - drag.x) / t.s;
        view.y += (e.clientY - drag.y) / t.s;
        drag.x = e.clientX;
        drag.y = e.clientY;
    });

    mainCanvas.addEventListener('mouseup', function () {
        drag.on = false;
        mainCanvas.style.cursor = 'grab';
    });

    mainCanvas.addEventListener('mouseleave', function () { drag.on = false; });

    mainCanvas.addEventListener('click', function (e) {
        var r = mainCanvas.getBoundingClientRect();
        var mx = e.clientX - r.left, my = e.clientY - r.top;
        var t = tx(r.width, r.height);

        selectedVehicle = null;
        if (sumoState.vehicles) {
            for (var v of sumoState.vehicles) {
                var st = vehicleStates[v.id];
                var vx = t.x(st ? st.sx : v.x);
                var vy = t.y(st ? st.sy : v.y);
                if (Math.hypot(mx - vx, my - vy) < 25) {
                    selectedVehicle = v.id;
                    break;
                }
            }
        }
    });

    mainCanvas.addEventListener('dblclick', function () {
        view.x = 500; view.y = 500; view.span = 120;
    });

    mainCanvas.style.cursor = 'grab';

    // Chart - enhanced gradient
    function drawChart() {
        var c = chartCtx;
        var r = chartCanvas.getBoundingClientRect();
        var w = r.width, h = r.height;
        var dpr = window.devicePixelRatio || 1;

        c.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Gradient background
        var bgGrad = c.createLinearGradient(0, 0, 0, h);
        bgGrad.addColorStop(0, '#0d1117');
        bgGrad.addColorStop(1, '#161b22');
        c.fillStyle = bgGrad;
        c.fillRect(0, 0, w, h);

        if (speedHistory.length < 2) {
            c.fillStyle = '#8b949e';
            c.font = '12px Inter, sans-serif';
            c.fillText("⏳ Waiting for data...", 15, 25);
            return;
        }

        var min = Math.min(...speedHistory) - 0.5;
        var max = Math.max(...speedHistory) + 0.5;
        var pL = 35, pR = 10, pT = 20, pB = 15;

        function gx(i) { return pL + i / (speedHistory.length - 1) * (w - pL - pR); }
        function gy(v) { return h - pB - (v - min) / (max - min) * (h - pT - pB); }

        // Grid
        c.strokeStyle = 'rgba(139, 148, 158, 0.1)';
        c.lineWidth = 1;
        for (var i = 0; i <= 4; i++) {
            var gy2 = pT + (h - pT - pB) * i / 4;
            c.beginPath();
            c.moveTo(pL, gy2);
            c.lineTo(w - pR, gy2);
            c.stroke();
        }

        // Fill under curve
        var gradient = c.createLinearGradient(0, pT, 0, h - pB);
        gradient.addColorStop(0, 'rgba(78, 205, 196, 0.3)');
        gradient.addColorStop(1, 'rgba(78, 205, 196, 0)');
        c.fillStyle = gradient;
        c.beginPath();
        c.moveTo(gx(0), h - pB);
        speedHistory.forEach((v, i) => c.lineTo(gx(i), gy(v)));
        c.lineTo(gx(speedHistory.length - 1), h - pB);
        c.closePath();
        c.fill();

        // Line
        c.strokeStyle = '#4ecdc4';
        c.lineWidth = 2;
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.beginPath();
        speedHistory.forEach((v, i) => i === 0 ? c.moveTo(gx(i), gy(v)) : c.lineTo(gx(i), gy(v)));
        c.stroke();

        // Labels
        c.fillStyle = '#8b949e';
        c.font = '10px Inter, sans-serif';
        c.textAlign = 'left';
        c.fillText('📈 Avg Speed (m/s)', 5, 14);

        c.textAlign = 'right';
        c.fillText(max.toFixed(1), pL - 5, pT + 5);
        c.fillText(min.toFixed(1), pL - 5, h - pB);
    }

    // SUMO connection - with consensus event support
    function update(state) {
        $("#sumo_status").text("Step " + state.step + ", vehicles: " + state.vehicles.length);
        $("#sumo_last_update").text("Updated " + new Date().toLocaleTimeString());
        $("#sumo_preview").text(JSON.stringify({ step: state.step, sample: state.vehicles.slice(0, 2) }, null, 2));

        var avg = 0;
        if (state.vehicles.length) avg = state.vehicles.reduce((a, v) => a + Number(v.speed || 0), 0) / state.vehicles.length;
        speedHistory.push(avg);
        if (speedHistory.length > 200) speedHistory.shift();

        // Process consensus events if present
        if (state.events && consensusVisualizer) {
            consensusVisualizer.processEvents(state.events);
            totalMessageCount += state.events.filter(e => e.type === 'message').length;
        }

        // Update stats display
        updateStatsDisplay();
    }

    function updateStatsDisplay() {
        var nodeCount = sumoState.vehicles ? sumoState.vehicles.length : 0;
        $("#active_nodes").text(nodeCount);
        $("#message_count").text(totalMessageCount);

        if (consensusVisualizer) {
            var progress = consensusVisualizer.consensusProgress;
            if (progress.phase !== 'idle') {
                $("#consensus_status").text(progress.current + '/' + progress.required);
            } else {
                $("#consensus_status").text('--');
            }
        }
    }

    function updateEventLogUI() {
        if (!consensusVisualizer) return;

        var log = consensusVisualizer.getEventLog();
        var logEl = document.getElementById('event_log');
        if (!logEl) return;

        // Only update if there are new events
        if (log.length === 0) {
            if (!logEl.querySelector('.log-placeholder')) {
                logEl.innerHTML = '<div class="log-placeholder">Waiting for consensus events...</div>';
            }
            return;
        }

        // Remove placeholder if present
        var placeholder = logEl.querySelector('.log-placeholder');
        if (placeholder) {
            logEl.innerHTML = '';
        }

        // Check if we need to add new entries
        var existingIds = new Set([...logEl.querySelectorAll('.log-entry')].map(el => el.dataset.id));
        var newEntries = log.filter(e => !existingIds.has(e.id));

        // Add new entries at the top
        newEntries.forEach(entry => {
            var entryEl = document.createElement('div');
            entryEl.className = 'log-entry';
            entryEl.dataset.id = entry.id;

            var time = new Date(entry.timestamp).toLocaleTimeString();
            var typeClass = entry.type === 'message' ? 'message' : 'state';
            var content = '';

            if (entry.type === 'message') {
                content = `<strong>${entry.from}</strong> → <strong>${entry.to}</strong>: ${entry.msgType || 'MSG'}`;
            } else if (entry.type === 'state_change') {
                content = `<strong>${entry.vehicle}</strong> → ${entry.state.toUpperCase()}`;
            }

            entryEl.innerHTML = `
                <span class="log-time">${time}</span>
                <span class="log-type ${typeClass}">${entry.type === 'message' ? 'MSG' : 'STATE'}</span>
                <span class="log-content">${content}</span>
            `;

            logEl.insertBefore(entryEl, logEl.firstChild);
        });

        // Keep only the most recent entries in DOM
        var entries = logEl.querySelectorAll('.log-entry');
        if (entries.length > 30) {
            for (var i = 30; i < entries.length; i++) {
                entries[i].remove();
            }
        }
    }

    function status(s) {
        var m = { connecting: '🔄 Connecting...', connected: '✅ Connected', disconnected: '❌ Disconnected', error: '⚠️ Error' };
        $("#sumo_status_text").text(m[s] || s);
    }

    function connect() {
        if (sumoDisconnect) sumoDisconnect();
        sumoDisconnect = connectToSumo($("#sumo_url").val(), status);
        subscribeSumo(function (state) {
            sumoState = state;
            update(state);
        });
    }

    $(document).ready(function () {
        // Initialize consensus visualizer
        consensusVisualizer = new ConsensusVisualizer(mainCanvas, mainCtx, vehicleStates, sumoState);
        demoGenerator = new DemoEventGenerator(consensusVisualizer);

        $("#sumo_connect, #sumo_start").click(connect);
        $("#toggleSidebar").click(function () {
            var sb = $("#sidebar");
            sb.width() > 100 ? sb.css("width", "50px") : sb.css("width", "280px");
        });
        $("#zoom_level").on('input', function () {
            view.span = 200 - parseFloat(this.value) * 80;
        });

        // Demo mode toggle
        $("#demo_mode").on('change', function () {
            demoModeEnabled = this.checked;
            if (demoModeEnabled) {
                demoGenerator.start();
                console.log('Demo mode enabled - generating sample consensus events');
            } else {
                demoGenerator.stop();
                consensusVisualizer.clear();
                totalMessageCount = 0;
                console.log('Demo mode disabled');
            }
        });

        // Communication range controls
        $("#show_comm_range").on('change', function () {
            if (consensusVisualizer) {
                consensusVisualizer.showCommRange = this.checked;
            }
        });

        $("#comm_range").on('input', function () {
            var value = parseFloat(this.value);
            $("#comm_range_value").text(value);
            if (consensusVisualizer) {
                consensusVisualizer.commRange = value;
            }
        });

        // Initialize analytics charts
        initAnalyticsCharts();
    });

    // ============ ANALYTICS CHARTS ============

    var messageChartCtx = null;
    var activityChartCtx = null;

    function initAnalyticsCharts() {
        var msgCanvas = document.getElementById('message_chart');
        var actCanvas = document.getElementById('activity_chart');

        if (msgCanvas) {
            messageChartCtx = msgCanvas.getContext('2d');
        }
        if (actCanvas) {
            activityChartCtx = actCanvas.getContext('2d');
        }
    }

    function drawMessageChart() {
        if (!messageChartCtx || !consensusVisualizer) return;

        var c = messageChartCtx;
        var canvas = c.canvas;
        var w = canvas.width;
        var h = canvas.height;

        // Clear
        c.fillStyle = '#0d1117';
        c.fillRect(0, 0, w, h);

        var stats = consensusVisualizer.analytics.messagesByType;
        var types = ['PREPARE', 'PRE_PREPARE', 'COMMIT', 'REPLY', 'REQUEST'];
        var colors = ['#f0883e', '#d29922', '#4ecdc4', '#2ea043', '#a371f7'];
        var total = types.reduce((sum, t) => sum + (stats[t] || 0), 0);

        if (total === 0) {
            c.fillStyle = '#6e7681';
            c.font = '11px Inter, sans-serif';
            c.textAlign = 'center';
            c.fillText('No messages yet', w / 2, h / 2);
            return;
        }

        // Draw bar chart
        var barWidth = (w - 40) / types.length - 8;
        var maxVal = Math.max(...types.map(t => stats[t] || 0));

        types.forEach((type, i) => {
            var val = stats[type] || 0;
            var barHeight = maxVal > 0 ? (val / maxVal) * (h - 30) : 0;
            var x = 20 + i * (barWidth + 8);
            var y = h - 15 - barHeight;

            // Bar
            c.fillStyle = colors[i];
            c.beginPath();
            c.roundRect(x, y, barWidth, barHeight, 2);
            c.fill();

            // Value
            c.fillStyle = '#e6edf3';
            c.font = 'bold 10px JetBrains Mono, monospace';
            c.textAlign = 'center';
            c.fillText(val.toString(), x + barWidth / 2, y - 4);

            // Label
            c.fillStyle = '#6e7681';
            c.font = '8px Inter, sans-serif';
            c.fillText(type.substring(0, 4), x + barWidth / 2, h - 3);
        });
    }

    function drawActivityChart() {
        if (!activityChartCtx || !consensusVisualizer) return;

        var c = activityChartCtx;
        var canvas = c.canvas;
        var w = canvas.width;
        var h = canvas.height;

        // Clear
        c.fillStyle = '#0d1117';
        c.fillRect(0, 0, w, h);

        var history = consensusVisualizer.analytics.activityHistory;

        if (history.length < 2) {
            c.fillStyle = '#6e7681';
            c.font = '11px Inter, sans-serif';
            c.textAlign = 'center';
            c.fillText('Collecting data...', w / 2, h / 2);
            return;
        }

        var max = Math.max(...history, 1);
        var padding = { left: 25, right: 5, top: 10, bottom: 15 };
        var graphW = w - padding.left - padding.right;
        var graphH = h - padding.top - padding.bottom;

        // Grid lines
        c.strokeStyle = '#21262d';
        c.lineWidth = 1;
        for (var i = 0; i <= 4; i++) {
            var y = padding.top + (graphH / 4) * i;
            c.beginPath();
            c.moveTo(padding.left, y);
            c.lineTo(w - padding.right, y);
            c.stroke();
        }

        // Area fill
        var gradient = c.createLinearGradient(0, padding.top, 0, h - padding.bottom);
        gradient.addColorStop(0, 'rgba(78, 205, 196, 0.3)');
        gradient.addColorStop(1, 'rgba(78, 205, 196, 0)');

        c.fillStyle = gradient;
        c.beginPath();
        c.moveTo(padding.left, h - padding.bottom);

        history.forEach((val, i) => {
            var x = padding.left + (i / (history.length - 1)) * graphW;
            var y = padding.top + (1 - val / max) * graphH;
            c.lineTo(x, y);
        });

        c.lineTo(padding.left + graphW, h - padding.bottom);
        c.closePath();
        c.fill();

        // Line
        c.strokeStyle = '#4ecdc4';
        c.lineWidth = 2;
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.beginPath();

        history.forEach((val, i) => {
            var x = padding.left + (i / (history.length - 1)) * graphW;
            var y = padding.top + (1 - val / max) * graphH;
            if (i === 0) c.moveTo(x, y);
            else c.lineTo(x, y);
        });
        c.stroke();

        // Y-axis label
        c.fillStyle = '#6e7681';
        c.font = '9px JetBrains Mono, monospace';
        c.textAlign = 'right';
        c.fillText(max.toString(), padding.left - 4, padding.top + 8);
        c.fillText('0', padding.left - 4, h - padding.bottom);
    }

    function updateStateDistributionUI() {
        if (!consensusVisualizer) return;

        var dist = consensusVisualizer.calculateStateDistribution();
        var total = dist.idle + dist.preparing + dist.committing + dist.committed + dist.failed;

        if (total === 0) total = 1; // Avoid division by zero

        // Update bars
        $('#bar_idle').css('width', (dist.idle / total * 100) + '%');
        $('#bar_preparing').css('width', (dist.preparing / total * 100) + '%');
        $('#bar_committing').css('width', (dist.committing / total * 100) + '%');
        $('#bar_committed').css('width', (dist.committed / total * 100) + '%');
        $('#bar_failed').css('width', (dist.failed / total * 100) + '%');

        // Update labels
        $('#label_idle').text('Idle: ' + dist.idle);
        $('#label_preparing').text('Prep: ' + dist.preparing);
        $('#label_committing').text('Comm: ' + dist.committing);
        $('#label_committed').text('Done: ' + dist.committed);
    }

    function updateAnalyticsMetrics() {
        if (!consensusVisualizer) return;

        var analytics = consensusVisualizer.analytics;

        // Calculate average latency (mock for now)
        var avgLatency = analytics.roundsCompleted > 0 ?
            (analytics.totalLatency / analytics.roundsCompleted).toFixed(0) + 'ms' : '--';

        // Calculate success rate
        var successRate = analytics.roundsCompleted > 0 ?
            Math.round((analytics.successfulRounds / analytics.roundsCompleted) * 100) + '%' : '--';

        // Get current msg/s
        var msgPerSec = analytics.activityHistory.length > 0 ?
            analytics.activityHistory[analytics.activityHistory.length - 1] : 0;

        $('#avg_latency').text(avgLatency);
        $('#success_rate').text(successRate);
        $('#rounds_completed').text(analytics.roundsCompleted);
        $('#msg_per_sec').text(msgPerSec);
    }

    // Update analytics UI periodically
    setInterval(function () {
        drawMessageChart();
        drawActivityChart();
        updateStateDistributionUI();
        updateAnalyticsMetrics();
    }, 500);

})();