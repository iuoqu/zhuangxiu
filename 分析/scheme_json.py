# -*- coding: utf-8 -*-
"""把 schemes/<id>.json 变成 render.py 认得的那套接口。

render.py 原来直接 import scheme_d（方案 D 写死在 Python 里）。这个模块提供
同样的名字（ROOMS / DESK / NF / SVC / SPUR / door_of），但内容来自方案文件 ——
所以「排布」页上生成或拖出来的任何一版，都能直接出白模和 AI 底图。

    import scheme_json; D = scheme_json.load('A')
"""
import json, os
from layout import Desk
from plan_model import N_ZONE, S_ZONE
from schemes import SPINE_Y, SPINE_X_END

ROOT = os.path.join(os.path.dirname(__file__), '..')
CHAIR_GAP = 1800          # 两条工位带之间：两侧各一把椅子
TRAIL = 900               # 最后一条带后面留的座椅净距


class Bands:
    """假装成 layout.Field —— render.py 只用到 .desks / .seats / .lanes / .bands。"""
    def __init__(self, desks, lanes, bands):
        self.desks, self.lanes, self.bands = desks, lanes, bands

    @property
    def seats(self):
        return len(self.desks)

    def report(self, name):
        print(f'  {name}: {len(self.bands)} 条带 × 平均 {len(self.desks)/max(1,len(self.bands)):.0f} 张'
              f' = {self.seats} 工位')


def _desks_of(band):
    """一条工位带 → 一张张桌子。和「排布」页上 seatsOf() 同一套算法。"""
    w, d = band.get('size', [1400, 700])
    x0, x1 = sorted(band['x']); y0, y1 = sorted(band['y'])
    out = []
    # 带够深＝背靠背两排；只有一张桌深＝单排（靠墙、靠茶水台那种）。
    # facing 记的是椅子在桌子的哪一侧：横带 N／S，竖带 W／E；单排带由 face 指定。
    if band.get('dir', 'h') == 'h':
        one = (y1 - y0) < d * 2 - 50
        y = y0
        while y + (d if one else d * 2) <= y1 + 50:
            x = x0
            while x + w <= x1 + 50:
                out.append(Desk(x, y, w, d, band.get('face', 'N') if one else 'N'))
                if not one:
                    out.append(Desk(x, y + d, w, d, 'S'))
                x += w
            y += (d if one else d * 2) + CHAIR_GAP
    else:
        one = (x1 - x0) < d * 2 - 50
        x = x0
        while x + (d if one else d * 2) <= x1 + 50:
            y = y0
            while y + w <= y1 + 50:
                out.append(Desk(x, y, d, w, band.get('face', 'W') if one else 'W'))
                if not one:
                    out.append(Desk(x + d, y, d, w, 'E'))
                y += w
            x += (d if one else d * 2) + CHAIR_GAP
    return out


def _spur(rooms):
    """南区房间之间最宽的那条竖缝当纵向支通道 —— 地面材质要按它铺。"""
    xs = sorted({r[0] for r in rooms} | {r[2] for r in rooms})
    best = None
    for i in range(len(xs) - 1):
        a, b = xs[i], xs[i + 1]
        if not (700 < b - a < 2600):
            continue
        if any(r[0] < b and r[2] > a for r in rooms):       # 缝里有房间，不算
            continue
        if best is None or b - a > best[1] - best[0]:
            best = (a, b)
    if not best:
        return (0, 0, 0, 0)
    return (best[0], SPINE_Y[1], best[1], S_ZONE[3])


