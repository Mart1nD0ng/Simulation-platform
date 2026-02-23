"""
可视化接口模块 (Visualization Interface Module)

本模块提供用于与前端可视化系统交互的基类和工具。
算法开发者应该继承这些基类来实现自己的算法，并使用提供的方法发送可视化事件。

使用方法:
1. 继承 VisualizableConsensus 或 VisualizableNetworking 类
2. 在 update() 方法中实现你的算法逻辑
3. 使用 emit_*() 方法发送可视化事件

示例见本文件底部的 ExamplePBFTConsensus 类。
"""

from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional, Literal
from dataclasses import dataclass
from enum import Enum
import traci


# ============================================================
# 枚举类型定义
# ============================================================

class VehicleState(Enum):
    """车辆共识状态"""
    IDLE = "idle"               # 空闲 - 灰色
    PREPARING = "preparing"     # 准备中 - 橙色+旋转动画
    PREPARED = "prepared"       # 已准备 - 橙色
    COMMITTING = "committing"   # 提交中 - 青色+旋转动画
    COMMITTED = "committed"     # 已提交 - 绿色
    FAILED = "failed"           # 失败 - 红色
    LEADER = "leader"           # 领导者 - 紫色


class MessageType(Enum):
    """消息类型 (影响可视化颜色)"""
    PRE_PREPARE = "PRE_PREPARE"   # 预准备 - 黄色
    PREPARE = "PREPARE"           # 准备 - 橙色
    COMMIT = "COMMIT"             # 提交 - 青色
    REPLY = "REPLY"               # 回复 - 绿色
    REQUEST = "REQUEST"           # 请求 - 紫色
    HEARTBEAT = "HEARTBEAT"       # 心跳 - 灰色


class ConsensusPhase(Enum):
    """共识阶段 (用于进度条显示)"""
    IDLE = "idle"
    PRE_PREPARE = "pre_prepare"
    PREPARE = "prepare"
    COMMIT = "commit"
    REPLY = "reply"


# ============================================================
# 可视化基类
# ============================================================

class VisualizableMixin:
    """
    可视化功能混入类。
    提供事件发送的基础设施。
    """
    
    def __init__(self):
        self._pending_events: List[Dict[str, Any]] = []
    
    def get_events(self) -> List[Dict[str, Any]]:
        """
        获取并清空待发送的事件队列。
        此方法由 SimulationManager 自动调用，无需手动调用。
        
        Returns:
            待发送的事件列表
        """
        events = self._pending_events.copy()
        self._pending_events.clear()
        return events
    
    def _emit(self, event: Dict[str, Any]) -> None:
        """内部方法：将事件加入队列"""
        self._pending_events.append(event)


