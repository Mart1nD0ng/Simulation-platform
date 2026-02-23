# MyVeinsApp - V2X交叉口管理应用

## 概述

`MyVeinsApp` 是一个基于 Veins 框架的 V2X 应用模块，实现了**固定的、基于状态机的车辆交叉口通行策略**。该应用模块设计为模块化结构，方便后续替换为 MARL（多智能体强化学习）策略。

## 核心功能

### 1. 有限状态机（FSM）

应用实现了四个主要状态：

- **APPROACHING（接近中）**: 车辆正在接近交叉口
- **WAITING（等待中）**: 车辆在停止线前等待
- **PASSING（通过中）**: 车辆正在穿越交叉口
- **EXITED（已离开）**: 车辆已通过冲突区域

### 2. 动作空间

车辆可以执行四种高层动作：

- **KEEP_SPEED**: 保持当前速度
- **SLOW_DOWN**: 减速
- **STOP**: 停车
- **ACCELERATE**: 加速

### 3. 观察（Observation）结构

决策基于以下观察信息：

```cpp
struct Observation {
    double distToStopLine;       // 到停止线的距离 [m]
    double speed;                // 当前速度 [m/s]
    bool hasPriorVehicle;        // 是否有优先级更高的车辆
    bool safeToGo;               // 安全标志（无碰撞风险）
    bool greenLight;             // 交通信号灯状态
};
```

## 文件结构

- **MyVeinsApp.h**: 头文件，定义类结构、状态枚举、观察结构等
- **MyVeinsApp.cc**: 实现文件，包含完整的状态机逻辑
- **MyVeinsApp.ned**: NED网络描述文件，定义模块参数
- **omnetpp_myveinsapp_example.ini**: 示例配置文件

## 关键方法

### 决策循环

```cpp
void performDecisionStep() {
    // 1. 收集观察
    Observation obs = collectObservation();
    
    // 2. 决定动作（基于FSM）
    VehicleAction action = decideAction(obs);
    
    // 3. 应用动作
    applyActionToVehicle(action);
}
```

### 状态转换逻辑

`decideAction()` 方法实现了状态机逻辑：

```cpp
VehicleAction decideAction(const Observation& obs) {
    switch (state) {
        case APPROACHING:
            // 如果不安全或有优先车辆 -> WAITING
            // 如果接近且安全 -> PASSING
            
        case WAITING:
            // 如果条件满足 -> PASSING
            // 否则继续等待
            
        case PASSING:
            // 如果已通过 -> EXITED
            
        case EXITED:
            // 正常行驶
    }
}
```

### 动作执行

通过 TraCI 接口控制车辆：

```cpp
void applyActionToVehicle(VehicleAction action) {
    double targetSpeed = calculateTargetSpeed(action);
    traciVehicle->setSpeed(targetSpeed);
}
```

## 配置参数

### 在 omnetpp.ini 中配置

```ini
# 应用类型
*.node[*].applType = "MyVeinsApp"

# 决策间隔（状态机运行频率）
*.node[*].appl.decisionInterval = 0.2s

# 交叉口配置（根据您的 SUMO 网络调整）
*.node[*].appl.intersectionCenterX = 500m
*.node[*].appl.intersectionCenterY = 500m
*.node[*].appl.intersectionRadius = 15m
*.node[*].appl.stopLineOffset = 20m

# 动作参数
*.node[*].appl.slowDownDelta = 2.0mps
*.node[*].appl.accelerateDelta = 2.0mps
*.node[*].appl.maxSpeed = 13.89mps  # ~50 km/h

# 通信参数
*.node[*].appl.sendBeacons = true
*.node[*].appl.beaconInterval = 1s
*.node[*].appl.neighborTimeout = 2.0s
```

## 使用步骤

### 1. 编译

在 Veins 项目根目录下：

```bash
cd src
make
```

### 2. 配置场景

编辑 `omnetpp.ini`：

```ini
[General]
network = RSUExampleScenario

*.node[*].applType = "MyVeinsApp"
# ... 其他配置参数
```

### 3. 调整交叉口坐标

**重要**：必须根据您的 SUMO 网络调整交叉口中心坐标！

方法：
1. 在 SUMO-GUI 中打开您的网络文件
2. 点击交叉口查看坐标
3. 更新 `intersectionCenterX` 和 `intersectionCenterY`

### 4. 运行仿真

```bash
./run -u Cmdenv -c ConfigName
```

或使用 OMNeT++ IDE 运行。

