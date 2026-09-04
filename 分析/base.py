# -*- coding: utf-8 -*-
"""导出「固定底板」—— 这层楼里怎么排都不会变的那部分。

甲方定的：电梯、楼梯、厕所、客房不可变，其余都可变。加上本来就动不了的
结构与外围（轴网、18 根柱、外墙、幕墙分格、层高），这些合起来就是底板。
底板只从 DWG 出一次，任何新排布都不再碰它 —— 一版新方案要描述的，
只剩下「可变区里放了什么」。

    python3 分析/base.py      →  models/base.json
"""
import json, os, sys

sys.path.insert(0, os.path.dirname(__file__))
import plan_model as M

OUT = os.path.join(os.path.dirname(__file__), '..', 'models', 'base.json')

# 甲方点名不可变的四类，加上机电井和它们之间的走道 —— 这些在 PLAN A／B 里
# 位置也完全一样，等于已经被两版方案独立印证过一次
FIXED = ['电梯', '楼梯', '男卫生间', '女卫生间', '盥洗', '客房 01', '客房 02', '客房走道',
         '强电井', '弱电井']
# 甲方 2025-09 明确点名「可以考虑拆除」的四间。它们仍然画在底板上（现状），
# 但标成 demo —— 方案文件里写一句 "demolish": ["IT", ...] 就能拆掉，拆掉腾出的
# 面积进可变区。甲方自己的 PLAN A／B 就拆了 IT 和清扫间：那两间的位置上画着洽谈室。
DEMO = ['IT', '清扫间', '备餐间', '茶水间']
KEPT = []


def bucket(label):
    head = label.split('\n')[0].split(' →')[0].strip()
    for k in FIXED:
        if head.startswith(k):
            return 'fixed'
    for k in DEMO:
        if head.startswith(k):
            return 'demo'
    return 'kept'



def freed(rooms):
    """拆掉 demo 房间腾出来的地方 —— 按 Y 扫一遍，X 范围一样的相邻带并成一块。

    这四间挤在东南角，单独一间一间给的话矩形太碎，装箱算法跨不过中间那道墙。
    """
    ds = sorted([r for r in rooms if r['lock'] == 'demo'], key=lambda r: r['y'][0])
    if not ds:
        return []
    cuts = sorted({v for r in ds for v in r['y']})
    bands = []
    for a, b in zip(cuts, cuts[1:]):
        xs = [r['x'] for r in ds if r['y'][0] <= a and r['y'][1] >= b]
        if not xs:
            continue
        bands.append([min(x[0] for x in xs), a, max(x[1] for x in xs), b])
    out = []
    for b in bands:                                  # X 相同就跟上一块拼起来
        if out and out[-1][0] == b[0] and out[-1][2] == b[2] and b[1] - out[-1][3] < 300:
            out[-1][3] = b[3]
        else:
            out.append(b)
    names = '／'.join(r['n'] for r in ds)
    keep = [r for r in rooms if r['lock'] != 'demo']
    return [{'n': f'东南区 {i+1}', 'x': [b[0] - 50, b[2]], 'y': [b[1] - 50, b[3]],
             'light': touches_glass(b), 'unlock': [r['n'] for r in ds
                                                   if r['y'][0] < b[3] and r['y'][1] > b[1]],
             'note': f'拆 {names} 之后才有'}
            for i, b in enumerate(wall_off(out, keep))]


WALL = 150


def wall_off(bands, keep):
    # 腾出来的地跟保留房间之间要留一道隔墙。原来的茶水间东墙 x=17700 就是客房 01
    # 的西墙 —— 拆掉茶水间那道墙也跟着没了，可变区直接贴到宿舍上，中间 0 mm。
    # 拆的是自己那几间的墙，不是跟别人共用的那道。
    out = []
    for b in bands:
        x0, y0, x1, y1 = b
        for r in keep:
            (rx0, rx1), (ry0, ry1) = r['x'], r['y']
            if ry0 < y1 and ry1 > y0:
                if abs(rx0 - x1) < 60:
                    x1 -= WALL
                if abs(rx1 - x0) < 60:
                    x0 += WALL
        for r in keep:
            (rx0, rx1), (ry0, ry1) = r['x'], r['y']
            if rx0 < x1 and rx1 > x0:
                if abs(ry0 - y1) < 60:
                    y1 -= WALL
                if abs(ry1 - y0) < 60:
                    y0 += WALL
        out.append([x0, y0, x1, y1])
    return out


