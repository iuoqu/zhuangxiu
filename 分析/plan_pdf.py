# -*- coding: utf-8 -*-
"""把甲方的《4F 平面方案0828.pdf》读成毫米坐标。

为什么能读：这份 PDF 是矢量的（每页 4983 个图元、房间名是真文字），
而且里面 18 根柱子的黑色填充和我们从 DWG 量出来的 18 根一一对得上 ——
拿柱心做最小二乘配准，最大残差 2.1 mm、RMS 1.0 mm。配准一成立，
图上任何一条线都能换算成和现有模型同一套毫米坐标。

    model_x =  31.8572 · pdf_y − 5619.7
    model_y = −31.8572 · pdf_x + 23401.5     （1 pt = 31.8572 mm）

独立验证：五个保留房间（强电井、弱电井、客房 01／02、备餐间）的文字标注
换算之后全部落在 DWG 量出来的房间框里 —— 那几个框不是从这份 PDF 来的。

用法：  python3 分析/plan_pdf.py            → 分析/plan_A.json、plan_B.json
        python3 分析/plan_pdf.py --check    → 另外出一张套图，肉眼核对
"""
import json, os, sys, math, collections
import pymupdf

PDF = os.path.join(os.path.dirname(__file__), '..', '4F 平面方案0828.pdf')
OUT = os.path.dirname(__file__)
MODEL = os.path.join(OUT, '..', 'models', 'model_clay.json')


# ---------------------------------------------------------------- 配准
def columns_pdf(page):
    """黑色填充里 14~24 pt 见方的那些＝柱子。同一根会画两遍，去重。"""
    out = set()
    for it in page.get_drawings():
        if it['type'] not in ('f', 'fs') or it.get('fill') != (0.0, 0.0, 0.0):
            continue
        r = it['rect']
        if 14 < r.width < 24 and 14 < r.height < 24:
            out.add((round(r.x0 + r.width / 2, 2), round(r.y0 + r.height / 2, 2)))
    return sorted(out)


def columns_model():
    m = json.load(open(MODEL, encoding='utf-8'))
    return sorted((it[2] + it[5] / 2, it[3] + it[6] / 2)
                  for it in m['items'] if it[1] == 'column')


def fit(page):
    """柱心配准，返回 (s, c1, c2, 最大残差, RMS)。两轴共用一个比例。"""
    import numpy as np
    P = np.array(columns_pdf(page))
    M = np.array(columns_model())
    if len(P) != len(M):
        raise SystemExit(f'柱子数对不上：PDF {len(P)} 根，模型 {len(M)} 根')
    # 先用粗解配对：两端柱心的跨距是已知的（模型里 0 → 27600），拿它反推比例。
    # 别用「相邻柱距」—— 柱网里夹着半跨的小柱，相邻差是 144 pt 不是 288 pt，会差一倍。
    a0, b0 = min(y for _, y in P), max(x for x, _ in P)
    span_pdf = max(y for _, y in P) - a0
    span_mm = max(x for x, _ in M) - min(x for x, _ in M)
    s0 = span_mm / span_pdf
    pred = np.c_[(P[:, 1] - a0) * s0, (b0 - P[:, 0]) * s0]
    idx = [int(np.argmin(((M - q) ** 2).sum(1))) for q in pred]
    if len(set(idx)) != len(P):
        raise SystemExit('柱子配对不唯一，粗解不够准')
    Q = M[idx]
    # 最小二乘重解
    A = np.zeros((2 * len(P), 3)); y = np.zeros(2 * len(P))
    for i, (px, py) in enumerate(P):
        A[2 * i]     = [py, 1, 0]; y[2 * i]     = Q[i, 0]
        A[2 * i + 1] = [-px, 0, 1]; y[2 * i + 1] = Q[i, 1]
    (s, c1, c2), *_ = np.linalg.lstsq(A, y, rcond=None)
    res = np.c_[s * P[:, 1] + c1, -s * P[:, 0] + c2] - Q
    return float(s), float(c1), float(c2), float(abs(res).max()), float((res ** 2).mean() ** .5)


