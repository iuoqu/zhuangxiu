# -*- coding: utf-8 -*-
"""生成 4F 现状分析图与三个方案平面图 (SVG)。单位 mm，1mm = 1 用户单位。"""
import plan_model as M
from plan_model import COLS, GLAZ_N, GLAZ_W, GLAZ_S, KEEP, ENTRY, N_ZONE, S_ZONE, DEMO_WALLS, AXIS_X, AXIS_Y
from schemes import SCHEMES, SPINE_X, SPINE_Y, SPINE_X_END, TOTAL

FONT = "'Noto Sans SC','Source Han Sans SC','PingFang SC','Microsoft YaHei','Hiragino Sans GB',sans-serif"
VB = (-3400, -4600, 33200, 34300)          # x, y, w, h

C = dict(paper='#ffffff', ink='#1c2024', wall='#2b3138', col='#4a5560',
         glass='#2f7fd4', keep='#eceff2', keepln='#aab4bd', keeptx='#6b7680',
         demo='#d2544a', aisle='#f4f7fa', aisleln='#c3ccd6',
         desk='#ffffff', deskln='#3d4650', chair='#8d99a6',
         room='#fdf5e6', roomln='#c9a227', lounge='#eaf5ec', loungeln='#4f9d69',
         dim='#8a949e', hi='#1f6feb')

def esc(s): return s.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')

class SVG:
    def __init__(self): self.o = []
    def add(self, s): self.o.append(s)
    def rect(self, x, y, w, h, fill='none', stroke='none', sw=20, dash=None, rx=0, op=1):
        d = f' stroke-dasharray="{dash}"' if dash else ''
        r = f' rx="{rx}"' if rx else ''
        self.add(f'<rect x="{x:.0f}" y="{y:.0f}" width="{w:.0f}" height="{h:.0f}" '
                 f'fill="{fill}" fill-opacity="{op}" stroke="{stroke}" stroke-width="{sw}"{d}{r}/>')
    def line(self, x1, y1, x2, y2, stroke='#000', sw=20, dash=None, cap='butt'):
        d = f' stroke-dasharray="{dash}"' if dash else ''
        self.add(f'<line x1="{x1:.0f}" y1="{y1:.0f}" x2="{x2:.0f}" y2="{y2:.0f}" '
                 f'stroke="{stroke}" stroke-width="{sw}" stroke-linecap="{cap}"{d}/>')
    def circ(self, cx, cy, r, fill='none', stroke='none', sw=20):
        self.add(f'<circle cx="{cx:.0f}" cy="{cy:.0f}" r="{r:.0f}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>')
    def txt(self, x, y, s, size=300, fill='#1c2024', anchor='middle', weight='400', rot=0, op=1):
        t = f' transform="rotate({rot} {x:.0f} {y:.0f})"' if rot else ''
        self.add(f'<text x="{x:.0f}" y="{y:.0f}" font-family="{FONT}" font-size="{size}" '
                 f'fill="{fill}" fill-opacity="{op}" text-anchor="{anchor}" font-weight="{weight}"{t}>{esc(s)}</text>')
    def multi(self, x, y, lines, size=300, fill='#1c2024', anchor='middle', weight='400', lh=1.25):
        for i, ln in enumerate(lines):
            self.txt(x, y + i * size * lh, ln, size, fill, anchor, weight)
    def out(self, title, sub, legend, bottom=None):
        h = VB[3] if bottom is None else max(VB[3], bottom - VB[1] + 900)
        head = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{VB[0]} {VB[1]} {VB[2]} {h:.0f}" '
                f'width="100%" role="img" aria-label="{esc(title)}">'
                f'<rect x="{VB[0]}" y="{VB[1]}" width="{VB[2]}" height="{h:.0f}" fill="{C["paper"]}"/>')
        return head + ''.join(self.o) + legend + '</svg>'

