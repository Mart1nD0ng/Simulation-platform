# 🔗 共识与通信可视化开发指南

## 目录
1. [快速开始](#快速开始)
2. [系统架构](#系统架构)
3. [可视化功能](#可视化功能)
4. [前端控件](#前端控件) 🆕
5. [API 参考](#api-参考)
6. [完整示例](#完整示例)
7. [常见问题](#常见问题)

---

## 快速开始

### 1. 继承可视化基类

```python
# my_algorithm.py
from visualization_interface import (
    VisualizableConsensus,
    VehicleState,
    MessageType,
    ConsensusPhase
)
import traci

class MyConsensusAlgorithm(VisualizableConsensus):
    def __init__(self):
        super().__init__()
        # 你的初始化代码
    
    def update(self, step: int):
        vehicles = traci.vehicle.getIDList()
        
        if len(vehicles) >= 2:
            # 发送消息 - 前端会显示粒子动画
            self.emit_message(vehicles[0], vehicles[1], MessageType.PREPARE)
            
            # 更新车辆状态 - 前端会显示光环
            self.emit_state_change(vehicles[0], VehicleState.PREPARING)
            
            # 更新进度条
            self.emit_progress(ConsensusPhase.PREPARE, 1, 4)
```

### 2. 注册到仿真器

```python
# crossroad_runner.py
from my_algorithm import MyConsensusAlgorithm

my_consensus = MyConsensusAlgorithm()

manager = SimulationManager(
    # ... 其他参数
    consensus_algo=my_consensus,
)
```

### 3. 运行并查看效果

```bash
python crossroad_runner.py
```

打开浏览器访问 `http://localhost:8000`，连接 SUMO 后即可看到可视化效果。

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         Python 后端                              │
│  ┌─────────────────┐    ┌─────────────────┐   ┌──────────────┐  │
│  │ 你的共识算法     │    │  你的网络协议   │   │  SUMO 仿真   │  │
│  │ (VisualizableC.) │    │ (VisualizableN.)│   │  (TraCI)     │  │
│  └────────┬────────┘    └────────┬────────┘   └──────┬───────┘  │
│           │                      │                    │          │
│           ▼                      ▼                    ▼          │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                  SimulationManager                          │ │
│  │  - 调用 algo.update(step)                                   │ │
│  │  - 调用 algo.get_events() 收集事件                          │ │
│  │  - 打包成 JSON 通过 WebSocket 发送                          │ │
│  └────────────────────────────────────────────────────────────┘ │
└───────────────────────────────┬─────────────────────────────────┘
                                │ WebSocket
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                         浏览器前端                               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                ConsensusVisualizer.js                       ││
│  │  - processEvents(): 解析事件                                 ││
│  │  - drawMessageParticles(): 绘制消息粒子                      ││
│  │  - drawVehicleStateRings(): 绘制状态光环                     ││
│  │  - drawConsensusProgressBar(): 绘制进度条                    ││
│  │  - drawTopologyLinks(): 绘制拓扑连接线                       ││
│  │  - drawDecisionZone(): 绘制决策区域高亮                      ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

---

## 可视化功能

### 1. 📨 消息传递动画 (Message Particles)

**效果**：彩色粒子从发送方飞向接收方，带有尾迹效果

| 消息类型 | 颜色 | 用途示例 |
|---------|------|---------|
| `PRE_PREPARE` | 🟡 黄色 | PBFT 预准备 |
| `PREPARE` | 🟠 橙色 | 准备消息 |
| `COMMIT` | 🟢 青色 | 提交消息 |
| `REPLY` | 🟢 绿色 | 回复消息 |
| `REQUEST` | 🟣 紫色 | 请求消息 |
| `HEARTBEAT` | ⚪ 灰色 | 心跳包 |

```python
# 单播
self.emit_message("veh_0", "veh_1", MessageType.PREPARE)

# 广播
self.emit_broadcast("veh_0", MessageType.COMMIT)
```

### 2. 💫 节点状态环 (State Rings)

**效果**：车辆周围的脉冲光环，颜色表示当前状态

| 状态 | 颜色 | 动画 |
|-----|------|-----|
| `IDLE` | 灰色 | 静态 |
| `PREPARING` | 橙色 | 旋转白点 |
| `PREPARED` | 橙色 | 静态 |
| `COMMITTING` | 青色 | 旋转白点 |
| `COMMITTED` | 绿色 | 静态 |
| `FAILED` | 红色 | 静态 |
| `LEADER` | 紫色 | 静态 |

```python
self.emit_state_change("veh_0", VehicleState.PREPARING)
# 稍后...
self.emit_state_change("veh_0", VehicleState.COMMITTED)
```

### 3. 📊 共识进度条 (Progress Bar)

**效果**：右上角显示当前阶段和投票进度

```python
# 显示 PREPARE 阶段，2/4 票
self.emit_progress(ConsensusPhase.PREPARE, 2, 4)

# 完成后隐藏进度条
self.hide_progress()
```

### 4. 🔗 网络拓扑图 (Topology Links)

**效果**：车辆之间的虚线连接，线条粗细表示连接强度

```python
self.emit_topology([
    {"from": "veh_0", "to": "veh_1", "strength": 1.0},   # 强连接
    {"from": "veh_0", "to": "veh_2", "strength": 0.5},   # 中等连接
    {"from": "veh_1", "to": "veh_2", "strength": 0.2}    # 弱连接
])

# 清除所有连接线
self.clear_topology()
```

### 5. 🎯 决策区域高亮 (Decision Zone)

**效果**：标记正在参与共识的车辆，路口区域显示渐变高亮

```python
# 标记车辆进入决策区域
self.emit_decision_zone(["veh_0", "veh_1", "veh_2"], active=True)

# 车辆离开决策区域
self.emit_decision_zone(["veh_0"], active=False)
```

### 6. 📋 事件日志面板 (Event Log)

**效果**：右侧面板实时显示所有事件，自动滚动

所有 `message` 和 `state_change` 事件会自动记录到日志中，无需额外调用。

### 7. 🔍 通信范围可视化 (Communication Range) 🆕

**效果**：显示每辆车的通信半径圆圈和车辆间的通信连接

**前端控制**（无需后端代码）：
1. 勾选 **🔍 Show Comm Range** 开启通信范围显示
2. 调节 **Range 滑块** 改变通信半径（20m - 150m）

**可视化元素**：
- 🔵 虚线圆圈：每辆车的通信范围边界（动态旋转动画）
- 🔗 连接线：车辆间的通信连接（线条粗细表示信号强度 = 距离反比）
- 🌈 渐变填充：通信范围内的半透明区域

**研究用途**：
- 分析网络拓扑结构
- 验证通信范围参数对共识的影响
- 可视化多跳通信场景

### 8. 📊 研究分析面板 (Research Analytics) 🆕

**位置**：右侧面板的 **📊 Research Analytics** 区域

**包含图表**：

| 图表 | 说明 | 更新频率 |
|------|------|---------|
| **Message Distribution** | 各类型消息数量的条形图 | 500ms |
| **Node State Distribution** | 节点状态分布的堆叠条形图 | 500ms |
| **Network Activity** | 每秒消息数量的时间序列曲线（最近60秒） | 1s |

**关键指标**：

| 指标 | 说明 |
|------|------|
| **Avg Latency** | 平均共识延迟（从发起到完成） |
| **Success Rate** | 共识成功率百分比 |
| **Rounds** | 已完成的共识轮次总数 |
| **Msg/s** | 当前每秒消息数 |

**研究用途**：
- 监控算法性能和吞吐量
- 分析不同阶段的消息分布
- 观察节点状态变化趋势
- 检测异常或瓶颈

---

## 前端控件

前端提供了一些无需后端代码即可使用的交互控件：

### 🎬 Demo Mode

**位置**：Consensus Network 面板

**功能**：开启后自动生成模拟的共识事件，用于测试可视化效果

**用途**：
- 在无后端的情况下测试前端显示
- 演示可视化功能
- 验证图表和动画效果

### 🔍 Show Comm Range

**位置**：Research Analytics 面板

**功能**：开启后显示每辆车的通信范围圆圈

**控件**：
| 控件 | 说明 | 范围 |
|------|------|------|
| Show Comm Range | 开关通信范围显示 | On/Off |
| Range 滑块 | 调节通信半径 | 20m - 150m |

### 🔗 Network Topology

**位置**：Controls 面板

**功能**：选择网络拓扑模式

**选项**：
| 选项 | 说明 |
|------|------|
| Full Connection | 全连接网络（所有车辆互连） |
| None | 不显示拓扑 |

---

## API 参考

### VisualizableConsensus 类

| 方法 | 参数 | 说明 |
|------|-----|------|
| `emit_message(from_id, to_id, msg_type, data?)` | 发送方ID, 接收方ID/"broadcast", 消息类型, 附加数据 | 发送消息可视化 |
| `emit_broadcast(from_id, msg_type, data?)` | 发送方ID, 消息类型, 附加数据 | 广播消息 |
| `emit_state_change(vehicle_id, state)` | 车辆ID, 新状态 | 更新车辆状态光环 |
| `emit_progress(phase, current, required)` | 阶段, 当前数, 所需数 | 更新进度条 |
| `hide_progress()` | - | 隐藏进度条 |
| `emit_decision_zone(vehicle_ids, active)` | 车辆ID列表, 是否激活 | 标记决策区域 |
| `emit_topology(links)` | 连接列表 | 更新拓扑图 |
| `clear_topology()` | - | 清除拓扑图 |

### 枚举类型

```python
from visualization_interface import VehicleState, MessageType, ConsensusPhase

# 车辆状态
VehicleState.IDLE / PREPARING / PREPARED / COMMITTING / COMMITTED / FAILED / LEADER

# 消息类型
MessageType.PRE_PREPARE / PREPARE / COMMIT / REPLY / REQUEST / HEARTBEAT

# 共识阶段
ConsensusPhase.IDLE / PRE_PREPARE / PREPARE / COMMIT / REPLY
```

---

## 完整示例

### 示例 1: 简单投票共识

```python
from visualization_interface import (
    VisualizableConsensus,
    VehicleState,
    MessageType,
    ConsensusPhase
)
import traci

class SimpleVotingConsensus(VisualizableConsensus):
    """
    简单投票共识：所有车辆投票决定是否通过路口
    """
    
    def __init__(self):
        super().__init__()
        self.voting_round = 0
        self.votes = {}
        self.phase = "idle"
    
    def update(self, step: int):
        vehicles = traci.vehicle.getIDList()
        decision_zone_vehicles = self._get_vehicles_near_junction(vehicles)
        
        # 每50步启动新的投票
        if step % 50 == 0 and len(decision_zone_vehicles) >= 2:
            self._start_voting(step, decision_zone_vehicles)
        
        # 投票阶段
        elif self.phase == "voting":
            self._process_votes(step)
        
        # 提交阶段
        elif self.phase == "committing":
            self._finish_voting()
    
    def _get_vehicles_near_junction(self, vehicles):
        """获取靠近路口的车辆"""
        result = []
        for vid in vehicles:
            x, y = traci.vehicle.getPosition(vid)
            if 470 < x < 530 and 470 < y < 530:  # 路口区域
                result.append(vid)
        return result
    
    def _start_voting(self, step, participants):
        """启动投票"""
        self.voting_round = step
        self.votes = {v: None for v in participants}
        self.phase = "voting"
        
        # 可视化
        self.emit_decision_zone(participants, active=True)
        leader = participants[0]
        self.emit_state_change(leader, VehicleState.LEADER)
        self.emit_broadcast(leader, MessageType.REQUEST)
        self.emit_progress(ConsensusPhase.PREPARE, 0, len(participants))
    
    def _process_votes(self, step):
        """处理投票"""
        elapsed = step - self.voting_round
        participants = list(self.votes.keys())
        
        # 模拟: 每5步收到一票
        if elapsed % 5 == 0 and elapsed // 5 < len(participants):
            voter = participants[elapsed // 5]
            self.votes[voter] = True
            
            # 可视化
            self.emit_message(voter, participants[0], MessageType.PREPARE)
            self.emit_state_change(voter, VehicleState.PREPARING)
            votes_received = sum(1 for v in self.votes.values() if v is not None)
            self.emit_progress(ConsensusPhase.PREPARE, votes_received, len(participants))
            
            # 收到足够票数
            if votes_received == len(participants):
                self.phase = "committing"
                for p in participants:
                    self.emit_broadcast(p, MessageType.COMMIT)
                    self.emit_state_change(p, VehicleState.COMMITTING)
    
    def _finish_voting(self):
        """完成投票"""
        participants = list(self.votes.keys())
        
        for p in participants:
            self.emit_state_change(p, VehicleState.COMMITTED)
        
        self.emit_decision_zone(participants, active=False)
        self.hide_progress()
        self.phase = "idle"
        self.votes = {}
```

### 示例 2: 使用 PBFT 示例

```python
# crossroad_runner.py
from visualization_interface import ExamplePBFTConsensus

# 使用内置的 PBFT 示例
my_consensus = ExamplePBFTConsensus()

manager = SimulationManager(
    sumo_cfg="sumo/crossroad.sumocfg",
    consensus_algo=my_consensus,
    # ...
)
```

---

## 常见问题

### Q: 为什么看不到可视化效果？

1. **检查 Demo Mode**: 先勾选右侧面板的 "🎬 Demo Mode" 测试前端是否正常
2. **检查 WebSocket 连接**: 确保状态显示 "Connected"
3. **检查车辆数量**: 至少需要 2 辆车才能显示消息动画
4. **检查 get_events()**: 确保你的类实现了 `get_events()` 方法

### Q: 事件发送太频繁会有性能问题吗？

建议每秒发送不超过 20 个事件。`broadcast` 事件会为每辆车创建一个粒子，车辆多时开销较大。

### Q: 如何自定义消息类型颜色？

在前端 `consensusVisualizer.js` 中修改 `messageColors` 对象：

```javascript
this.messageColors = {
    PREPARE: '#f0883e',    // 修改这里
    MY_CUSTOM: '#ff00ff',  // 添加自定义类型
    // ...
};
```

### Q: 如何同时使用共识算法和网络协议？

```python
my_consensus = MyConsensusAlgorithm()
my_networking = MyNetworkingProtocol()

manager = SimulationManager(
    consensus_algo=my_consensus,
    networking_proto=my_networking,
    # ...
)
```

两者的事件会被自动收集并发送到前端。

---

## 文件结构

```
Distributed_transportation_system-master/
├── visualization_interface.py   # 可视化接口基类 (新增)
├── algorithms.py                # 原有算法文件 (已更新)
├── crossroad_runner.py          # 仿真运行器 (已支持事件收集)
├── VISUALIZATION_GUIDE.md       # 本文档
└── ...

HTML/V6/
├── consensusVisualizer.js       # 前端可视化模块 (新增)
├── scripts.js                   # 主脚本 (已集成)
├── styles.css                   # 样式 (已更新)
└── index.html                   # 页面 (已更新)
```

---

## 联系方式

如有问题，请联系项目维护者。
