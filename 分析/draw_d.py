# -*- coding: utf-8 -*-
"""方案 D 平面图。"""
import math
import plan_model as M
from plan_model import N_ZONE, S_ZONE, AXIS_X, AXIS_Y
from schemes import SPINE_X, SPINE_Y, SPINE_X_END, TOTAL
from draw import (SVG, C, FONT, esc, shell, keeps, entry_hall, aisle_band, desks,
                  legend_box, note_block, NOTE_END, LEG_END)
import scheme_d as D


def draw():
    s = SVG(); shell(s); keeps(s, dim=True); entry_hall(s)
    nf = D.NF; HEAD = D.HEAD

    # ---------- 循环体系 ----------
    aisle_band(s, N_ZONE[0], N_ZONE[1], SPINE_X[1], N_ZONE[1] + HEAD)
    s.txt(SPINE_X[0] - 250, N_ZONE[1] + HEAD - 110, f'北向采光通廊 {HEAD} —— 主横向通道',
          320, C['keeptx'], anchor='end', weight='500')
    aisle_band(s, SPINE_X[0], N_ZONE[1], SPINE_X[1], N_ZONE[3])
    s.txt((SPINE_X[0]+SPINE_X[1])/2, 6800, '入口纵向通道 1800', 300, C['keeptx'], weight='500', rot=-90)
    aisle_band(s, S_ZONE[0], SPINE_Y[0], SPINE_X_END, SPINE_Y[1], '南区主通道 1800')
    # 北区纵向次通道
    cx = (nf.lanes[4] + nf.desk_w, nf.lanes[5])
    aisle_band(s, cx[0], N_ZONE[1] + HEAD, cx[1], SPINE_Y[1])
    s.txt((cx[0]+cx[1])/2, 6300, f'纵向次通道 {cx[1]-cx[0]:.0f}', 290, C['keeptx'], weight='500', rot=-90)
    # 南区纵向支通道
    aisle_band(s, *D.SPUR)
    s.txt((D.SPUR[0]+D.SPUR[2])/2, 17400, '纵向支通道 1400', 290, C['keeptx'], weight='500', rot=-90)
    # ②轴柱
    s.rect(8830, 9979, 740, 840, fill='none', stroke=C['hi'], sw=45, dash='180,120')

    # ---------- 北区 ----------
    desks(s, nf)
    x0, y0, x1, y1 = D.SVC
    s.rect(x0, y0, x1-x0, y1-y0, fill=C['lounge'], stroke=C['loungeln'], sw=45)
    s.multi((x0+x1)/2, (y0+y1)/2 - 320, ['打印 / 储物', '电话亭 ×2', f'{(x1-x0)*(y1-y0)/1e6:.1f} ㎡'],
            300, '#2f6b48', weight='600')

    # ---------- 南区房间 ----------
    for (rx0, ry0, rx1, ry1, name, cap, door) in D.ROOMS:
        big = '会议室' in name
        fill = C['room'] if big or '洽谈' in name else C['lounge']
        line = C['roomln'] if fill == C['room'] else C['loungeln']
        txt = '#8a6d10' if fill == C['room'] else '#2f6b48'
        s.rect(rx0, ry0, rx1-rx0, ry1-ry0, fill=fill, stroke=line, sw=55)
        a = (rx1-rx0)*(ry1-ry0)/1e6
        sz = 340 if big else 285
        parts = cap.split('　')
        lines = [name, f'{a:.1f} ㎡'] + parts
        s.multi((rx0+rx1)/2, (ry0+ry1)/2 - (len(lines)-1)*sz*0.62, lines, sz, txt, weight='600')
        # 门位示意
        dx, dy = {'E': (rx1, (ry0+ry1)/2), 'W': (rx0, (ry0+ry1)/2),
                  'N': ((rx0+rx1)/2, ry0)}[door]
        s.circ(dx, dy, 130, line)

    # ---------- 分区标题 ----------
    s.txt(nf.x0 + (SPINE_X[0]-nf.x0)/2, -780,
          f'北区 · 全部 {nf.seats} 个工位（北向 + 西向采光）　4 排 × 9 列 ＋ 2 排 × 7 列',
          430, C['ink'], weight='700')
    s.txt(S_ZONE[0] + (S_ZONE[2]-S_ZONE[0])/2, 22400,
          '南区 · 会议 / 洽谈 / 茶水（内区，无外窗需求的功能全部落位于此）',
          430, C['ink'], weight='700')

    # ---------- 模数标注 ----------
    dw, dd = D.DESK
    bx, by, y2 = nf.lanes[0], nf.bands[0][0], nf.bands[0][1]
    s.line(bx, by-420, bx+dw, by-420, C['hi'], 35)
    s.line(bx, by-520, bx, by-320, C['hi'], 35); s.line(bx+dw, by-520, bx+dw, by-320, C['hi'], 35)
    s.txt(bx+dw/2, by-560, f'{dw}', 290, C['hi'], weight='600')
    mx = (cx[0]+cx[1])/2 - 240
    s.line(mx, by, mx, y2, C['hi'], 45)
    s.txt(mx+210, (by+y2)/2, f'背靠背 {2*dd}', 290, C['hi'], weight='600', rot=-90)
    s.line(mx, y2, mx, y2+D.CHAIR, C['dim'], 45)
    s.txt(mx+210, y2+D.CHAIR/2, f'座椅+通行 {D.CHAIR}', 280, C['dim'], rot=-90)

    # ---------- 疏散路径（最不利点＝西南角洽谈间 A） ----------
    ax = (D.SPUR[0]+D.SPUR[2])/2
    py = N_ZONE[1] + HEAD/2
    px = [(1500, 20450), (6900, 20450), (6900, 19799), (ax, 19799), (ax, SPINE_Y[0]+900), ((cx[0]+cx[1])/2, SPINE_Y[0]+900),
          ((cx[0]+cx[1])/2, py), (17200, py), (17200, 2600), (21500, 2600), (21500, 4200)]
    s.add('<polyline points="' + ' '.join(f'{a:.0f},{b:.0f}' for a, b in px) +
          f'" fill="none" stroke="{C["demo"]}" stroke-width="90" stroke-dasharray="420,240" '
          'stroke-linejoin="round" opacity="0.75"/>')
    s.circ(1500, 20450, 220, C['demo'])
    s.txt(1850, 20570, '最不利房间', 290, C['demo'], anchor='start', weight='600')
    s.txt(21500, 5400, '→ 安全出口 1', 300, C['demo'], anchor='middle', weight='600')

    # ---------- 标题与说明 ----------
    s.txt(-3200, -3900, '方案 D · 50 工位 ＋ 完整会议配套', 700, C['ink'], anchor='start', weight='700')
    s.txt(-3200, -3300,
          f'工位 {dw}×{dd}，背靠背带宽 {2*dd}，座椅+通行区 {D.CHAIR}，采光通廊 {HEAD}，主通道 1800 ｜ '
          f'{nf.seats} 工位 ＋ 大会议室 31.3㎡/14人 ＋ 中会议室 25.7㎡/12人 ＋ 洽谈间 ×4（4人×3＋6人×1）＋ 茶水区 16.4㎡',
          380, C['keeptx'], anchor='start')

    notes = [
        f'1. 分区原则：北区是全层唯一有天然采光的区（北立面满玻 16.2 m ＋ 西立面 6.27 m），'
        f'{nf.seats} 个工位全部落在北区，每个工位都见光；南区为无外窗内区，会议、洽谈、茶水这些不需要外窗的功能全部落位于此。',
        '2. 循环体系：北向采光通廊 1200（主横向）＋ 入口纵向通道 1800 ＋ 北区纵向次通道 1200 '
        '＋ 南区主通道 1800 ＋ 南区纵向支通道 1400。四间小洽谈贴南区主通道一字排开、门直接开到主通道；'
        '大 / 中会议室与茶水区退到南侧安静端，门开到纵向支通道。整个南区只用这一条 1.4 m 支通道，'
        '每个房间都有直接入口，不再另设走道。',
        '3. 疏散：北区开敞办公区最不利点（西北角）至办公区疏散门直线距离 ≈ 19.9 m；'
        '各房间门至疏散门 11.4~20.2 m（最不利为茶水区 20.2 m），室内任一点至本房间门 ≤ 6.7 m。'
        '均明显低于喷淋保护下限值 27.5 m，也比方案 B 的 25.2 m 宽松 —— '
        '因为原来最深的西南角现在是有独立疏散门的房间，而不是开敞办公区。仍须由消防设计单位复核防烟分区与排烟方式。',
        '4. 四间洽谈紧贴主通道，从工位区跨过通道即到，适合随时发起的短会；'
        '大 / 中会议室在南侧尽端，与工位区隔一条通道，安静且不穿行。',
        '5. 纵向支通道设在 X 7400~8800（偏东），是为了让西块留出 7.45 m 的连续长度 —— '
        '长条谈判桌需要的是长度而不是面积，房间做方了桌子反而放不长。',
        '6. 茶水区紧贴保留的备餐间 / 茶水间（既有给排水点位），可就近接水，避免长距离排水；'
        '打通 X=12751 处一道墙即可与保留茶水间 23 ㎡ 合并为约 37 ㎡ 的完整茶水区，并占据南向采光段。',
        '8. 第 3 条工位带在东端让出 2 列（3.0 × 2.5 m）作打印 / 储物 / 电话亭 ×2，'
        f'这也是本方案工位数落在 {nf.seats} 而不是 54 的原因。',
        '7. 大会议室 5.9 × 6.5 m 可放 4.8 × 1.6 m 会议桌（18–20 人）；中会议室 5.5 × 3.8 m 放 2.4 × 1.2 m 桌（8–10 人）；'
        '洽谈间 2.7~2.9 × 2.45 m 放 Ø900 圆桌 ＋ 4 椅。',
    ]
    nb = note_block(s, notes, '设计说明')
    items = [(C['desk'], 'fill', f'工位 {dw}×{dd}'), (C['room'], 'fill', '会议室 / 洽谈间'),
             (C['lounge'], 'fill', '茶水区 / 打印储物'), (C['aisle'], 'fill', '主通道 / 采光通廊 / 门厅'),
             (C['col'], 'fill', '结构柱'), (C['glass'], 'glass', '外窗'),
             (C['keep'], 'fill', '保留（茶水间/客房/卫生间/电井）'), (C['demo'], 'dash', '最不利点疏散路径')]
    lgb = legend_box(items, title='图例')
    return s.out('方案 D · 50 工位 ＋ 完整会议配套', '', nb + lgb, bottom=LEG_END[0])


if __name__ == '__main__':
    open('4F_05_方案D.svg', 'w', encoding='utf-8').write(draw())
    print('wrote 4F_05_方案D.svg')
