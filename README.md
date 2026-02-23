Simulation Platform (车联网与共识算法综合仿真平台)

## 项目简介

本项目是一个多层架构的综合仿真平台，旨在模拟并可视化智能交通环境下的车辆移动、V2X（车联网）通信以及分布式节点间的共识机制（如PBFT算法）。项目集成了主流的开源仿真工具（SUMO、OMNeT++/Veins）并包含一个自定义的Web可视化控制台，能够直观地展示正常节点与恶意节点在交叉路口等场景下的交互情况。

## 目录结构及功能说明

项目主要分为四大模块：`Strategy`（算法与控制策略）、`application`（网络应用层协议）、`crossroad`（交通场景配置）和 `frontend`（可视化前端）。

```text
Simulation-platform/
├── Strategy/               # 核心算法策略与SUMO控制脚本
│   ├── algorithms.py       # 具体的路由或调度算法实现
│   ├── crossroad_runner.py # 通过TraCI接口控制SUMO运行交叉路口场景的Python脚本
│   ├── visualize_strategy.py # 策略可视化相关逻辑
│   ├── visualization_interface.py # 算法层与可视化界面的交互接口
│   ├── VISUALIZATION_GUIDE.md     # 可视化模块的使用说明文档
│   └── crossroad.*.xml / .sumocfg # 交叉路口的SUMO网络拓扑及配置文件
│
├── application/            # OMNeT++ / Veins 车辆通信应用层代码
│   ├── ieee80211p/         # 基于IEEE 802.11p的车联网底层通信协议实现
│   │   ├── DemoBaseApplLayer.* # 基础应用层逻辑 (C++, NED)
│   └── traci/              # 负责OMNeT++与SUMO交通模拟器通信(TraCI)的模块
│       ├── MyVeinsApp.* # 自定义车辆应用层逻辑代码
│       ├── TraCIDemo11p.* # 结合11p协议的TraCI演示应用
│       └── TraCIDemoTrafficLightApp.* # 交通信号灯的控制应用
│
├── crossroad/              # 具体的交通仿真场景资源 (以Erlangen城市为例)
│   ├── erlangen.*.xml      # Erlangen路网节点、边缘、路由配置文件
│   ├── erlangen.sumo.cfg   # SUMO主配置文件
│   ├── config.xml          # 综合配置项
│   └── antenna.xml         # RSU（路侧单元）或天线基站的配置文件
│
└── frontend/               # 基于Web的仿真监控与共识算法可视化前端
    ├── index.html          # 主控制台页面
    ├── styles.css          # 样式表
    ├── scripts.js          # 前端核心业务逻辑
    ├── utils.js            # 工具函数
    ├── sumoClient.js       # 用于接收并解析来自SUMO的数据
    ├── topologyLayouts.js  # 车辆/节点网络拓扑计算与渲染布局
    ├── consensusVisualizer.js # 共识算法（如PBFT）状态机与消息传递的可视化脚本
    ├── sumo_bridge.py      # Python中间件：桥接底层的SUMO/TraCI与Web前端(通常基于WebSocket/HTTP)
    └── pbft/               # 共识算法相关静态资源
        ├── honest.png      # 诚实节点图标
        └── malice.png      # 恶意/拜占庭节点图标

```

## 核心模块解析

### 1. 交通仿真模块 (SUMO)

主要集中在 `crossroad/` 和 `Strategy/` 目录。使用完整的 SUMO (Simulation of Urban MObility) 工具链建立交叉路口路网（`.net.xml`, `.edg.xml`, `.nod.xml`）及车辆路由（`.rou.xml`）。

* **控制方式**：通过 Python 脚本（`crossroad_runner.py`）利用 TraCI (Traffic Control Interface) 接口动态获取车辆位置、速度信息，并下发控制指令。

### 2. 网络与通信仿真模块 (OMNeT++ / Veins)

位于 `application/` 目录。该模块结合 Veins 框架：

* 实现了基于 `IEEE 802.11p` 的V2V/V2I无线通信。
* 自定义了 `MyVeinsApp` 和 `TraCIDemo` 应用程序，用于定义车辆生成时的行为规则及消息广播（Message Broadcasting）机制。

### 3. 可视化与共识展示模块 (Frontend)

这是一个直观的Web管理后台，位于 `frontend/` 目录：

* **数据桥接**：`sumo_bridge.py` 负责监听后端的仿真数据流，并将其传输给前端网页。
* **共识可视化**：`consensusVisualizer.js` 和 `pbft` 目录中的资源表明系统正在模拟基于车联网的分布式共识（如识别环境中的恶意车辆）。可视化界面能够实时渲染哪些节点是“诚实节点”（Honest），哪些是“恶意节点”（Malice），并展示通信拓扑与状态流转过程。

## 运行环境与依赖 (推测)

要完整运行此项目，您可能需要安装以下环境：

1. **Python 3.x**：用于运行 `Strategy` 脚本和 `sumo_bridge.py`。
* 依赖库：`traci`, `sumolib`, 可能还有 `websockets` 或 `flask`（用于桥接前端）。


2. **SUMO (Simulation of Urban MObility)**：需配置对应的系统环境变量（如 `$SUMO_HOME`）。
3. **OMNeT++ & Veins**：用于编译 `application/` 中的 C++ 源代码（`.cc`, `.h`, `.ned`），生成网络仿真可执行文件。
4. **现代浏览器**：打开 `frontend/index.html` 查看实时可视化控制台。

## 开发与扩展

* 若要**修改车辆驾驶策略**：请修改 `Strategy/algorithms.py` 并通过 `crossroad_runner.py` 载入。
* 若要**调整共识算法逻辑（例如从PBFT改为Raft）**：需调整应用层广播逻辑（`application/`）和前端相应的状态机渲染（`frontend/consensusVisualizer.js`）。
