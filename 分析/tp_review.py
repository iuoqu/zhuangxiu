# -*- coding: utf-8 -*-
"""第三方 4F 平面方案（PLAN A / B）与方案 D 的对照。

第三方图纸坐标系已与《四层平面布置图》对齐：结构柱、轴距、北立面四段玻璃
（301-4352 / 4853-8900 / 9499-13550 / 14051-18098）逐项吻合，说明同一套底图。
以下尺寸均由该 PDF 矢量图元反算。
"""
from plan_model import GLAZ_N, GLAZ_W, GLAZ_S
import scheme_d as D

# ---- 第三方工位模数（中部工位区实测：竖线 1700/2400/3100 | 4800/5500/6200 | 7900/8600）----
TP_MOD = dict(desk_w=1400, desk_d=700, band=1400, chair=1700, pitch=3100)
MY_MOD = dict(desk_w=D.DESK[0], desk_d=D.DESK[1], band=2*D.DESK[1], chair=D.CHAIR,
              pitch=2*D.DESK[1]+D.CHAIR)

# ---- 第三方工位分布（PLAN A，逐列逐排实测）----
# (说明, 椅子列 X, 排 Y, 座位数)
TP_A = [
    ('北带', [9942, 11958, 13011, 15027], [1350, 2750, 4150], 12),
    ('中带', [1420, 3440, 4490, 6510, 7560], [7950, 9350, 10750, 12150], 20),
    ('南带', [5884, 6985, 9002, 10057, 12120], [15300, 16750, 18250, 19700], 20),
]

TP_ROOMS = [   # (名称, 宽, 深, 图注㎡, 家具/容量)
    ('大会议室 (A)', 8881, 4802, 40, '桌 ~5240×1700，7+7+2 = 16 人'),
    ('大会议室 (B)', 8503, 4802, 40, '同上，位置东移'),
    ('小会议室',     4852, 3682, 17, '桌 ~2450×1800，3+3+2 = 8 人'),
    ('洽谈室03 ①',   2649, 2825,  7, 'Ø900 圆桌 4 人'),
    ('洽谈室03 ②',   2649, 2825,  7, 'Ø900 圆桌 4 人'),
    ('洽谈室03 ③',   3349, 2569,  7, 'Ø900 圆桌 4 人'),
    ('备餐间',       2649, 2799,  7, '保留'),
]

def merge(runs, gap=900):
    """柱间窗间墙只有 500~600 宽，光会绕过去 —— 把相邻玻璃段并成连续采光面。"""
    out = []
    for a, b in sorted(runs):
        if out and a - out[-1][1] <= gap: out[-1][1] = max(out[-1][1], b)
        else: out.append([a, b])
    return [tuple(r) for r in out]

GN, GW, GS = merge(GLAZ_N), merge(GLAZ_W), merge(GLAZ_S)


def daylight(x, y):
    """到最近可用采光面的距离；窗段以外的横向偏移按直角距离计入。"""
    def dist(p, lo, hi, perp):
        lat = 0 if lo <= p <= hi else min(abs(p-lo), abs(p-hi))
        return (perp**2 + lat**2) ** .5
    d = [dist(x, a, b, y - 350) for a, b in GN]
    d += [dist(y, a, b, x - 300) for a, b in GW]
    d += [dist(x, a, b, 20899 - y) for a, b in GS]
    m = min(d)
    return ('良好 (≤6m)' if m <= 6000 else '偏弱 (6~10m)' if m <= 10000 else '无窗内区 (>10m)'), m

def tally(seats):
    from collections import Counter
    c = Counter()
    for x, y in seats: c[daylight(x, y)[0]] += 1
    return c

def tp_seats():
    out = []
    for _, xs, ys, _ in TP_A:
        for x in xs:
            for y in ys: out.append((x, y))
    return out

def my_seats():
    return [(d.x + D.DESK[0]/2, d.y + D.DESK[1]/2) for d in D.NF.desks]

if __name__ == '__main__':
    print('=== 工位模数 ===')
    print(f'{"":14s}{"第三方":>16s}{"方案 D":>16s}')
    for k, lab in [('desk_w','桌宽'),('desk_d','桌深'),('band','背靠背带宽'),
                   ('chair','座椅+通行区'),('pitch','排距')]:
        print(f'{lab:14s}{TP_MOD[k]:>16d}{MY_MOD[k]:>16d}')
    print(f'{"每人座椅净距":14s}{TP_MOD["chair"]//2:>16d}{MY_MOD["chair"]//2:>16d}')

    ts, ms = tp_seats(), my_seats()
    print(f'\n=== 工位数 ===  第三方 {len(ts)}（图注 52P）   方案 D {len(ms)}')
    print('\n=== 采光分级（按到最近可用采光面的距离）===')
    ta, ma = tally(ts), tally(ms)
    order = ['良好 (≤6m)', '偏弱 (6~10m)', '无窗内区 (>10m)']
    print(f'{"":16s}{"第三方 52":>12s}{"方案 D 50":>12s}')
    for k in order:
        print(f'{k:16s}{ta.get(k,0):>12d}{ma.get(k,0):>12d}')

    print('\n=== 北向采光面被占用情况（北立面玻璃合计 16.2 m）===')
    for nm, a, b in [('PLAN A 大会议室', -81, 8800), ('PLAN B 大会议室', 7898, 16401)]:
        occ = sum(max(0, min(b, g1) - max(a, g0)) for g0, g1 in GLAZ_N)
        print(f'   {nm}: 占 {occ/1000:.1f} m = {occ/16196*100:.0f}%')
    print('   方案 D：北窗全部面向工位区，占 0%')
