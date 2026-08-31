# -*- coding: utf-8 -*-
"""由平面模型生成方案 D 的三维体块（轴对齐长方体），输出 JSON 供网页渲染器用。

竖向标高取自 03.4F-立面系统图.dwg 实测（见 dwg_check.py）：
  吊顶完成面 3000、门洞 2700、上层结构板底 4280、结构层高 4450。
其余为设定值：隔墙做到吊顶、工位屏风 1200、桌面 750、结构柱到吊顶。
"""
import json
import plan_model as M
from plan_model import COLS, GLAZ_N, GLAZ_W, GLAZ_S, KEEP, ENTRY, N_ZONE, S_ZONE
from schemes import SPINE_X, SPINE_Y, SPINE_X_END
import scheme_d as D

H_CEIL, H_SCREEN, H_DESK, H_TABLE = 3000, 1200, 750, 750   # H_CEIL 见 dwg_check.LEVELS
H_SOFFIT, H_DOOR = 4280, 2700               # 上层结构板底 / 门洞（DWG 实测）
WALL = 100                                   # 新建轻质隔墙厚

B = []                                        # (x, y, z, dx, dy, dz, 类别)
def box(x, y, z, dx, dy, dz, kind):
    if dx > 0 and dy > 0 and dz > 0:
        B.append([round(x), round(y), round(z), round(dx), round(dy), round(dz), kind])

def wall_ring(x0, y0, x1, y1, h, kind, t=WALL, sides='NSEW'):
    if 'N' in sides: box(x0, y0, 0, x1-x0, t, h, kind)
    if 'S' in sides: box(x0, y1-t, 0, x1-x0, t, h, kind)
    if 'W' in sides: box(x0, y0, 0, t, y1-y0, h, kind)
    if 'E' in sides: box(x1-t, y0, 0, t, y1-y0, h, kind)

# ---------- 楼板 ----------
sh = M.SHELL
box(sh['x0'], sh['y0'], -120, sh['x1']-sh['x0'], sh['y1']-sh['y0'], 120, 'slab')

# ---------- 通道地面（浅色）----------
def floor_tint(x0, y0, x1, y1, kind='aisle'):
    box(x0, y0, 0, x1-x0, y1-y0, 12, kind)
floor_tint(N_ZONE[0], N_ZONE[1], SPINE_X[1], N_ZONE[1]+D.HEAD)            # 北向采光通廊
floor_tint(SPINE_X[0], N_ZONE[1], SPINE_X[1], N_ZONE[3])                  # 入口纵向通道
floor_tint(S_ZONE[0], SPINE_Y[0], SPINE_X_END, SPINE_Y[1])                # 南区主通道
floor_tint(*D.SPUR)                                                        # 南区支通道
cx = (D.NF.lanes[4] + D.NF.desk_w, D.NF.lanes[5])
floor_tint(cx[0], N_ZONE[1]+D.HEAD, cx[1], SPINE_Y[1])                    # 北区纵向次通道
floor_tint(ENTRY[0], ENTRY[1], ENTRY[2], ENTRY[3], 'entry')               # 入口门厅

# ---------- 外墙与玻璃 ----------
# 有玻璃的段：窗下墙做到 900，其上是玻璃；无玻璃的段：实墙到吊顶。
# 03 号立面 DWG 中幕墙剖面为 0→4230 连续竖挺、无窗台/窗下墙分格线，
# 故按落地玻璃建模，仅留 100 底框（横梃确切位置图纸未表达）。
SILL = 100

def complement(lo, hi, runs):
    out, cur = [], lo
    for a, b in sorted(runs):
        a, b = max(a, lo), min(b, hi)
        if a > cur: out.append((cur, a))
        cur = max(cur, b)
    if cur < hi: out.append((cur, hi))
    return out

def facade(axis, pos, t, lo, hi, runs):
    """axis='H' 横向立面(沿 X)，'V' 纵向立面(沿 Y)；pos 为墙内表面起点"""
    for a, b in runs:                                   # 窗下墙 + 玻璃
        if axis == 'H':
            box(a, pos, 0, b-a, t, SILL, 'ext')
            box(a, pos, SILL, b-a, t, H_CEIL-SILL, 'glass')
        else:
            box(pos, a, 0, t, b-a, SILL, 'ext')
            box(pos, a, SILL, t, b-a, H_CEIL-SILL, 'glass')
    for a, b in complement(lo, hi, runs):               # 实墙
        if axis == 'H': box(a, pos, 0, b-a, t, H_CEIL, 'ext')
        else:           box(pos, a, 0, t, b-a, H_CEIL, 'ext')