# ---------------------------------------------------------------- 提取
DESK = (1400, 1400)      # 背靠背工位模块：两张 1400×700
CHAIR = (700, 600)


def near(a, b, tol=60):
    return abs(a - b) <= tol


def rects_of(it):
    """一条路径画出来的矩形＝它的外接框。

    这份 PDF 里一个 re 都没有，全是线段（单页 23705 条）；4 段的路径基本是折线
    （曲线近似），不是矩形 —— 按「连着 4 条线首尾闭合」还原过，一个都还原不出来。
    实际是一件家具通常就是一条路径，取外接框再按尺寸筛最省事。
    代价：一条路径画了一整排椅子的，会被当成一件大家具漏掉（已知缺口）。
    """
    return [tuple(it['rect'])]


def extract(page, s, c1, c2):
    mm = lambda x, y: (s * y + c1, -s * x + c2)      # pt → mm
    rooms, desks, chairs, tables, walls = [], [], [], [], []
    # 柱子按「离已配准的柱心多近」剔除，别按尺寸 —— 600×700 的柱子和 700×600
    # 的椅子尺寸几乎一样，按尺寸剔会把 32 把椅子一起剔掉
    colc = [mm(x, y) for x, y in columns_pdf(page)]

    for blk in page.get_text('dict')['blocks']:
        for ln in blk.get('lines', []):
            for sp in ln['spans']:
                t = sp['text'].strip()
                if not t or t.startswith('PLAN'):
                    continue
                x0, y0, x1, y1 = sp['bbox']
                x, y = mm((x0 + x1) / 2, (y0 + y1) / 2)
                rooms.append({'name': t, 'x': round(x), 'y': round(y)})

    # 这份 PDF 里一个 re 都没有，全是线段（单页 23705 条）。而 get_drawings() 是按
    # 「路径」分组的，一条路径可能画了一整排椅子 —— 直接拿 it['rect'] 会把整排的
    # 外接框当成一件家具。所以自己从「连着 4 条线且首尾闭合」还原出矩形。
    seen = set()
    for it in page.get_drawings():
        for r0 in rects_of(it):
            w, h = (r0[2] - r0[0]) * s, (r0[3] - r0[1]) * s
            x, y = mm((r0[0] + r0[2]) / 2, (r0[1] + r0[3]) / 2)
            key = (round(x), round(y), round(w), round(h))
            if key in seen:
                continue
            seen.add(key)
            box = {'x': round(x), 'y': round(y), 'w': round(w), 'h': round(h)}
            # 柱子已经单独处理，别混进来
            if any(abs(x - cx) < 400 and abs(y - cy) < 400 for cx, cy in colc):
                continue
            if near(w, DESK[0]) and near(h, DESK[1]):
                desks.append(box)
            elif (near(w, CHAIR[0], 90) and near(h, CHAIR[1], 90)) or \
                 (near(w, CHAIR[1], 90) and near(h, CHAIR[0], 90)):
                chairs.append(box)
            elif 2000 < max(w, h) < 7000 and 900 < min(w, h) < 2600:
                tables.append(box)
        for k in it['items']:
            if k[0] != 'l':
                continue
            (ax, ay), (bx, by) = (k[1].x, k[1].y), (k[2].x, k[2].y)
            L = math.hypot(ax - bx, ay - by) * s
            if L < 800:
                continue
            p, q = mm(ax, ay), mm(bx, by)
            walls.append({'x1': round(p[0]), 'y1': round(p[1]),
                          'x2': round(q[0]), 'y2': round(q[1]), 'len': round(L)})

    # 长线去重（同一条会画好几遍）
    ded, ws = set(), []
    for w_ in walls:
        k = (w_['x1'], w_['y1'], w_['x2'], w_['y2'])
        k2 = (w_['x2'], w_['y2'], w_['x1'], w_['y1'])
        if k in ded or k2 in ded:
            continue
        ded.add(k); ws.append(w_)
    return rooms, desks, chairs, tables, ws