# ---------------- 底图 ----------------
def shell(s, show_axes=True):
    sh = M.SHELL
    # 楼板轮廓
    s.rect(sh['x0'], sh['y0'], sh['x1']-sh['x0'], sh['y1']-sh['y0'], fill='none', stroke=C['wall'], sw=70)
    # 外墙实体段（北 / 西 / 南 无玻璃处画粗实线已由轮廓表达）；玻璃用蓝色双线
    for a, b in GLAZ_N:
        s.line(a, 100, b, 100, C['glass'], 55); s.line(a, 300, b, 300, C['glass'], 55)
    for a, b in GLAZ_W:
        s.line(60, a, 60, b, C['glass'], 55); s.line(260, a, 260, b, C['glass'], 55)
    for a, b in GLAZ_S:
        s.line(a, 20899, b, 20899, C['glass'], 55); s.line(a, 21050, b, 21050, C['glass'], 55)
    # 结构柱
    for (x, y, w, h) in COLS:
        s.rect(x, y, w, h, fill=C['col'], stroke=C['wall'], sw=25)
    if show_axes:
        for k, x in AXIS_X.items():
            s.line(x, -2100, x, 21600, C['dim'], 18, dash='260,90,40,90')
            s.circ(x, -2450, 300, C['paper'], C['dim'], 30); s.txt(x, -2340, k, 330, C['dim'])
        for k, y in AXIS_Y.items():
            s.line(-2100, y, 28400, y, C['dim'], 18, dash='260,90,40,90')
            s.circ(-2450, y, 300, C['paper'], C['dim'], 30); s.txt(-2450, y+110, k, 330, C['dim'])
        # 轴距标注
        for a, b in [(0,9200),(9200,18400),(18400,27600)]:
            s.line(a, -1500, b, -1500, C['dim'], 18)
            s.txt((a+b)/2, -1620, '9200', 300, C['dim'])
        for a, b in [(0,6300),(6300,10400),(10400,20800)]:
            s.line(-1500, a, -1500, b, C['dim'], 18)
            s.txt(-1620, (a+b)/2, str(b-a), 300, C['dim'], rot=-90)

def keeps(s, dim=False):
    op = .55 if dim else 1
    for (x0, y0, x1, y1, lab) in KEEP:
        s.rect(x0, y0, x1-x0, y1-y0, fill=C['keep'], stroke=C['keepln'], sw=40, op=op)
        ls = lab.split('\n')
        s.multi((x0+x1)/2, (y0+y1)/2 - (len(ls)-1)*140, ls, 290, C['keeptx'], weight='500')

def entry_hall(s, label='入口门厅 / 前台'):
    x0, y0, x1, y1, _ = ENTRY
    s.rect(x0, y0, x1-x0, y1-y0, fill=C['aisle'], stroke=C['aisleln'], sw=40, dash='200,120')
    s.multi((x0+x1)/2, (y0+y1)/2-140, [label, '16 ㎡'], 300, C['keeptx'], weight='500')
    s.txt(27500, 10800, '▲ 安全出口 2（消防楼梯）', 300, C['hi'], anchor='end', weight='600')

def aisle_band(s, x0, y0, x1, y1, label=None, size=300):
    s.rect(x0, y0, x1-x0, y1-y0, fill=C['aisle'], stroke=C['aisleln'], sw=35, dash='240,140')
    if label: s.txt((x0+x1)/2, (y0+y1)/2+100, label, size, C['keeptx'], weight='500')

def desks(s, field, tag=''):
    dw, dd = field.desk_w, field.desk_d
    for d in field.desks:
        s.rect(d.x+40, d.y+40, dw-80, dd-80, fill=C['desk'], stroke=C['deskln'], sw=35, rx=60)
        cy = d.y - 300 if d.facing == 'N' else d.y + dd + 300
        s.circ(d.x + dw/2, cy, 230, C['chair'], C['deskln'], 25)

