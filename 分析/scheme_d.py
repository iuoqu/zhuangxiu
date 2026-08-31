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

# 4 间小洽谈贴南区主通道一字排开（门直接开到主通道），
# 大 / 中会议室与茶水区退到南侧安静端，门开到纵向支通道。
CUT = SY0 + 2450          # 洽谈间带的南边线 = 14299
ROOMS = [
    # (x0, y0, x1, y1, 名称, 人数, 门在哪一侧)
    (W0,    SY0, 2850, CUT,   '洽谈间 A', '4 人', 'N'),
    (2950,  SY0, W1,   CUT,   '洽谈间 B', '4 人', 'N'),
    (E0,    SY0, 9950, CUT,   '洽谈间 C', '4 人', 'N'),
    (10050, SY0, E1,   CUT,   '洽谈间 D', '4 人', 'N'),
    (W0,  CUT+100, W1, SY1,   '大会议室', '18–20 人', 'E'),
    (E0,  CUT+100, E1, 18199, '中会议室', '8–10 人', 'W'),
    (E0,  18299,   E1, SY1,   '茶水区', '临南向采光', 'W'),
]

SPINE_RECT = (S_ZONE[0], SPINE_Y[0], SPINE_X_END, SPINE_Y[1])


def door_of(room):
    x0, y0, x1, y1, _, _, side = room
    return {'E': (x1, (y0+y1)/2), 'W': (x0, (y0+y1)/2),
            'N': ((x0+x1)/2, y0), 'S': ((x0+x1)/2, y1)}[side]


def check():
    """每个房间的门必须落在主通道或支通道上 —— 防止再排出无入口的死角房间。"""
    def inside(p, r, tol=60):
        return r[0]-tol <= p[0] <= r[2]+tol and r[1]-tol <= p[1] <= r[3]+tol
    bad = []
    for r in ROOMS:
        p = door_of(r)
        if not (inside(p, SPINE_RECT) or inside(p, SPUR)):
            bad.append((r[4], r[6], p))
    return bad

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
    bad = check()
    print('\n门位校验：', '全部房间的门均开向通道 ✓' if not bad else '✗ 以下房间无入口：')
    for name, side, p in bad:
        print(f'   {name} 门({side}) @ {p}')