def main():
    doc = pymupdf.open(PDF)
    for i, tag in enumerate('AB'):
        page = doc[i]
        s, c1, c2, mx, rms = fit(page)
        rooms, desks, chairs, tables, walls = extract(page, s, c1, c2)
        data = {
            'plan': tag,
            'fit': {'mm_per_pt': round(s, 4), 'c1': round(c1, 1), 'c2': round(c2, 1),
                    '柱子残差最大mm': round(mx, 1), '柱子残差RMSmm': round(rms, 1)},
            'rooms': rooms, 'desks': desks, 'chairs': chairs,
            'tables': tables, 'walls': walls,
        }
        f = os.path.join(OUT, f'plan_{tag}.json')
        json.dump(data, open(f, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print(f'PLAN {tag}: 配准 1pt={s:.4f}mm 残差最大 {mx:.1f}mm / RMS {rms:.1f}mm  →  {f}')
        print(f'         房间名 {len(rooms)}　工位模块 {len(desks)}　椅 {len(chairs)}　'
              f'桌 {len(tables)}　长线 {len(walls)}')
        if '--check' in sys.argv:
            check(doc, s, c1, c2, data, tag)


def check(doc, s, c1, c2, data, tag, dpi=150):
    """把提取结果按毫米坐标反算回 pt，画到渲染出来的原图上，肉眼核对有没有对上位置。"""
    from PIL import Image, ImageDraw
    page = doc['AB'.index(tag)]
    pm = page.get_pixmap(dpi=dpi)
    im = Image.frombytes('RGB', (pm.width, pm.height), pm.samples).convert('RGB')
    k = dpi / 72.0
    # get_drawings() 给的是「未旋转」的页面坐标（这页 /Rotate 270，mediabox 是竖版
    # 842×1190），而 get_pixmap() 渲出来的是转正之后的横版 1190×842。差着一个旋转，
    # 直接按 pt 画会整体错位。用 page.rotation_matrix 把它转过去。
    R = page.rotation_matrix
    def pt(X, Y):                                                  # mm → 像素
        q = pymupdf.Point((c2 - Y) / s, (X - c1) / s) * R
        return (q.x * k, q.y * k)
    d = ImageDraw.Draw(im)
    def box(b, col, wd=3):
        x0, y0 = pt(b['x'] - b['w'] / 2, b['y'] - b['h'] / 2)
        x1, y1 = pt(b['x'] + b['w'] / 2, b['y'] + b['h'] / 2)
        d.rectangle([min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)], outline=col, width=wd)
    for b in data['desks']:  box(b, (0, 130, 255))
    for b in data['tables']: box(b, (230, 60, 40))
    for b in data['chairs']: box(b, (0, 170, 90), 2)
    for r in data['rooms']:
        x, y = pt(r['x'], r['y'])
        d.ellipse([x - 7, y - 7, x + 7, y + 7], outline=(200, 0, 200), width=4)
    for x, y in [(it[2] + it[5] / 2, it[3] + it[6] / 2)
                 for it in json.load(open(MODEL, encoding='utf-8'))['items'] if it[1] == 'column']:
        px, py = pt(x, y)                                          # 模型柱心，验配准
        d.line([px - 13, py, px + 13, py], fill=(255, 140, 0), width=4)
        d.line([px, py - 13, px, py + 13], fill=(255, 140, 0), width=4)
    f = os.path.join(OUT, f'plan_{tag}_套图.png')
    im.save(f)
    print(f'         套图 → {f}   蓝＝工位模块 红＝桌 绿＝椅 紫＝房间名 橙十字＝模型柱心')


if __name__ == '__main__':
    main()
