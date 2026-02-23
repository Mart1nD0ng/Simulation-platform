"""
策略可视化工具 - 改进版
用于展示遗传算法训练出的策略决策表
支持40状态连续加速度策略
"""
import numpy as np
import pickle
import sys
from ga_traffic_strategy import GeneticTrafficStrategy

def visualize_strategy(strategy: GeneticTrafficStrategy):
    """
    以表格形式展示策略的所有决策
    
    Args:
        strategy: 要可视化的策略
    """
    print("\n" + "="*90)
    print("策略决策表可视化".center(90))
    print("="*90)
    
    chromosome = strategy.chromosome
    
    # 检测策略版本
    if len(chromosome) == 18:
        visualize_old_strategy(strategy)
        return
    elif len(chromosome) != 40:
        print(f"警告: 未知的染色体长度 {len(chromosome)}")
        return
    
    # 新版40状态策略
    dist_ranges = ["0-5m", "5-10m", "10-15m", "15-20m", "20-30m"]
    speed_ranges = ["0-3m/s", "3-8m/s", "8-13m/s", "13-20m/s"]
    light_states = ["绿灯", "红灯"]
    
    print("\n说明: 表格显示不同状态下的加速度决策 (单位: m/s²)")
    print("="*90)
    
    for light_idx, light_state in enumerate(light_states):
        print(f"\n[{light_state}]")
        print("-"*90)
        
        # 表头
        print(f"{'距离':<12}", end="")
        for speed_range in speed_ranges:
            print(f"{speed_range:>16}", end="")
        print()
        print("-"*90)
        
        # 数据行
        for dist_idx, dist_range in enumerate(dist_ranges):
            print(f"{dist_range:<12}", end="")
            
            for speed_idx in range(len(speed_ranges)):
                # 计算状态索引
                state_idx = light_idx * 20 + dist_idx * 4 + speed_idx
                accel = chromosome[state_idx]
                
                # 格式化输出，带颜色标记
                if accel < -2.0:
                    marker = "↓↓"  # 强减速
                elif accel < -0.5:
                    marker = "↓"   # 减速
                elif accel < 0.5:
                    marker = "→"   # 维持
                else:
                    marker = "↑"   # 加速
                
                print(f"{accel:>7.2f}{marker:<7}", end="")
            print()
        print()


def visualize_old_strategy(strategy: GeneticTrafficStrategy):
    """可视化旧版18状态策略"""
    print("\n检测到旧版策略 (18状态)")
    
    action_map = {
        -2.0: "减速",
        0.0: "维持",
        2.0: "加速"
    }
    
    dist_ranges = ["0-10m", "10-20m", "20-30m"]
    speed_ranges = ["0-5m/s", "5-15m/s", "15-20m/s"]
    light_states = ["绿灯", "红灯"]
    
    for light_idx, light_state in enumerate(light_states):
        print(f"\n[{light_state}]")
        print("-"*70)
        
        print(f"{'距离':<12}", end="")
        for speed_range in speed_ranges:
            print(f"{speed_range:>15}", end="")
        print()
        print("-"*70)
        
        for dist_idx, dist_range in enumerate(dist_ranges):
            print(f"{dist_range:<12}", end="")
            
            for speed_idx in range(len(speed_ranges)):
                state_idx = light_idx * 9 + dist_idx * 3 + speed_idx
                action_idx = strategy.chromosome[state_idx]
                accel = strategy.ACCEL_OPTIONS[action_idx]
                action_str = action_map[accel]
                
                print(f"{action_str:>15}", end="")
            print()
        print()