def _side(room, others, spine, spur):
    """门开在哪一侧：往外 400 mm 取一点，不能落在别的房间里，再取离通道最近的那侧。"""
    x0, y0, x1, y1 = room
    cand = {'N': ((x0 + x1) / 2, y0 - 400), 'S': ((x0 + x1) / 2, y1 + 400),
            'W': (x0 - 400, (y0 + y1) / 2), 'E': (x1 + 400, (y0 + y1) / 2)}
    def blocked(p):
        return any(o[0] <= p[0] <= o[2] and o[1] <= p[1] <= o[3] for o in others)
    def dist(p, r):
        if r[2] <= r[0]:
            return 1e9
        dx = max(r[0] - p[0], 0, p[0] - r[2]); dy = max(r[1] - p[1], 0, p[1] - r[3])
        return (dx * dx + dy * dy) ** .5
    best, bs = None, 1e18
    for s, p in cand.items():
        sc = min(dist(p, spine), dist(p, spur)) + (1e6 if blocked(p) else 0)
        if sc < bs:
            best, bs = s, sc
    return best


DEMOLISHABLE = ['IT', '清扫间', '备餐间', '茶水间']


def keeps_of(demolish):
    """plan_model.KEEP 里拆掉 demolish 之后还剩下的那些房间。"""
    from plan_model import KEEP
    kill = set(demolish)
    out = []
    for r in KEEP:
        head = r[4].split('\n')[0].split(' →')[0].strip()
        if not any(head.startswith(k) for k in kill):
            out.append(r)
    return out


class Scheme:
    pass


def load(sid):
    f = os.path.join(ROOT, 'schemes', f'{sid}.json')
    j = json.load(open(f, encoding='utf-8'))
    S = Scheme()
    S.id, S.name = j.get('id', sid), j.get('name', sid)
    # 甲方点名可拆的四间（IT／清扫间／备餐间／茶水间）里，这一版实际拆掉了哪几间。
    # 拆了就不该再出现在白模里 —— 甲方自己的 PLAN A／B 就把洽谈室画在了 IT 上。
    S.DEMOLISH = list(j.get('demolish', []))
    S.KEEP = keeps_of(S.DEMOLISH)

    boxes = [(min(r['x']), min(r['y']), max(r['x']), max(r['y']), r['n']) for r in j['rooms']]
    spine = (S_ZONE[0], SPINE_Y[0], SPINE_X_END, SPINE_Y[1])
    S.SPUR = _spur([b[:4] for b in boxes])
    S.ROOMS = []
    for i, b in enumerate(boxes):
        others = [o[:4] for k, o in enumerate(boxes) if k != i]
        S.ROOMS.append((b[0], b[1], b[2], b[3], b[4], '', _side(b[:4], others, spine, S.SPUR)))

    desks, lanes, bands = [], [], []
    for band in j['desks']:
        d = _desks_of(band)
        desks += d
        bands.append((min(band['y']), max(band['y'])))
        lanes += sorted({k.x for k in d})
    S.NF = Bands(desks, sorted(set(lanes)), bands)
    S.DESK = tuple(j['desks'][0].get('size', [1400, 700])) if j['desks'] else (1400, 700)
    S.SVC = None                       # 方案文件里没有打印／储物块就不画
    S.door_of = lambda room: {'E': (room[2], (room[1]+room[3])/2),
                              'W': (room[0], (room[1]+room[3])/2),
                              'N': ((room[0]+room[2])/2, room[1]),
                              'S': ((room[0]+room[2])/2, room[3])}[room[6]]
    return S


if __name__ == '__main__':
    import sys
    for sid in (sys.argv[1:] or ['A', 'B']):
        S = load(sid)
        print(f'--- {sid}　{S.name} ---')
        print(f'  工位 {S.NF.seats} 个（{len(S.NF.bands)} 条带，桌 {S.DESK[0]}×{S.DESK[1]}）')
        print(f'  支通道 {S.SPUR}')
        for r in S.ROOMS:
            print(f'    {r[4]:8s} {r[2]-r[0]:5d} × {r[3]-r[1]:5d} = '
                  f'{(r[2]-r[0])*(r[3]-r[1])/1e6:5.1f} ㎡   门朝 {r[6]}')


# ---------------------------------------------------------------- 自动机位
# 原来的 6 个机位是照方案 D 的房间位置摆的。换成 PLAN A 之后，n_open 那个眼点
# 正好站在大会议室里，出来的白模左半张全是一堵墙。所以机位得跟着方案走。
#
# 评分用的是「排布」页上那套构图自检的分析版：太近的大面要扣分，画面里桌子太少
# 也要扣分 —— 只是这里不光栅化，直接算射线打到什么、视锥里有几张桌。
import math


