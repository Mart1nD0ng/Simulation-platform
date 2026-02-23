// topologyLayouts.js

// 布局全连接拓扑
export function layoutFullTopology(xy, n, r, w, th) {
    for (var i = 0; i < n; i++) {
        var theta = Math.PI - (2 * Math.PI / n) * i;
        xy.push({
            x: w / 2 + r * Math.sin(theta),
            y: w / 2 - (th / 2) + r * Math.cos(theta)
        });
    }
}

// 布局星型拓扑
export function layoutStarTopology(xy, n, r, w, th) {
    xy.push({ x: w / 2, y: w / 2 }); // 中心节点
    for (var i = 1; i < n; i++) {
        var theta = Math.PI - (2 * Math.PI / (n - 1)) * (i - 1);
        xy.push({
            x: w / 2 + r * Math.sin(theta),
            y: w / 2 - (th / 2) + r * Math.cos(theta)
        });
    }
}

// 布局树型拓扑
export function layoutTreeTopology(xy, n, nValue, w, iw) {
    function calculateTreePositions(level, index, x, y, offsetX, offsetY) {
        if (index >= n) return;
        if (!xy[index]) {
            xy[index] = { x: x, y: y };
        }

        var childrenCount = Math.min(nValue, n - (index * nValue) - 1);
        var angleStep = Math.PI / 4;
        var startAngle = Math.PI / 2;

        for (var i = 0; i < childrenCount; i++) {
            var angle = startAngle + (i - (childrenCount - 1) / 2) * angleStep;
            var childX = x + offsetX * Math.cos(angle);
            var childY = y + offsetY * Math.sin(angle);
            calculateTreePositions(level + 1, index * nValue + i + 1, childX, childY, offsetX / 1.5, offsetY);
        }
    }

    var initialOffsetX = w / 4;
    var initialOffsetY = iw * 4;
    calculateTreePositions(0, 0, w / 2, iw, initialOffsetX, initialOffsetY);
}

// 布局环形拓扑
export function layoutRingTopology(xy, n, r, w, th) {
    for (var i = 0; i < n; i++) {
        var theta = Math.PI - (2 * Math.PI / n) * i;
        xy.push({
            x: w / 2 + r * Math.sin(theta),
            y: w / 2 - (th / 2) + r * Math.cos(theta)
        });
    }
}
