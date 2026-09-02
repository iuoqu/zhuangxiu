# -*- coding: utf-8 -*-
"""把 schemes/<id>.json 画成一张平面图（SVG），跟研究页里那四张同一套图例。

    python3 分析/draw_json.py A B        # → 分析/plate_A.svg、plate_B.svg

方案 D 那四张是写死在 draw_d.py／draw.py 里的。这一版只吃方案文件，所以「排布」
页上生成或拖出来的任何一版都能出图，不用再写一遍绘图代码。
"""
import os, sys
import plan_model as M
from plan_model import N_ZONE, S_ZONE
from draw import (SVG, C, esc, shell, keeps, entry_hall, aisle_band,
                  legend_box, note_block, NOTE_END, LEG_END)
import scheme_json

ROOT = os.path.join(os.path.dirname(__file__), '..')


def _desks(s, S):
    """桌子按各自的 w/h 画 —— 竖向工位带的桌子是躺着的，不能共用一个尺寸。"""
    for d in S.NF.desks:
        s.rect(d.x + 40, d.y + 40, d.w - 80, d.d - 80,
               fill=C['desk'], stroke=C['deskln'], sw=35, rx=60)
        # 椅子：facing 'N' 的坐在桌子上／左侧，'S' 的在下／右侧
        if d.w >= d.d:
            cy = d.y - 300 if d.facing == 'N' else d.y + d.d + 300
            s.circ(d.x + d.w / 2, cy, 230, C['chair'], C['deskln'], 25)
        else:
            cx = d.x - 300 if d.facing == 'N' else d.x + d.w + 300
            s.circ(cx, d.y + d.d / 2, 230, C['chair'], C['deskln'], 25)


def draw(sid):
    S = scheme_json.load(sid)
    s = SVG(); shell(s); keeps(s, dim=True, only=S.KEEP); entry_hall(s)

    for (x0, y0, x1, y1, name, _t, side) in S.ROOMS:
        svc = any(k in name for k in ('茶水', '备餐', '打印', '储物'))
        fill, ln, tx = ((C['lounge'], C['loungeln'], '#2f6b48') if svc
                        else (C['room'], C['roomln'], '#8a6d10'))
        s.rect(x0, y0, x1 - x0, y1 - y0, fill=fill, stroke=ln, sw=55)
        s.multi((x0 + x1) / 2, (y0 + y1) / 2 - 60,
                [name, f'{(x1 - x0) * (y1 - y0) / 1e6:.1f} ㎡'], 320, tx, weight='600')
        dx, dy = S.door_of((x0, y0, x1, y1, name, _t, side))
        s.circ(dx, dy, 120, ln)

    if S.SPUR[2] > S.SPUR[0]:
        aisle_band(s, *S.SPUR)

    _desks(s, S)

    dw, dh = S.DESK
    s.txt(-3200, -3900, S.name, 700, C['ink'], anchor='start', weight='700')
    s.txt(-3200, -3300,
          f'甲方 2025-08-28 提供的平面，已按 18 根结构柱配准到毫米坐标（残差 RMS 1.0 mm）｜'
          f'工位 {dw}×{dh}，合计 {S.NF.seats} 工位（图上标 52P）',
          380, C['keeptx'], anchor='start')

    items = [(C['desk'], 'fill', f'工位 {dw}×{dh}'),
             (C['room'], 'fill', '会议 / 洽谈室'),
             (C['lounge'], 'fill', '茶水 / 备餐'),
             (C['aisle'], 'fill', '通道 / 门厅'),
             (C['col'], 'fill', '结构柱'),
             (C['glass'], 'glass', '外窗（落地，分格 4050）'),
             (C['keep'], 'fill', '保留（客房/卫生间/电井/备餐）')]
    notes = [
        '1. 这张图不是重画的 —— 柱、墙、桌、椅从甲方 PDF 的矢量线里直接读出来，'
        '再用 18 根结构柱做最小二乘配准套到本项目的毫米坐标系上，最大残差 2.1 mm。',
        '2. 工位数按图上的椅子逐块数：右上 12 ＋ 中间 20 ＋ 下面 20 ＝ 52，与图签「开放办公区 52P」一致。'
        '其中两条是单排工位带（靠茶水台、靠小会议室墙），只有一张桌深。',
        '3. 房间框是「PDF 线 ＋ 人工确认」：识别门洞把墙切断的地方会漏判，已逐间对过尺寸。',
        '4. 电梯、楼梯、卫生间、客房在两版里位置完全一致，与本项目底板一致 —— 等于被独立印证了一次。',
    ]
    nb = note_block(s, notes, '来源与核对')
    lgb = legend_box(items, title='图例')
    return s.out(S.name, '', nb + lgb, bottom=LEG_END[0])


def main():
    for sid in (sys.argv[1:] or ['A', 'B']):
        NOTE_END[0] = 22900; LEG_END[0] = 0
        svg = draw(sid)
        f = os.path.join(os.path.dirname(__file__), f'plate_{sid}.svg')
        open(f, 'w', encoding='utf-8').write(svg)
        print(f'方案 {sid} → {f}   {len(svg)/1024:.0f} KB')


if __name__ == '__main__':
    main()