class VisualizableConsensus(VisualizableMixin, ABC):
    """
    可视化共识算法基类。
    
    继承此类并实现 update() 方法来创建你的共识算法。
    使用 emit_* 方法发送可视化事件。
    
    示例:
        class MyConsensus(VisualizableConsensus):
            def update(self, step: int):
                vehicles = traci.vehicle.getIDList()
                if len(vehicles) >= 2:
                    # 发送消息可视化
                    self.emit_message(vehicles[0], vehicles[1], MessageType.PREPARE)
                    # 更新车辆状态
                    self.emit_state_change(vehicles[0], VehicleState.PREPARING)
    """
    
    def __init__(self):
        super().__init__()
    
    @abstractmethod
    def update(self, step: int) -> None:
        """
        每个仿真步长调用此方法。
        在这里实现你的共识算法逻辑。
        
        Args:
            step: 当前仿真步数
        """
        pass
    
    # ---- 消息可视化 ----
    
    def emit_message(
        self,
        from_id: str,
        to_id: str,
        msg_type: MessageType,
        data: Optional[Dict] = None
    ) -> None:
        """
        发送消息可视化事件。
        前端将显示一个粒子从发送方飞向接收方。
        
        Args:
            from_id: 发送方车辆ID
            to_id: 接收方车辆ID，或 "broadcast" 表示广播给所有车辆
            msg_type: 消息类型 (决定粒子颜色)
            data: 附加数据 (可选，仅用于日志)
        
        示例:
            self.emit_message("veh_0", "veh_1", MessageType.PREPARE)
            self.emit_message("veh_0", "broadcast", MessageType.COMMIT)
        """
        event = {
            "type": "message",
            "from": from_id,
            "to": to_id,
            "msgType": msg_type.value if isinstance(msg_type, MessageType) else str(msg_type)
        }
        if data:
            event["data"] = data
        self._emit(event)
    
    def emit_broadcast(
        self,
        from_id: str,
        msg_type: MessageType,
        data: Optional[Dict] = None
    ) -> None:
        """
        广播消息给所有车辆。
        这是 emit_message(from_id, "broadcast", ...) 的便捷方法。
        
        Args:
            from_id: 发送方车辆ID
            msg_type: 消息类型
            data: 附加数据 (可选)
        """
        self.emit_message(from_id, "broadcast", msg_type, data)
    
    # ---- 状态可视化 ----
    
    def emit_state_change(
        self,
        vehicle_id: str,
        state: VehicleState
    ) -> None:
        """
        发送车辆状态变更事件。
        前端将在该车辆周围显示对应颜色的光环。
        
        Args:
            vehicle_id: 车辆ID
            state: 新状态
        
        示例:
            self.emit_state_change("veh_0", VehicleState.PREPARING)
            self.emit_state_change("veh_0", VehicleState.COMMITTED)
        """
        self._emit({
            "type": "state_change",
            "vehicle": vehicle_id,
            "state": state.value if isinstance(state, VehicleState) else str(state)
        })
    
    # ---- 进度可视化 ----
    
    def emit_progress(
        self,
        phase: ConsensusPhase,
        current: int,
        required: int
    ) -> None:
        """
        发送共识进度更新事件。
        前端将显示一个进度条。
        
        Args:
            phase: 当前阶段
            current: 当前收到的投票/确认数
            required: 所需的总数
        
        示例:
            self.emit_progress(ConsensusPhase.PREPARE, 2, 4)  # 2/4 票
            self.emit_progress(ConsensusPhase.COMMIT, 4, 4)   # 完成
            self.emit_progress(ConsensusPhase.IDLE, 0, 0)     # 隐藏进度条
        """
        self._emit({
            "type": "consensus_progress",
            "phase": phase.value if isinstance(phase, ConsensusPhase) else str(phase),
            "current": current,
            "required": required
        })
    
    def hide_progress(self) -> None:
        """隐藏进度条"""
        self.emit_progress(ConsensusPhase.IDLE, 0, 0)
    
    # ---- 决策区域可视化 ----
    
    def emit_decision_zone(
        self,
        vehicle_ids: List[str],
        active: bool = True
    ) -> None:
        """
        标记车辆进入或离开决策区域。
        决策区域内的车辆会有特殊的高亮效果。
        
        Args:
            vehicle_ids: 车辆ID列表
            active: True=进入决策区域, False=离开决策区域
        
        示例:
            self.emit_decision_zone(["veh_0", "veh_1"], active=True)
        """
        self._emit({
            "type": "decision_zone",
            "vehicles": vehicle_ids,
            "active": active
        })
    
    # ---- 拓扑可视化 ----
    
    def emit_topology(
        self,
        links: List[Dict[str, Any]]
    ) -> None:
        """
        更新网络拓扑可视化。
        前端将在车辆之间绘制连接线。
        
        Args:
            links: 连接列表, 每个连接是 {"from": "veh_id", "to": "veh_id", "strength": 0.0-1.0}
        
        示例:
            self.emit_topology([
                {"from": "veh_0", "to": "veh_1", "strength": 1.0},
                {"from": "veh_0", "to": "veh_2", "strength": 0.5}
            ])
        """
        self._emit({
            "type": "topology_update",
            "links": links
        })
    
    def clear_topology(self) -> None:
        """清除所有拓扑连接线"""
        self.emit_topology([])


class VisualizableNetworking(VisualizableMixin, ABC):
    """
    可视化网络协议基类。
    
    继承此类并实现 update() 方法来创建你的网络协议。
    使用 send_message() 方法发送消息，同时自动生成可视化事件。
    """
    
    def __init__(self):
        super().__init__()
    
    @abstractmethod
    def update(self, step: int) -> None:
        """
        每个仿真步长调用此方法。
        在这里实现你的网络协议逻辑。
        
        Args:
            step: 当前仿真步数
        """
        pass
    
    def send_message(
        self,
        from_id: str,
        to_id: str,
        msg_type: MessageType,
        data: Optional[Dict] = None
    ) -> None:
        """
        发送网络消息并生成可视化事件。
        
        Args:
            from_id: 发送方车辆ID
            to_id: 接收方车辆ID，或 "broadcast"
            msg_type: 消息类型
            data: 消息数据 (可选)
        """
        event = {
            "type": "message",
            "from": from_id,
            "to": to_id,
            "msgType": msg_type.value if isinstance(msg_type, MessageType) else str(msg_type)
        }
        if data:
            event["data"] = data
        self._emit(event)
    
    def broadcast(
        self,
        from_id: str,
        msg_type: MessageType,
        data: Optional[Dict] = None
    ) -> None:
        """广播消息给所有车辆"""
        self.send_message(from_id, "broadcast", msg_type, data)


