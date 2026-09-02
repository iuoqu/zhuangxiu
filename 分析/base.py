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
# 保留但理论上可动的（PLAN A／B 没动，先归到底板，方案文件里可以覆盖）
KEPT = ['IT', '清扫间', '备餐间', '茶水间']


def bucket(label):
    head = label.split('\n')[0].split(' →')[0].strip()
    for k in FIXED:
        if head.startswith(k):
            return 'fixed'
    for k in KEPT:
        if head.startswith(k):
            return 'kept'
    return 'kept'


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
        'rooms': rooms,
        'entry': {'n': M.ENTRY[4].split(' /')[0], 'x': [M.ENTRY[0], M.ENTRY[2]],
                  'y': [M.ENTRY[1], M.ENTRY[3]], 'lock': 'kept'},
        # 可变区：北区（原活动休闲区）＋南区（原宿舍），排布只在这两块里发生
        'free': [{'n': '北区', 'x': [M.N_ZONE[0], M.N_ZONE[2]], 'y': [M.N_ZONE[1], M.N_ZONE[3]]},
                 {'n': '南区', 'x': [M.S_ZONE[0], M.S_ZONE[2]], 'y': [M.S_ZONE[1], M.S_ZONE[3]]}],
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
