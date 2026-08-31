# -*- coding: utf-8 -*-
"""方案 D：50 工位 + 大会议室 + 中会议室 + 4 间小洽谈 + 茶水区。"""
from layout import Field
from plan_model import N_ZONE, S_ZONE, area
from schemes import SPINE_Y, SPINE_X, SPINE_X_END, TOTAL

DESK = (1500, 750)
HEAD, CHAIR, AISLE, CROSS = 1200, 1800, 1000, 1200

# ---- 北区：全部 50 个工位（唯一有天然采光的区） ----
NF = Field(N_ZONE[0], N_ZONE[1], SPINE_X[0], N_ZONE[3],
           DESK[0], DESK[1], HEAD, CHAIR, AISLE, CROSS, 5, band_cols=[9, 9, 7]).build()
# 第 3 带让出的东端两列 → 打印 / 储物 / 电话亭
SVC = (NF.lanes[7], NF.bands[2][0], NF.lanes[8] + DESK[0], N_ZONE[3])

# ---- 南区：会议 / 洽谈 / 茶水 ----
SY0, SY1 = SPINE_Y[1], S_ZONE[3]          # 11849 → 20899（进深 9050）
SPUR = (5850, SY0, 7250, SY1)             # 纵向支通道 1400
W0, W1 = S_ZONE[0], SPUR[0]               # 西块 −50 → 5850  (5900)
E0, E1 = SPUR[2], S_ZONE[2]               # 东块 7250 → 12751 (5501)

ROOMS = [
    # (x0, y0, x1, y1, 名称, 人数, 门在哪一侧)
    (W0, SY0,    W1,    18349, '大会议室', '18–20 人', 'E'),
    (W0, 18449,  2850,  SY1,   '洽谈间 A', '4 人', 'E'),
    (2950, 18449, W1,   SY1,   '洽谈间 B', '4 人', 'N'),
    (E0, SY0,    E1,    15649, '中会议室', '8–10 人', 'W'),
    (E0, 15749,  9950,  18199, '洽谈间 C', '4 人', 'W'),
    (10050, 15749, E1,  18199, '洽谈间 D', '4 人', 'N'),
    (E0, 18299,  E1,    SY1,   '茶水区', '临南向采光', 'W'),
]

def rpt():
    print(f'改造总面积 {TOTAL:.1f} ㎡ = 北区 {area(N_ZONE):.1f} + 南区 {area(S_ZONE):.1f}\n')
    NF.report('北区工位场')
    print(f'   带 1、2 各 9 列，带 3 为 7 列 → {NF.seats} 工位')
    print(f'   让出的东端 {(SVC[2]-SVC[0])/1000:.1f}×{(SVC[3]-SVC[1])/1000:.1f} m = '
          f'{(SVC[2]-SVC[0])*(SVC[3]-SVC[1])/1e6:.1f} ㎡ → 打印 / 储物 / 电话亭 ×2\n')
    print('南区房间表：')
    tot = 0
    for x0, y0, x1, y1, name, cap, _ in ROOMS:
        a = (x1-x0)*(y1-y0)/1e6; tot += a
        print(f'   {name:8s} {x1-x0:5.0f} × {y1-y0:5.0f} = {a:5.1f} ㎡   {cap}')
    spur = (SPUR[2]-SPUR[0])*(SPUR[3]-SPUR[1])/1e6
    print(f'   {"纵向支通道":8s} {SPUR[2]-SPUR[0]:5.0f} × {SPUR[3]-SPUR[1]:5.0f} = {spur:5.1f} ㎡   1400 宽')
    print(f'   {"合计":8s} {"":13s}   {tot+spur:5.1f} ㎡')
    print(f'   南区主通道以南可用 {(S_ZONE[2]-S_ZONE[0])*(S_ZONE[3]-SY0)/1e6:.1f} ㎡  '
          f'→ 余量 {(S_ZONE[2]-S_ZONE[0])*(S_ZONE[3]-SY0)/1e6 - tot - spur:.1f} ㎡（墙体）')
    print(f'\n改造区综合密度：{TOTAL/NF.seats:.1f} ㎡/位（含全部会议、洽谈、茶水与通道）')

if __name__ == '__main__':
    rpt()