def legend_box(items, x=-3200, y=None, cols=4, w=8100, title=None):
    """items: (color, kind, label) kind in fill|line|dash|glass"""
    if y is None: y = NOTE_END[0] + 700
    LEG_END[0] = y + 500
    o = [f'<g>']
    if title:
        o.append(f'<text x="{x+60}" y="{y-260}" font-family="{FONT}" font-size="360" '
                 f'font-weight="700" fill="{C["ink"]}">{esc(title)}</text>')
    for i, (col, kind, lab) in enumerate(items):
        cx = x + (i % cols) * w; cy = y + (i // cols) * 900
        if kind == 'fill':
            o.append(f'<rect x="{cx+60}" y="{cy}" width="640" height="440" fill="{col}" stroke="{C["deskln"]}" stroke-width="30" rx="50"/>')
        elif kind == 'dash':
            o.append(f'<line x1="{cx+60}" y1="{cy+220}" x2="{cx+700}" y2="{cy+220}" stroke="{col}" stroke-width="70" stroke-dasharray="200,140"/>')
        elif kind == 'glass':
            o.append(f'<line x1="{cx+60}" y1="{cy+120}" x2="{cx+700}" y2="{cy+120}" stroke="{col}" stroke-width="60"/>'
                     f'<line x1="{cx+60}" y1="{cy+320}" x2="{cx+700}" y2="{cy+320}" stroke="{col}" stroke-width="60"/>')
        else:
            o.append(f'<line x1="{cx+60}" y1="{cy+220}" x2="{cx+700}" y2="{cy+220}" stroke="{col}" stroke-width="90"/>')
        o.append(f'<text x="{cx+880}" y="{cy+330}" font-family="{FONT}" font-size="340" fill="{C["ink"]}">{esc(lab)}</text>')
        LEG_END[0] = max(LEG_END[0], cy + 500)
    return ''.join(o) + '</g>'


def wrap_note(t, budget=94.0):
    """按 CJK=1 / ASCII=0.5 的宽度预算折行，避免图注超出图幅。"""
    lines, cur, w = [], '', 0.0
    for ch in t:
        cw = 0.5 if ord(ch) < 0x2E80 else 1.0
        if w + cw > budget and ch not in '，。；：、）】':
            lines.append(cur); cur, w = '', 0.0
        cur += ch; w += cw
    if cur: lines.append(cur)
    return lines


NOTE_END = [22900]
LEG_END = [0]


def note_block(s, notes, title, y0=22900, size=330, lh=560):
    o = ['<g>', f'<text x="-3140" y="{y0}" font-family="{FONT}" font-size="360" font-weight="700" '
         f'fill="{C["ink"]}">{esc(title)}</text>']
    y = y0 + 600
    for t in notes:
        for i, ln in enumerate(wrap_note(t)):
            o.append(f'<text x="{-3140 + (280 if i else 0)}" y="{y}" font-family="{FONT}" '
                     f'font-size="{size}" fill="{C["keeptx"]}">{esc(ln)}</text>')
            y += lh
        y += 120
    o.append('</g>')
    NOTE_END[0] = y
    return ''.join(o)


# ==================== 图 1：现状 + 拆除范围 ====================
def draw_existing():
    s = SVG(); shell(s); keeps(s)
    x0, y0, x1, y1 = ENTRY[:4]
    s.rect(x0, y0, x1-x0, y1-y0, fill=C['keep'], stroke=C['keepln'], sw=40)
    s.multi((x0+x1)/2, (y0+y1)/2-140, ['入口门厅', '（保留）'], 290, C['keeptx'], weight='500')

    for name, rects in M.ZONES_DEMO.items():
        for (a, b, c, d) in rects:
            s.rect(a, b, c-a, d-b, fill='#fdecea', stroke=C['demo'], sw=55, dash='320,160', op=.85)
    for (o, p, a, b) in DEMO_WALLS:
        if o == 'V': s.line(p, a, p, b, C['demo'], 90, dash='260,160')
        else:        s.line(a, p, b, p, C['demo'], 90, dash='260,160')

    lab = [(1200, 15800, ['单人间 ×3', '8.2㎡/间'], 300), (3150, 15800, ['内走道', '1200 宽'], 280),
           (5720, 14100, ['双人间 ×4', '12.3㎡/间'], 320), (7650, 19200, ['四人间', '25.5㎡'], 320),
           (12150, 15800, ['休息区', '1200 宽'], 280), (8600, 5200, ['活动休闲区  187 ㎡', '（健身 / 台球 / 洽谈）'], 460)]
    for (x, y, ls, sz) in lab:
        rot = -90 if sz < 300 else 0
        if rot:
            for i, t in enumerate(ls): s.txt(x + i*380 - 190, y, t, sz, C['demo'], weight='600', rot=rot)
        else:
            s.multi(x, y, ls, sz, C['demo'], weight='600')

    # 采光标注
    s.txt(8200, -1050, '北立面 满玻（柱间 4 段，合计 16.2 m）—— 全层最优采光面', 380, C['glass'], weight='600')
    s.txt(700, 6900, '西立面玻璃 6.27m', 320, C['glass'], weight='600', rot=-90)
    s.txt(4400, 22050, '南立面 X<8900 段图面未画窗（实墙）', 360, C['demo'], weight='600')
    s.txt(15000, 22050, '南立面 玻璃', 340, C['glass'], weight='600')
    s.txt(8200, 8600, '↑ 结构无柱：北区 18.1×10.3m、南区 12.8×10.1m 均为无柱大空间', 400, C['ink'], weight='600', op=.75)

    s.txt(-3200, -3900, '4F 现状与拆除范围', 700, C['ink'], anchor='start', weight='700')
    s.txt(-3200, -3300, '改造范围合计 316.9 ㎡（北区 187.0 + 南区 129.9）；'
                        '拆除为轻质隔墙，房间内无给排水点位，拆除简单',
          380, C['keeptx'], anchor='start')
    notes = [
        '1. 结构：柱网 9200 ×（6300 / 4100 / 10400），主柱 600×700 位于轴线交点；'
        '北区 18.1×10.3 m、南区 12.8×10.1 m 内部均无中柱，是极好的开敞办公底板。',
        '2. 采光：北立面柱间满玻、合计约 16.2 m，为全层最优采光面；西立面仅 Y3777~10049 一段（6.27 m）有玻璃。'
        '按本图，宿舍区外墙（西墙 Y>10049、南墙 X<8900）未画窗 —— 若属实，南区即为无天然采光的内区，'
        '须以原建筑图 / 现场复核为准。',
        '3. 拆除：范围内全部为轻质隔墙，房间内无给排水点位，拆除量小；'
        '拆掉北区与南区之间 100 mm 隔墙后可形成 18.1 × 20.5 m 的完整楼层。',
        '4. 保留：客房 01 / 02（各 35 ㎡）、茶水间 23 ㎡、备餐间 7 ㎡、IT / 清扫间、男女卫生间、淋浴、强弱电井、电梯、楼梯。',
        '5. 疏散：安全出口 1 = 东北角楼梯（经入口门厅）；安全出口 2 = 东侧客房走道尽端消防楼梯（4F 图上仅画门）。'
        '两个出口均在东端，西端最不利点距离接近规范上限，是本次改造最需要先落实的一项。',
    ]
    nb = note_block(s, notes, '现状要点')
    lg = legend_box([(C['demo'], 'dash', '本次拆除范围'), (C['col'], 'fill', '结构柱 600×700'),
                     (C['glass'], 'glass', '外窗 / 玻璃幕墙'), (C['keep'], 'fill', '保留房间')],
                    title='图例')
    return s.out('4F 现状与拆除范围', '', nb + lg, bottom=LEG_END[0])


# ==================== 图 2~4：方案平面 ====================
def draw_scheme(sc):
    s = SVG(); shell(s); keeps(s, dim=True); entry_hall(s)
    nf, sf = sc['n'], sc['s']
    HEAD = sc['head']

    # --- 循环体系 ---
    # ① 北向采光通廊（主横向通道），宽 = HEAD
    aisle_band(s, N_ZONE[0], N_ZONE[1], SPINE_X[1], N_ZONE[1] + HEAD)
    s.txt(SPINE_X[0] - 250, N_ZONE[1] + HEAD - 110, f'北向采光通廊 {HEAD} —— 主横向通道',
          320, C['keeptx'], anchor='end', weight='500')
    # ② 东侧纵向通道（通廊 → 入口门厅）
    aisle_band(s, SPINE_X[0], N_ZONE[1], SPINE_X[1], N_ZONE[3])
    s.txt((SPINE_X[0]+SPINE_X[1])/2, 6800, '入口纵向通道 1800', 300, C['keeptx'], weight='500', rot=-90)
    # ③ 南区主通道（止于保留墙 X=12751）
    aisle_band(s, S_ZONE[0], SPINE_Y[0], SPINE_X_END, SPINE_Y[1], '南区主通道 1800')
    # ④ 纵向次通道（北区内，连接通廊与南区主通道）
    cx = None
    if len(nf.lanes) > 1:
        gaps = [(nf.lanes[i] + nf.desk_w, nf.lanes[i+1]) for i in range(len(nf.lanes)-1)]
        cx = max(gaps, key=lambda g: g[1]-g[0])
        if cx[1]-cx[0] > 900:
            ybot = SPINE_Y[1] if cx[1] <= SPINE_X_END else N_ZONE[3]
            aisle_band(s, cx[0], N_ZONE[1]+HEAD, cx[1], ybot)
            s.txt((cx[0]+cx[1])/2, 6800, f'纵向次通道 {cx[1]-cx[0]:.0f}', 280, C['keeptx'], weight='500', rot=-90)

    # ②轴柱：位于主通道北缘
    s.rect(8830, 9979, 740, 840, fill='none', stroke=C['hi'], sw=45, dash='180,120')

    # --- 西端功能带 ---
    if sc['west_n']:
        x0, x1 = N_ZONE[0], N_ZONE[0] + sc['west_n'] - 200
        y0 = N_ZONE[1] + HEAD
        s.rect(x0, y0, x1-x0, SPINE_Y[0]-y0, fill=C['lounge'], stroke=C['loungeln'], sw=45)
        s.multi((x0+x1)/2, 5200, ['协作 / 休闲区', f'{(x1-x0)*(SPINE_Y[0]-y0)/1e6:.1f} ㎡', '（占据西向采光面）'],
                330, '#2f6b48', weight='600')
    if sc['west_s']:
        x0, x1 = S_ZONE[0], S_ZONE[0] + sc['west_s'] - 200
        H = S_ZONE[3] - SPINE_Y[1]
        if sc['tag'] == 'B':
            share, names = [0.5, 0.5], ['会议室 A  10人', '会议室 B  10人']
        else:
            share, names = [0.49, 0.255, 0.255], ['会议室 A  10人', '洽谈室 B  4人', '洽谈室 C  4人']
        cuts, acc = [SPINE_Y[1]], SPINE_Y[1]
        for f_ in share:
            acc += H * f_; cuts.append(acc)
        n = len(share)
        for i in range(n):
            a, b = cuts[i], cuts[i+1] - 120
            s.rect(x0, a, x1-x0, b-a, fill=C['room'], stroke=C['roomln'], sw=55)
            s.multi((x0+x1)/2, (a+b)/2-60, [names[i], f'{(x1-x0)*(b-a)/1e6:.1f} ㎡'], 320, '#8a6d10', weight='600')
            s.circ(x1, (a+b)/2, 120, C['roomln'])      # 门位示意


    # --- 工位 ---
    desks(s, nf); desks(s, sf)

    # --- 分区标题 ---
    s.txt(nf.x0 + (SPINE_X[0]-nf.x0)/2, -780,
          f'北区 · 主工位区（北向 + 西向采光）   {2*len(nf.bands)} 排 × {len(nf.lanes)} 列 = {nf.seats} 工位',
          430, C['ink'], weight='700')
    s.txt(sf.x0 + (S_ZONE[2]-sf.x0)/2, 22400,
          f'南区 · 次工位区（内区，仅东南角采光）   {2*len(sf.bands)} 排 × {len(sf.lanes)} 列 = {sf.seats} 工位',
          430, C['ink'], weight='700')

    # --- 模数标注 ---
    dw, dd = sc['desk']
    bx = nf.lanes[0]; by = nf.bands[0][0]; y2 = nf.bands[0][1]
    s.line(bx, by-420, bx+dw, by-420, C['hi'], 35)
    s.line(bx, by-520, bx, by-320, C['hi'], 35); s.line(bx+dw, by-520, bx+dw, by-320, C['hi'], 35)
    s.txt(bx+dw/2, by-560, f'{dw}', 290, C['hi'], weight='600')
    mx = ((cx[0]+cx[1])/2 - 240) if cx and cx[1]-cx[0] > 900 else (nf.x0 + sc['aisle']/2 - 120)
    s.line(mx, by, mx, y2, C['hi'], 45)
    s.txt(mx+210, (by+y2)/2, f'背靠背 {2*dd}', 290, C['hi'], weight='600', rot=-90)
    s.line(mx, y2, mx, y2+sc['chair'], C['dim'], 45)
    s.txt(mx+210, y2+sc['chair']/2, f'座椅+通行 {sc["chair"]}', 280, C['dim'], rot=-90)

    # --- 疏散路径 ---
    ax = nf.x0 + sc['aisle']/2
    py_ = N_ZONE[1] + HEAD/2
    px = [(300, 20400), (ax, 20400), (ax, py_), (17200, py_), (17200, 2600), (21500, 2600), (21500, 4200)]
    pts = ' '.join(f'{a:.0f},{b:.0f}' for a, b in px)
    s.add(f'<polyline points="{pts}" fill="none" stroke="{C["demo"]}" stroke-width="90" '
          f'stroke-dasharray="420,240" stroke-linejoin="round" opacity="0.75"/>')
    s.circ(300, 20400, 220, C['demo'])
    s.txt(760, 20300, '最不利点', 300, C['demo'], anchor='start', weight='600')
    import math
    dd_ = math.hypot(18098-300, 2600-20400)/1000
    s.txt(21500, 5400, '→ 安全出口 1', 300, C['demo'], anchor='middle', weight='600')

    # --- 标题 ---
    s.txt(-3200, -3900, sc['name'], 700, C['ink'], anchor='start', weight='700')
    s.txt(-3200, -3300,
          f'工位 {dw}×{dd}，背靠背带宽 {2*dd}，座椅+通行区 {sc["chair"]}，采光通廊 {HEAD}，主通道 1800 ｜ '
          f'合计 {sc["seats"]} 工位，改造区 {TOTAL/sc["seats"]:.1f} ㎡/位',
          380, C['keeptx'], anchor='start')
    items = [(C['desk'], 'fill', f'工位 {dw}×{dd}')]
    if sc['west_s']: items.append((C['room'], 'fill', '会议室 / 独立房间'))
    if sc['west_n']: items.append((C['lounge'], 'fill', '协作休闲区'))
    items += [(C['aisle'], 'fill', '主通道 / 采光通廊 / 门厅'), (C['col'], 'fill', '结构柱'),
              (C['glass'], 'glass', '外窗'), (C['keep'], 'fill', '保留（茶水间/客房/卫生间/电井）'),
              (C['demo'], 'dash', '最不利点疏散路径')]
    notes = [
        f'1. 循环体系：北向采光通廊 {HEAD}（主横向）+ 入口纵向通道 1800 + 南区主通道 1800 + 纵向次通道 1200；'
        f'南区主通道东端止于保留墙（IT/备餐间/茶水间），南区经纵向次通道向北接入通廊。',
        f'2. ②轴柱（600×700）嵌入南区主通道北缘，柱侧净宽约 1100 —— 建议此处通道局部加宽至 2500，或将工位带南移 700。',
        f'3. 最不利点（西南角）至办公区疏散门直线距离 ≈ {dd_:.1f} m；喷淋保护下限值 22×1.25 = 27.5 m，'
        f'接近上限，须由消防设计单位复核并确认防烟分区与排烟方式。',
        f'4. 原宿舍房间内无给排水点位，隔墙为轻质隔墙，拆除简单；但空调/新风/照明/强弱电须按办公密度重新设计。',
        f'5. 南区（原宿舍）按图面无外窗，工位照度全部依赖人工照明；如原建筑图确有外窗，可将南区工位密度上调。',
    ]
    if not sc['west_s']:
        notes.append('6. 本方案不设独立会议室，会议 / 洽谈功能借用 3 楼（大会议室 48 ㎡、中会议室 21 ㎡、洽谈室 ×4）；'
                     '打印、储物、电话亭结合入口门厅与主通道两侧墙面布置。')
    else:
        notes.append('6. 电话亭与打印区结合协作 / 休闲区布置；储物柜（450 深）沿南区主通道南侧连续布置，不占工位。')
    nb = note_block(s, notes, '设计说明')
    lgb = legend_box(items, title='图例')
    return s.out(sc['name'], '', nb + lgb, bottom=LEG_END[0])


if __name__ == '__main__':
    import io
    open('4F_01_现状与拆除.svg', 'w', encoding='utf-8').write(draw_existing())
    for sc in SCHEMES:
        fn = f'4F_0{2 + "ABC".index(sc["tag"])}_方案{sc["tag"]}.svg'
        open(fn, 'w', encoding='utf-8').write(draw_scheme(sc))
        print('wrote', fn, sc['seats'], '工位')
    print('wrote 4F_01_现状与拆除.svg')