def touches_glass(b):
    """这块地贴不贴幕墙 —— 决定它该排工位还是排会议室。"""
    x0, y0, x1, y1 = b
    if y1 >= M.SHELL['y1'] - 400 or y1 >= 20899 - 100:
        return any(min(x1, e) - max(x0, a) > 1500 for a, e in M.GLAZ_S)
    return False


def main():
    rooms = []
    for x0, y0, x1, y1, lab in M.KEEP:
        rooms.append({'n': lab.split('\n')[0].split(' →')[0].strip(),
                      'x': [x0, x1], 'y': [y0, y1], 'lock': bucket(lab)})
    data = {
        'note': '固定底板：结构＋外围＋不可变房间。任何方案都不改这里。',
        'shell': M.SHELL,
        'axis': {'x': M.AXIS_X, 'y': M.AXIS_Y},
        'columns': [{'x': c[0], 'y': c[1], 'w': c[2], 'd': c[3]} for c in M.COLS],
        'glazing': {'north_y': 350, 'west_x': 52, 'south_y': 20899,
                    'north': M.GLAZ_N, 'west': M.GLAZ_W, 'south': M.GLAZ_S,
                    'module': 4050, 'top': 4230},
        'levels': {'层高': 4450, '结构板底': 4280, '原吊顶': 3000, '门洞': 2700},
        # 疏散口。量的是「办公区一侧的那个点」—— 电梯厅、卫生间之间那些核心筒走道
        # 底板里没建模，量不进去。出口 1 原来标在 (24000,4500)，那点落在楼梯间**里面**，
        # 西边跟男卫生间之间只剩 850 的缝，过不去 —— 结果这个口一直没被算进疏散距离，
        # 所有数都只量到了出口 2。挪到门厅东端，那儿是模型里通到电梯厅的最后一点。
        'exits': [{'n': '安全出口 1 · 楼梯', 'x': 21000, 'y': 2600},
                  {'n': '安全出口 2 · 客房走道', 'x': 16500, 'y': 12061}],
        'egress_max': 27500,
        'rooms': rooms,
        # 门厅出来那一块必须空着 —— 不然人从电梯厅进来一头撞在会议室后墙上。
        # 北区东到 18098，门厅从 18400 起，中间就是进场口。
        # 深度默认按主通道 1800 算，排布页会跟着「主通道」那一栏走。
        'clear': [{'n': '门厅进场', 'edge': 'W', 'depth': 1800,
                   'x': [M.N_ZONE[2] - 1800, M.N_ZONE[2]],
                   'y': [M.ENTRY[1] + 200, M.ENTRY[3]]}],
        'entry': {'n': M.ENTRY[4].split(' /')[0], 'x': [M.ENTRY[0], M.ENTRY[2]],
                  'y': [M.ENTRY[1], M.ENTRY[3]], 'lock': 'kept'},
        # 可变区：北区（原活动休闲区）＋南区（原宿舍），排布只在这两块里发生。
        # 后面几块要先拆掉 demo 房间才腾得出来，unlock 里写的就是得拆哪几间。
        'free': [{'n': '北区', 'x': [M.N_ZONE[0], M.N_ZONE[2]], 'y': [M.N_ZONE[1], M.N_ZONE[3]],
                  'light': True},
                 {'n': '南区', 'x': [M.S_ZONE[0], M.S_ZONE[2]], 'y': [M.S_ZONE[1], M.S_ZONE[3]],
                  'light': False}] + freed(rooms),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(data, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    nf = sum(1 for r in rooms if r['lock'] == 'fixed')
    print(f'底板 → {os.path.normpath(OUT)}')
    print(f'  柱 {len(data["columns"])} 根　不可变房间 {nf} 间　保留但可覆盖 {len(rooms)-nf} 间')
    print(f'  可变区：北区 {M.area(M.N_ZONE):.1f} ㎡ ＋ 南区 {M.area(M.S_ZONE):.1f} ㎡'
          f' = {M.area(M.N_ZONE)+M.area(M.S_ZONE):.1f} ㎡')
    for r in rooms:
        print(f'    [{r["lock"]:5s}] {r["n"]:10s} X {r["x"][0]:6d}~{r["x"][1]:6d}  Y {r["y"][0]:6d}~{r["y"][1]:6d}')


if __name__ == '__main__':
    main()
