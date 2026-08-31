# -*- coding: utf-8 -*-
"""按净尺寸反算每间会议 / 洽谈室能放的桌子与座位数。

取值（常规办公做法）：
  端部净距 1200（端头有人坐时）、侧向净距 1200（椅子拉开 + 可通行；下限 900）
  沿桌长方向每人 750
  长条桌宽 1400~1800，端头坐人需 ≥1400
"""
import math

END, SIDE, PITCH = 1200, 1200, 750
SIDE_MIN = 900


def long_table(L, W, side=SIDE):
    """房间净 L(桌长方向) × W(桌宽方向) → (桌长, 桌宽, 座位数)"""
    tl = L - 2 * END
    tw = W - 2 * side
    if tl <= 0 or tw <= 0:
        return None
    tw = min(1800, max(900, math.floor(tw / 100) * 100))
    if tw > W - 2 * side:
        return None
    n_side = int(tl // PITCH)
    n_end = 2 if tw >= 1400 else 0
    return (int(tl), int(tw), 2 * n_side + n_end, n_side, n_end)


def best(w, h, name=''):
    """两个朝向都试，取座位多的。"""
    out = []
    for L, W, o in ((h, w, '桌长沿进深'), (w, h, '桌长沿面宽')):
        for side in (SIDE, SIDE_MIN):
            r = long_table(L, W, side)
            if r:
                out.append((r[2], r, o, side))
        # 只在 1200 放不下时才退到 900
        if any(x[3] == SIDE for x in out):
            out = [x for x in out if x[3] == SIDE]
    if not out:
        return None
    out.sort(key=lambda x: (-x[0], x[3]))
    n, r, o, side = out[0]
    return dict(seats=n, tl=r[0], tw=r[1], per_side=r[3], ends=r[4], orient=o, side=side)


if __name__ == '__main__':
    import scheme_d as D
    print(f'{"房间":<10}{"净尺寸 (mm)":<16}{"面积":>7}   {"长条桌":<14}{"座位":<22}{"侧向净距"}')
    print('-' * 92)
    for (x0, y0, x1, y1, name, cap, door) in D.ROOMS:
        w, h = x1 - x0, y1 - y0
        a = w * h / 1e6
        b = best(w, h, name)
        if b and '洽谈' not in name and '茶水' not in name:
            t = f'{b["tl"]}×{b["tw"]}'
            s = f'{b["per_side"]}+{b["per_side"]}+{b["ends"]} = {b["seats"]} 人'
            print(f'{name:<10}{w:.0f} × {h:.0f}{"":<5}{a:>6.1f}㎡   {t:<14}{s:<22}{b["side"]}')
        else:
            print(f'{name:<10}{w:.0f} × {h:.0f}{"":<5}{a:>6.1f}㎡   {"—":<14}{cap:<22}')
    print()
    print('对照 3 楼大会议室（实测）：房间约 6950 × 5100，桌 5500 × 1450，7+7+2 = 16 人，另贴窗 7 个旁听席')
    print()
    print('若把大会议室改成长条比例：')
    for w, h in [(7900, 4500), (8400, 4600), (8400, 5000), (9000, 4400)]:
        b = best(w, h)
        print(f'   {w} × {h} = {w*h/1e6:.1f}㎡   桌 {b["tl"]}×{b["tw"]}   '
              f'{b["per_side"]}+{b["per_side"]}+{b["ends"]} = {b["seats"]} 人')