## 通信机制

### 接收消息

- **onBSM()**: 接收来自邻近车辆的基本安全消息（信标）
  - 更新邻居车辆列表
  - 用于优先级判断和安全检查

- **onWSM()**: 接收数据消息
  - 预留接口，用于未来的协调协议

### 发送消息

继承自 `DemoBaseApplLayer`，自动发送信标消息：
- 周期性广播包含位置、速度等信息的 BSM
- 可用于 V2V 和 V2I 通信

## 邻居跟踪

应用维护一个邻居车辆列表：

```cpp
struct NeighborInfo {
    LAddress::L2Type address;
    Coord position;
    Coord speed;
    simtime_t lastUpdate;
};
```

- 通过接收到的 BSM 更新
- 自动清理过期信息（超过 `neighborTimeout`）
- 用于优先级判断和碰撞检测

## 统计收集

应用记录以下统计信息：

- `stateTransitions`: 状态转换次数
- `totalWaitingTime`: 总等待时间
- `vehicleState`: 状态向量（可绘制状态变化图）

在结果分析工具中查看：

```bash
opp_scavetool export -o results.csv results/*.vec results/*.sca
```

## 扩展到 MARL

### 当前结构的模块化设计

应用的设计便于将来替换为 MARL 策略：

1. **观察收集**: `collectObservation()` 返回结构化的观察
   - 这可以直接转换为神经网络输入

2. **动作决策**: `decideAction(obs)` 返回动作
   - 替换点：用神经网络策略替换 FSM 逻辑
   - 输入：`Observation` 结构
   - 输出：`VehicleAction` 枚举

3. **动作执行**: `applyActionToVehicle(action)` 应用动作
   - 不需要修改，保持不变

### 集成 MARL 的步骤

1. **扩展观察空间**（如需要）：
   - 添加更多特征到 `Observation` 结构
   - 例如：邻居车辆的详细信息、历史轨迹等

2. **替换 `decideAction()` 方法**：
   ```cpp
   VehicleAction MyVeinsApp::decideAction(const Observation& obs) {
       // 原来的 FSM 逻辑
       // ↓ 替换为 ↓
       // 将 obs 转换为神经网络输入张量
       // 调用 MARL 策略（例如通过 PyTorch C++ API）
       // 返回网络输出的动作
   }
   ```

3. **添加策略网络接口**：
   - 集成 PyTorch C++ 库或 TensorFlow Lite
   - 加载预训练的策略模型
   - 在 `initialize()` 中加载模型权重

4. **可选：添加训练接口**：
   - 如果需要在线学习，添加经验收集
   - 实现奖励函数计算
   - 与 Python 训练脚本通信（例如通过 socket）

## 调试和日志

### 启用详细日志

在运行时添加参数：

```bash
./run -u Cmdenv -c ConfigName --debug-on-errors=true --**.appl.debug=true
```

### 关键日志消息

- `EV_INFO`: 重要事件（状态转换、决策结果）
- `EV_DEBUG`: 详细调试信息（邻居更新、距离计算）
- `EV_WARN`: 警告（TraCI 调用失败等）

### 可视化

在 OMNeT++ GUI 中：
- 查看车辆状态变化（颜色/标签）
- 查看通信消息（动画）
- 分析统计向量图表

## 常见问题

### Q: 车辆不减速/停车

A: 检查以下几点：
- `decisionInterval` 是否太大？
- `stopLineOffset` 是否正确设置？
- 交叉口中心坐标是否与 SUMO 网络匹配？
- TraCI 连接是否正常？

### Q: 车辆碰撞

A: 调整安全参数：
- 增大 `intersectionRadius`
- 增大 `stopLineOffset`
- 减小 `decisionInterval`（更频繁决策）
- 改进 `checkSafetyConditions()` 逻辑

### Q: 性能问题（仿真太慢）

A: 优化配置：
- 增大 `decisionInterval`（例如 0.3s 或 0.5s）
- 减少 `beaconInterval`（例如 2s）
- 在配置中禁用不必要的统计记录

### Q: 如何添加 RSU（路侧单元）？

A: 
- RSU 可以使用 `TraCIDemoRSU11p` 或创建自定义 RSU 应用
- 配置示例：
  ```ini
  *.rsu[*].applType = "TraCIDemoRSU11p"
  *.rsu[*].appl.sendBeacons = true
  ```


**下一步**: 将固定策略替换为 MARL 策略，实现智能交叉口协调！

