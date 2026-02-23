// utils.js
// 颜色常量定义
export const HONEST_COLOR = "#28a745"; // 诚实节点颜色
export const MALICE_COLOR = "#dc3545"; // 恶意节点颜色
export const REJECTED_COLOR = "#ffc107"; // 拒绝节点颜色
export const UNKNOWN_COLOR = "#888888"; // 未知节点颜色

// 基础帧率
export const baseFPS = 144.0;

// DOM 元素
export const screen = $("#bft_screen");
export const list = $("#bft_list");

// 加载图片函数
export function loadImage(uri, onLoadCallback) {
    const image = new Image();
    image.onload = onLoadCallback;
    image.src = uri;
    return image;
}

// 颜色插值函数
export function interpolateColor(color1, color2, factor) {
    const result = color1.slice(1).match(/.{2}/g)
        .map((hex, index) => {
            return Math.round(parseInt(hex, 16) * (1 - factor) + parseInt(color2.slice(1).match(/.{2}/g)[index], 16) * factor);
        })
        .map((value) => {
            return value.toString(16).padStart(2, "0");
        })
        .join("");
    return `#${result}`;
}

// 设置热力图背景颜色
export function setHeatmapBackgroundColor(value) {
    const minValue = 0;
    const maxValue = 100;
    const ratio = (value - minValue) / (maxValue - minValue);
    return interpolateColor("#ffffff", "#2980b9", ratio);
}

// 判断是否允许连接
export function isConnectionAllowed(i, j, n, topology, nValue) {
    if (topology === "full") {
        return true;
    } else if (topology === "ring") {
        return (i === (j + 1) % n) || (j === (i + 1) % n);
    } else if (topology === "star") {
        return i === 0 || j === 0;
    } else if (topology === "tree") {
        return (j === Math.floor((i - 1) / nValue)) || (i === Math.floor((j - 1) / nValue));
    }
    return false;
}

// 转换消息值为文本
export function text(value){
    switch(value){
        case null:  return "ARBITRARY";
        case 0:     return "TRUTH";
        case 1:     return "FALSEHOOD";
        default:    return "Rejected";
    }
}

// 根据消息值获取标签和颜色
export function order(value){
    var label = text(value);
    var color = null;
    switch(value){
        case null:  color = "danger"; break;
        case 0:     color = "success";  break;
        case 1:     color = "success";  break;
        default:    color = "warning"; break;
    }
    return "<span class='text-" + color + "'>" + label + "</span>";
}

// 构建准备消息
export function buildPrepareMessage(msg){
    return (msg.src+1) + (msg.dst != null? ("→" + (msg.dst+1)):"") + ":" + (msg.tampered? "😈": "😇") + order(msg.value);
}