def analyze_strategy_patterns(strategy: GeneticTrafficStrategy):
    """
    分析策略的决策模式
    
    Args:
        strategy: 要分析的策略
    """
    print("\n" + "="*90)
    print("策略模式分析".center(90))
    print("="*90)
    
    chromosome = strategy.chromosome
    
    if len(chromosome) == 18:
        analyze_old_strategy_patterns(strategy)
        return
    elif len(chromosome) != 40:
        print(f"警告: 未知的染色体长度 {len(chromosome)}")
        return
    
    # 分离红绿灯策略
    green_actions = chromosome[:20]
    red_actions = chromosome[20:]
    
    print(f"\n决策统计:")
    print(f"{'类别':<20} {'绿灯':<20} {'红灯':<20}")
    print("-"*60)
    
    # 平均加速度
    print(f"{'平均加速度 (m/s²)':<20} {np.mean(green_actions):>18.2f} {np.mean(red_actions):>18.2f}")
    print(f"{'最大加速度 (m/s²)':<20} {np.max(green_actions):>18.2f} {np.max(red_actions):>18.2f}")
    print(f"{'最小加速度 (m/s²)':<20} {np.min(green_actions):>18.2f} {np.min(red_actions):>18.2f}")
    print(f"{'标准差':<20} {np.std(green_actions):>18.2f} {np.std(red_actions):>18.2f}")
    
    # 决策分布
    green_decel = sum(1 for a in green_actions if a < -0.5)
    green_maintain = sum(1 for a in green_actions if -0.5 <= a <= 0.5)
    green_accel = sum(1 for a in green_actions if a > 0.5)
    
    red_decel = sum(1 for a in red_actions if a < -0.5)
    red_maintain = sum(1 for a in red_actions if -0.5 <= a <= 0.5)
    red_accel = sum(1 for a in red_actions if a > 0.5)
    
    print(f"\n决策分布:")
    print(f"  绿灯: 减速={green_decel}({green_decel/20*100:.0f}%), "
          f"维持={green_maintain}({green_maintain/20*100:.0f}%), "
          f"加速={green_accel}({green_accel/20*100:.0f}%)")
    print(f"  红灯: 减速={red_decel}({red_decel/20*100:.0f}%), "
          f"维持={red_maintain}({red_maintain/20*100:.0f}%), "
          f"加速={red_accel}({red_accel/20*100:.0f}%)")
    
    # 安全性分析
    print(f"\n安全性指标:")
    print(f"  红灯时减速比例: {red_decel/20*100:.1f}%")
    
    # 近距离策略
    near_red_actions = [red_actions[i] for i in range(8)]  # 0-10m
    print(f"  近距离(0-10m)红灯平均加速度: {np.mean(near_red_actions):.2f} m/s²")
    
    # 紧急制动检测
    emergency_red = sum(1 for a in near_red_actions if a < -2.5)
    print(f"  近距离红灯紧急制动(<-2.5)比例: {emergency_red/8*100:.1f}%")


def analyze_old_strategy_patterns(strategy: GeneticTrafficStrategy):
    """分析旧版策略模式"""
    print(f"\n决策分布:")
    
    action_counts = [0, 0, 0]
    for gene in strategy.chromosome:
        action_counts[gene] += 1
    
    total = len(strategy.chromosome)
    print(f"  减速: {action_counts[0]}/{total} ({action_counts[0]/total*100:.1f}%)")
    print(f"  维持: {action_counts[1]}/{total} ({action_counts[1]/total*100:.1f}%)")
    print(f"  加速: {action_counts[2]}/{total} ({action_counts[2]/total*100:.1f}%)")
    
    green_actions = strategy.chromosome[:9]
    red_actions = strategy.chromosome[9:]
    
    green_accel_count = sum(1 for a in green_actions if a == 2)
    red_decel_count = sum(1 for a in red_actions if a == 0)
    
    print(f"\n红绿灯状态分析:")
    print(f"  绿灯时加速: {green_accel_count}/9 ({green_accel_count/9*100:.1f}%)")
    print(f"  红灯时减速: {red_decel_count}/9 ({red_decel_count/9*100:.1f}%)")