facade('H', sh['y0'],     250, sh['x0'], sh['x1'], GLAZ_N)          # 北
facade('H', sh['y1']-250, 250, sh['x0'], sh['x1'], GLAZ_S)          # 南
facade('V', sh['x0'],     250, sh['y0'], sh['y1'], GLAZ_W)          # 西
facade('V', sh['x1']-250, 250, sh['y0'], sh['y1'], [])              # 东

# ---------- 结构柱 ----------
for (x, y, w, h) in COLS: box(x, y, 0, w, h, H_CEIL, 'col')

# ---------- 保留房间 ----------
for (x0, y0, x1, y1, lab) in KEEP:
    wall_ring(x0, y0, x1, y1, H_CEIL, 'keep', t=150)
    box(x0+150, y0+150, 0, x1-x0-300, y1-y0-300, 8, 'keepfloor')

# ---------- 方案 D：南区房间 ----------
for (x0, y0, x1, y1, name, cap, door) in D.ROOMS:
    kind = 'room' if ('会议室' in name or '洽谈' in name) else 'pantry'
    wall_ring(x0, y0, x1, y1, H_CEIL, kind)
    box(x0, y0, 0, x1-x0, y1-y0, 8, kind+'floor')
    # 门洞：把门那一侧的墙断开成两段
    d = 1000
    if door in 'NS':
        yy = y0 if door == 'N' else y1-WALL
        mx = (x0+x1)/2
        B[:] = [b for b in B if not (b[5] == H_CEIL and b[1] == round(yy) and b[0] == round(x0) and b[3] == round(x1-x0))]
        box(x0, yy, 0, mx-d/2-x0, WALL, H_CEIL, kind)
        box(mx+d/2, yy, 0, x1-(mx+d/2), WALL, H_CEIL, kind)
    else:
        xx = x0 if door == 'W' else x1-WALL
        my = (y0+y1)/2
        B[:] = [b for b in B if not (b[5] == H_CEIL and b[0] == round(xx) and b[1] == round(y0) and b[4] == round(y1-y0))]
        box(xx, y0, 0, WALL, my-d/2-y0, H_CEIL, kind)
        box(xx, my+d/2, 0, WALL, y1-(my+d/2), H_CEIL, kind)
    # 会议桌
    if '会议室' in name:
        tw, th = (5050, 1800) if '大' in name else (1500, 4100)
        box((x0+x1)/2-tw/2, (y0+y1)/2-th/2, 0, tw, th, H_TABLE, 'table')
    elif '洽谈' in name:
        r = 900 if x1-x0 < 3000 else 1600
        box((x0+x1)/2-r/2, (y0+y1)/2-450, 0, r, 900, H_TABLE, 'table')
    else:                                     # 茶水区吧台
        box(x0+300, y1-900, 0, x1-x0-600, 600, 900, 'counter')

# ---------- 打印 / 储物 ----------
sx0, sy0, sx1, sy1 = D.SVC
box(sx0, sy0, 0, sx1-sx0, sy1-sy0, 8, 'pantryfloor')
box(sx0+100, sy0+100, 0, 700, sy1-sy0-200, 1800, 'cabinet')
box(sx1-1400, sy0+200, 0, 1200, 1200, 2200, 'cabinet')

# ---------- 工位 ----------
dw, dd = D.DESK
for d_ in D.NF.desks:
    box(d_.x+30, d_.y+30, 0, dw-60, dd-60, H_DESK, 'desk')
    cy = d_.y - 620 if d_.facing == 'N' else d_.y + dd + 120
    box(d_.x+dw/2-260, cy, 0, 520, 500, 450, 'chair')
    box(d_.x+dw/2-260, cy + (0 if d_.facing=='N' else 420), 450, 520, 80, 500, 'chair')
for (by0, by1) in D.NF.bands:                 # 背靠背中间的屏风
    n = len(D.NF.lanes)
    for i, lx in enumerate(D.NF.lanes):
        if any(abs(d_.x-lx) < 1 and abs(d_.y-by0) < 1 for d_ in D.NF.desks):
            box(lx+30, by0+dd-40, H_DESK, dw-60, 80, H_SCREEN-H_DESK, 'screen')

meta = dict(H_CEIL=H_CEIL, H_SOFFIT=H_SOFFIT, H_DOOR=H_DOOR, seats=D.NF.seats,
            bounds=[sh['x0'], sh['y0'], sh['x1'], sh['y1']])

if __name__ == '__main__':
    json.dump({'meta': meta, 'boxes': B}, open('model3d.json', 'w'), separators=(',', ':'))
    from collections import Counter
    c = Counter(b[6] for b in B)
    print(f'体块 {len(B)} 个，面 {len(B)*6} 个')
    for k, v in c.most_common(): print(f'   {k:12s} {v}')