# ============================================================
# 示例实现：简化的 PBFT 共识算法
# ============================================================

class ExamplePBFTConsensus(VisualizableConsensus):
    """
    PBFT 共识算法的简化示例实现。
    
    这个示例展示了如何使用可视化接口来展示共识过程。
    实际的 PBFT 实现会更复杂，这里只是为了演示可视化效果。
    
    使用方法:
        在 crossroad_runner.py 中:
        from visualization_interface import ExamplePBFTConsensus
        my_consensus = ExamplePBFTConsensus()
    """
    
    def __init__(self):
        super().__init__()
        self.phase = "idle"
        self.votes = {}
        self.round_start_step = 0
        self.participants = []
        self.leader = None
    
    def update(self, step: int):
        """
        简化的 PBFT 流程演示:
        1. 每100步启动一次新的共识轮次
        2. Leader 广播 PRE-PREPARE
        3. 节点发送 PREPARE
        4. 收集到足够 PREPARE 后发送 COMMIT
        5. 收集到足够 COMMIT 后完成
        """
        vehicles = list(traci.vehicle.getIDList())
        
        if len(vehicles) < 3:
            return  # 需要至少3个节点
        
        # 每100步启动新轮次
        if step % 100 == 0 and step > 0:
            self._start_new_round(step, vehicles)
        
        # 根据当前阶段执行逻辑
        steps_in_round = step - self.round_start_step
        
        if self.phase == "pre-prepare" and steps_in_round >= 5:
            self._do_prepare_phase()
        
        elif self.phase == "prepare" and steps_in_round >= 15:
            self._do_commit_phase()
        
        elif self.phase == "commit" and steps_in_round >= 25:
            self._finish_round()
    
    def _start_new_round(self, step: int, vehicles: List[str]):
        """启动新的共识轮次"""
        self.phase = "pre-prepare"
        self.round_start_step = step
        self.participants = vehicles[:5]  # 最多5个参与者
        self.leader = self.participants[0]
        self.votes = {"prepare": set(), "commit": set()}
        
        # 可视化: 设置 Leader 状态
        self.emit_state_change(self.leader, VehicleState.LEADER)
        
        # 可视化: 标记决策区域
        self.emit_decision_zone(self.participants, active=True)
        
        # 可视化: Leader 广播 PRE-PREPARE
        self.emit_broadcast(self.leader, MessageType.PRE_PREPARE)
        
        # 可视化: 显示进度条
        self.emit_progress(ConsensusPhase.PRE_PREPARE, 0, len(self.participants))
    
    def _do_prepare_phase(self):
        """PREPARE 阶段"""
        self.phase = "prepare"
        
        # 所有节点发送 PREPARE
        for i, node in enumerate(self.participants):
            if node != self.leader:
                # 可视化: 发送 PREPARE 消息给 Leader
                self.emit_message(node, self.leader, MessageType.PREPARE)
                # 可视化: 更新节点状态
                self.emit_state_change(node, VehicleState.PREPARING)
                self.votes["prepare"].add(node)
        
        # 可视化: 更新进度条
        self.emit_progress(
            ConsensusPhase.PREPARE, 
            len(self.votes["prepare"]), 
            len(self.participants) - 1
        )
    
    def _do_commit_phase(self):
        """COMMIT 阶段"""
        self.phase = "commit"
        
        # 所有节点发送 COMMIT
        for node in self.participants:
            # 可视化: 广播 COMMIT
            self.emit_broadcast(node, MessageType.COMMIT)
            # 可视化: 更新状态
            self.emit_state_change(node, VehicleState.COMMITTING)
            self.votes["commit"].add(node)
        
        # 可视化: 更新进度条
        self.emit_progress(
            ConsensusPhase.COMMIT,
            len(self.votes["commit"]),
            len(self.participants)
        )
    
    def _finish_round(self):
        """完成共识轮次"""
        self.phase = "idle"
        
        # 可视化: 所有节点标记为 COMMITTED
        for node in self.participants:
            self.emit_state_change(node, VehicleState.COMMITTED)
        
        # 可视化: 清除决策区域
        self.emit_decision_zone(self.participants, active=False)
        
        # 可视化: 隐藏进度条
        self.hide_progress()
        
        # 清理
        self.participants = []
        self.leader = None


# ============================================================
# 向后兼容的类 (保持与原有代码兼容)
# ============================================================

# 这些类保持与原有 algorithms.py 的兼容性
# 新代码建议使用上面的 Visualizable* 类

ConsensusAlgorithm = VisualizableConsensus  # 别名
NetworkingProtocol = VisualizableNetworking  # 别名