def export_strategy_heatmap(strategy: GeneticTrafficStrategy, filename: str = "strategy_heatmap.png"):
    """
    导出策略的热力图
    
    Args:
        strategy: 要可视化的策略
        filename: 保存文件名
    """
    try:
        import matplotlib.pyplot as plt
        import matplotlib
        matplotlib.use('Agg')
        
        chromosome = strategy.chromosome
        
        if len(chromosome) == 18:
            export_old_strategy_heatmap(strategy, filename)
            return
        elif len(chromosome) != 40:
            print(f"警告: 未知的染色体长度 {len(chromosome)}")
            return
        
        # 创建数据矩阵
        green_states = np.zeros((5, 4))  # 5距离 x 4速度
        red_states = np.zeros((5, 4))
        
        for i in range(40):
            light_idx = i // 20
            remaining = i % 20
            dist_idx = remaining // 4
            speed_idx = remaining % 4
            
            if light_idx == 0:
                green_states[dist_idx, speed_idx] = chromosome[i]
            else:
                red_states[dist_idx, speed_idx] = chromosome[i]
        
        # 绘图
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(16, 6))
        
        dist_labels = ['0-5m\n(很近)', '5-10m\n(近)', '10-15m\n(中)', '15-20m\n(远)', '20-30m\n(很远)']
        speed_labels = ['0-3m/s\n(慢)', '3-8m/s\n(中慢)', '8-13m/s\n(中快)', '13-20m/s\n(快)']
        
        vmin, vmax = -4.0, 2.0
        
        # 绿灯状态
        im1 = ax1.imshow(green_states, cmap='RdYlGn', vmin=vmin, vmax=vmax, aspect='auto')
        ax1.set_xticks(range(4))
        ax1.set_yticks(range(5))
        ax1.set_xticklabels(speed_labels, fontsize=9)
        ax1.set_yticklabels(dist_labels, fontsize=9)
        ax1.set_xlabel('速度', fontsize=11, fontweight='bold')
        ax1.set_ylabel('距离路口', fontsize=11, fontweight='bold')
        ax1.set_title('策略决策: 绿灯', fontsize=13, fontweight='bold', color='green')
        
        for i in range(5):
            for j in range(4):
                value = green_states[i, j]
                color = 'white' if abs(value) > 1.5 else 'black'
                ax1.text(j, i, f'{value:.1f}',
                        ha="center", va="center", color=color, fontsize=9, fontweight='bold')
        
        # 红灯状态
        im2 = ax2.imshow(red_states, cmap='RdYlGn', vmin=vmin, vmax=vmax, aspect='auto')
        ax2.set_xticks(range(4))
        ax2.set_yticks(range(5))
        ax2.set_xticklabels(speed_labels, fontsize=9)
        ax2.set_yticklabels(dist_labels, fontsize=9)
        ax2.set_xlabel('速度', fontsize=11, fontweight='bold')
        ax2.set_ylabel('距离路口', fontsize=11, fontweight='bold')
        ax2.set_title('策略决策: 红灯', fontsize=13, fontweight='bold', color='red')
        
        for i in range(5):
            for j in range(4):
                value = red_states[i, j]
                color = 'white' if abs(value) > 1.5 else 'black'
                ax2.text(j, i, f'{value:.1f}',
                        ha="center", va="center", color=color, fontsize=9, fontweight='bold')
        
        # 颜色条
        cbar = plt.colorbar(im2, ax=[ax1, ax2], orientation='horizontal', 
                            pad=0.12, fraction=0.05, aspect=40)
        cbar.set_label('加速度 (m/s²)', fontsize=11, fontweight='bold')
        cbar.ax.tick_params(labelsize=9)
        
        plt.suptitle('遗传算法交通策略可视化 - 加速度决策热图', 
                    fontsize=15, fontweight='bold', y=0.98)
        
        fig.text(0.5, 0.02, 
                '颜色说明: 红色=减速 | 黄色=维持 | 绿色=加速 | 数值=加速度(m/s²)',
                ha='center', fontsize=10, style='italic',
                bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))
        
        plt.tight_layout(rect=[0, 0.04, 1, 0.96])
        plt.savefig(filename, dpi=300, bbox_inches='tight')
        print(f"\n热力图已保存至: {filename}")
        plt.close()
        
    except ImportError:
        print("\n警告: matplotlib未安装，无法生成热力图")


