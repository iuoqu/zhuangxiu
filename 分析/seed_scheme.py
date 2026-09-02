# -*- coding: utf-8 -*-
"""把 PDF 导入的结果整理成「方案文件」草稿。

方案文件只描述可变区里放了什么 —— 底板（结构、幕墙、电梯、楼梯、厕所、客房）
在 models/base.json 里，任何方案都不碰。所以一版方案就是几十行 JSON。

    python3 分析/seed_scheme.py     →  schemes/A.json、schemes/B.json
"""
import json, os, sys

D = os.path.dirname(__file__)
BASE = json.load(open(os.path.join(D, '..', 'models', 'base.json'), encoding='utf-8'))
FIXED = {r['n'].split(' ')[0] for r in BASE['rooms']} | {BASE['entry']['n'].split(' ')[0]}


def merge(boxes, gap=200):
    """把相邻的 1400×1400 工位模块并成一条条工位带。

    PDF 里一个模块画一次，24 个散着放在方案文件里既难改也数不出工位 ——
    并成带之后，一条带就是「这一片放工位」，拖一下就能改整片。
    """
    rs = [[b['x'] - b['w'] / 2, b['y'] - b['h'] / 2, b['x'] + b['w'] / 2, b['y'] + b['h'] / 2]
          for b in boxes]
    changed = True
    while changed:
        changed = False
        for i in range(len(rs)):
            for j in range(i + 1, len(rs)):
                a, b = rs[i], rs[j]
                # 竖直方向贴着（X 基本重合）或水平方向贴着（Y 基本重合）就并
                sameX = abs(a[0]-b[0]) < gap and abs(a[2]-b[2]) < gap
                sameY = abs(a[1]-b[1]) < gap and abs(a[3]-b[3]) < gap
                touchY = min(a[3], b[3]) + gap >= max(a[1], b[1])
                touchX = min(a[2], b[2]) + gap >= max(a[0], b[0])
                if (sameX and touchY) or (sameY and touchX):
                    rs[i] = [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]
                    rs.pop(j); changed = True; break
            if changed:
                break
    # 图上就是 1400×700 —— 一个 1400×1400 的模块＝两张背靠背的桌子
    return [{'x': [round(r[0]), round(r[2])], 'y': [round(r[1]), round(r[3])],
             'size': [1400, 700], 'dir': 'h' if (r[2]-r[0]) >= (r[3]-r[1]) else 'v'} for r in rs]


def main():
    os.makedirs(os.path.join(D, '..', 'schemes'), exist_ok=True)
    for t, nm in (('A', 'PLAN A'), ('B', 'PLAN B')):
        d = json.load(open(os.path.join(D, f'plan_{t}.json'), encoding='utf-8'))
        rooms = [{'n': b['name'], 'x': [b['x0'], b['x1']], 'y': [b['y0'], b['y1']]}
                 for b in d['boxes']
                 if not any(b['name'].startswith(f) for f in FIXED)
                 and not b['name'].startswith('开放办公区')]
        bands = merge(d['desks'])
        out = {'id': t, 'name': f'{nm} · 甲方 0828', 'from': '4F 平面方案0828.pdf',
               'note': '从 PDF 导进来的草稿，位置在「排布」页上拖着改',
               'rooms': rooms, 'desks': bands}
        f = os.path.join(D, '..', 'schemes', f'{t}.json')
        json.dump(out, open(f, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print(f'schemes/{t}.json　房间 {len(rooms)} 间　工位带 {len(bands)} 条'
              f'（原始 {len(d["desks"])} 个模块并起来的）')
        for b in bands:
            print(f'    带 {b["x"][1]-b["x"][0]:6d} × {b["y"][1]-b["y"][0]:6d}  {b["dir"]}')


if __name__ == '__main__':
    main()