def _blockers(S):
    """挡视线的东西：方案房间 ＋ 保留房间 ＋ 外墙。都当成轴对齐盒子。"""
    from plan_model import KEEP, SHELL
    out = [(r[0], r[1], r[2], r[3]) for r in S.ROOMS]
    out += [(k[0], k[1], k[2], k[3]) for k in KEEP]
    return out, SHELL


def _ray(x, y, ang, boxes, shell, far=32000, step=250):
    """从 (x,y) 朝 ang 走，第一次撞到盒子或外墙就停，返回走了多远。"""
    dx, dy = math.cos(ang), math.sin(ang)
    d = step
    while d < far:
        px, py = x + dx * d, y + dy * d
        if not (shell['x0'] < px < shell['x1'] and shell['y0'] < py < shell['y1']):
            return d
        for b in boxes:
            if b[0] <= px <= b[2] and b[1] <= py <= b[3]:
                return d
        d += step
    return far


# 模型里 +X＝东、+Y＝南
_C8 = ['东', '东南', '南', '西南', '西', '西北', '北', '东北']


def _name(x, y, a):
    """给自动机位起个人能读的名字：站在哪一段、朝哪儿看。"""
    from plan_model import SHELL
    zone = '北区' if y < 10049 else ('主通道' if y < 11849 else '南区')
    fx = (x - SHELL['x0']) / (SHELL['x1'] - SHELL['x0'])
    ew = '西端' if fx < 0.34 else ('东端' if fx > 0.66 else '中部')
    d = _C8[round((((a * 180 / math.pi) % 360 + 360) % 360) / 45) % 8]
    return f'{zone}·{ew}{d}望'


def auto_views(S, n=6, eye_z=1550, lens=22, fov=math.radians(58)):
    from plan_model import N_ZONE, S_ZONE
    boxes, shell = _blockers(S)
    desks = [(d.x + d.w / 2, d.y + d.d / 2) for d in S.NF.desks]
    cands = []
    for zx0, zy0, zx1, zy1 in (N_ZONE, S_ZONE):
        for x in range(int(zx0) + 900, int(zx1) - 900, 1200):
            for y in range(int(zy0) + 900, int(zy1) - 900, 1200):
                if any(b[0] - 300 <= x <= b[2] + 300 and b[1] - 300 <= y <= b[3] + 300
                       for b in boxes):
                    continue                                  # 站在房间里／贴着墙
                for k in range(12):
                    a = 2 * math.pi * k / 12
                    depth = _ray(x, y, a, boxes, shell)
                    if depth < 3500:
                        continue                              # 一抬头就是墙
                    # 视锥里 14 m 以内有几张桌
                    seen = 0
                    for dx_, dy_ in desks:
                        vx, vy = dx_ - x, dy_ - y
                        r = math.hypot(vx, vy)
                        if r < 800 or r > 14000:
                            continue
                        if abs(math.atan2(vy, vx) - a) % (2 * math.pi) < fov / 2 or \
                           abs(abs(math.atan2(vy, vx) - a) - 2 * math.pi) < fov / 2:
                            seen += 1
                    if seen < 4:
                        continue
                    cands.append((seen + depth / 4000, x, y, a, depth, seen))
    cands.sort(reverse=True)
    out, used = {}, []
    for sc, x, y, a, depth, seen in cands:
        if any(math.hypot(x - ux, y - uy) < 5000 and abs(a - ua) < 1.0 for ux, uy, ua in used):
            continue                                          # 和已选的机位太像
        used.append((x, y, a))
        i = len(out) + 1
        at = (x + math.cos(a) * depth * .9, y + math.sin(a) * depth * .9, 1150)
        out[f'v{i:02d}'] = ((x, y, eye_z), (round(at[0]), round(at[1]), at[2]), lens, _name(x, y, a))
        if len(out) >= n:
            break
    return out