def export_old_strategy_heatmap(strategy: GeneticTrafficStrategy, filename: str):
    """导出旧版策略热力图"""
    import matplotlib.pyplot as plt
    import matplotlib
    
    green_states = np.zeros((3, 3))
    red_states = np.zeros((3, 3))
    
    for i in range(18):
        light_idx = i // 9
        remaining = i % 9
        dist_idx = remaining // 3
        speed_idx = remaining % 3
        
        if light_idx == 0:
            green_states[dist_idx, speed_idx] = strategy.chromosome[i]
        else:
            red_states[dist_idx, speed_idx] = strategy.chromosome[i]
    
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))
    
    dist_labels = ['0-10m', '10-20m', '20-30m']
    speed_labels = ['0-5m/s', '5-15m/s', '15-20m/s']
    
    cmap = matplotlib.colors.ListedColormap(['red', 'yellow', 'green'])
    bounds = [-0.5, 0.5, 1.5, 2.5]
    norm = matplotlib.colors.BoundaryNorm(bounds, cmap.N)
    
    im1 = ax1.imshow(green_states, cmap=cmap, norm=norm, aspect='auto')
    ax1.set_xticks(range(3))
    ax1.set_yticks(range(3))
    ax1.set_xticklabels(speed_labels)
    ax1.set_yticklabels(dist_labels)
    ax1.set_title('绿灯策略', fontsize=14)
    
    for i in range(3):
        for j in range(3):
            action_names = ['减速', '维持', '加速']
            ax1.text(j, i, action_names[int(green_states[i, j])],
                    ha="center", va="center", color="black", fontsize=10)
    
    im2 = ax2.imshow(red_states, cmap=cmap, norm=norm, aspect='auto')
    ax2.set_xticks(range(3))
    ax2.set_yticks(range(3))
    ax2.set_xticklabels(speed_labels)
    ax2.set_yticklabels(dist_labels)
    ax2.set_title('红灯策略', fontsize=14)
    
    for i in range(3):
        for j in range(3):
            action_names = ['减速', '维持', '加速']
            ax2.text(j, i, action_names[int(red_states[i, j])],
                    ha="center", va="center", color="black", fontsize=10)
    
    plt.suptitle('策略可视化（旧版）', fontsize=16, fontweight='bold')
    plt.tight_layout()
    plt.savefig(filename, dpi=300, bbox_inches='tight')
    print(f"\n热力图已保存至: {filename}")
    plt.close()


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='策略可视化工具')
    parser.add_argument('strategy_file', type=str, nargs='?', default='best_ga_strategy.pkl',
                        help='策略文件路径')
    parser.add_argument('--heatmap', action='store_true',
                        help='生成热力图')
    parser.add_argument('--output', type=str, default='strategy_heatmap.png',
                        help='热力图输出文件名')
    
    args = parser.parse_args()
    
    try:
        # 加载策略
        print(f"加载策略: {args.strategy_file}")
        strategy = GeneticTrafficStrategy.load(args.strategy_file)
        
        # 可视化决策表
        visualize_strategy(strategy)
        
        # 分析策略模式
        analyze_strategy_patterns(strategy)
        
        # 生成热力图
        if args.heatmap:
            export_strategy_heatmap(strategy, args.output)
        
        print("\n" + "="*90)
        print("可视化完成")
        print("="*90 + "\n")
        
    except FileNotFoundError:
        print(f"错误: 找不到策略文件 {args.strategy_file}")
        print("请先训练策略: python ga_crossroad_runner.py --mode train")
        sys.exit(1)
    except Exception as e:
        print(f"错误: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
