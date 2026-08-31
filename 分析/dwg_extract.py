# -*- coding: utf-8 -*-
"""从 DWG 提取几何 —— dwg_check.py 里那些数字是怎么来的。

环境（容器里没有 ODA File Converter / LibreDWG，用 aspose-cad 的 .NET 后端）：

    pip install aspose-cad ezdxf
    export DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1        # 否则 "Couldn't find a valid ICU package"
    export LD_LIBRARY_PATH="<装有 libssl.so.1.1 的目录>:$LD_LIBRARY_PATH"
    # OpenSSL 3.0 删掉了 ERR_put_error，.NET 6 需要 1.1；
    # 可从 psycopg2-binary==2.9.3 的 manylinux wheel 里取 libssl-*.so.1.1 / libcrypto-*.so.1.1 建软链

用法：
    python3 dwg_extract.py convert            # DWG → DXF
    python3 dwg_extract.py plan               # 平面：轴网标定 + 柱 / 幕墙 / 房间图注
    python3 dwg_extract.py elev               # 立面：图块聚类 + 标高反算

两个坑：
  1. Aspose 会在栅格 / PDF 输出上打评估版水印，并把水印几何塞进模型空间 8800 万坐标处；
     按坐标聚类剔掉即可，DXF 里的真实图元不受影响。
  2. Aspose 会整体缩放 + 平移坐标（本例偏移 4400 万、缩放 25.532 mm/单位），
     必须用轴网重新标定比例，不能直接当毫米用。
"""
import os
import re
import sys
import collections

SRC = os.path.join(os.path.dirname(__file__), '..')
PLAN_DWG = os.path.join(SRC, '02.4F 平面系统图.dwg')
ELEV_DWG = os.path.join(SRC, '03.4F-立面系统图.dwg')
PLAN_DXF, ELEV_DXF = 'plan.dxf', 'elev.dxf'

MM_PER_UNIT = 25.532          # 由轴网 / 板厚标定，两个文件一致
PLAN_X0, PLAN_Y0 = 200.6, 954.3   # 平面 DXF 中轴 ① / 轴 Ⓓ 的坐标


def dec(s):
    """DXF 把非 ASCII 图层名写成 \\U+XXXX。"""
    return re.sub(r'\\U\+([0-9A-Fa-f]{4})', lambda g: chr(int(g.group(1), 16)), s)


def convert():
    import aspose.cad as cad
    import aspose.cad.imageoptions as io
    for dwg, dxf in ((PLAN_DWG, PLAN_DXF), (ELEV_DWG, ELEV_DXF)):
        o = io.DxfOptions()
        o.text_as_lines = False        # 关键：否则 TEXT 被打散成线，图注全丢
        cad.Image.load(dwg).save(dxf, o)
        print(f'{dwg} → {dxf}')


def polys(path):
    """(图层, 是否闭合, 顶点表) 列表。"""
    import ezdxf
    out = []
    for e in ezdxf.readfile(path).modelspace():
        t, L = e.dxftype(), dec(e.dxf.layer)
        try:
            if t == 'LINE':
                a, b = e.dxf.start, e.dxf.end
                P, c = [(a.x, a.y), (b.x, b.y)], False
            elif t == 'POLYLINE':
                P = [(v.dxf.location.x, v.dxf.location.y) for v in e.vertices]
                c = bool(e.is_closed)
            elif t == 'LWPOLYLINE':
                P, c = [(p[0], p[1]) for p in e.get_points()], bool(e.closed)
            else:
                continue
        except Exception:
            continue
        if len(P) >= 2:
            out.append((L, c, P))
    return out


def texts(path):
    import ezdxf
    out = []
    for e in ezdxf.readfile(path).modelspace():
        if e.dxftype() in ('TEXT', 'MTEXT'):
            s = e.dxf.text if e.dxftype() == 'TEXT' else e.text
            out.append((dec(e.dxf.layer), dec(s), e.dxf.insert.x, e.dxf.insert.y))
    return out


# ------------------------------------------------------------------ 平面
def plan():
    K, X0, Y0 = MM_PER_UNIT, PLAN_X0, PLAN_Y0
    T = lambda p: ((p[0] - X0) * K, (Y0 - p[1]) * K)
    P = polys(PLAN_DXF)
    # 图纸里平面图与顶面图并排；X < 1500 的是平面图那一份
    inplan = lambda pts: all(-2000 <= q[0] <= 1500 for q in pts)

    print('== 轴网标定 ==')
    V, H = set(), set()
    for L, _, pts in P:
        if L != 'A—轴线':
            continue
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            if abs(b[0] - a[0]) < .1 and abs(b[1] - a[1]) > 200 and a[0] < 1500:
                V.add(round(a[0], 1))
            if abs(b[1] - a[1]) < .1 and abs(b[0] - a[0]) > 200:
                H.add(round(a[1], 1))
    xs = sorted(V)
    print('  ①②③④ X 间距 mm:', [round((xs[i+1]-xs[i]) * K) for i in range(len(xs)-1)], '（应为 9200）')
    # 横轴线成对出现（相距 25.1 单位 ≈ 641 mm），取上面那条才是真轴线
    ys = sorted(y for y in H if any(abs(y - u - 25.1) < .3 for u in H) or y == max(H))
    print('  ⒹⒸⒷⒶ Y 间距 mm:', [round((ys[i+1]-ys[i]) * K) for i in range(len(ys)-1)],
          '（应为 6300 / 4100 / 10400，自 Ⓐ 起算则反序）')

    print('\n== 结构柱（Q-01 原始墙柱 中的矩形）==')
    R = set()
    for L, _, pts in P:
        if L != 'Q-01 原始墙柱' or not inplan(pts):
            continue
        q = [T(p) for p in pts]
        xx = [p[0] for p in q]; yy = [p[1] for p in q]
        w, h = max(xx) - min(xx), max(yy) - min(yy)
        if 300 < w < 1200 and 300 < h < 1200:
            R.add((round(min(xx)), round(min(yy)), round(w), round(h)))
    for r in sorted(R):
        print(f'   ({r[0]:6d},{r[1]:6d})  {r[2]}×{r[3]}')

    print('\n== 幕墙（Q-11 建筑幕墙）内表面段 ==')
    seg = set()
    for L, _, pts in P:
        if L != 'Q-11 建筑幕墙' or not inplan(pts):
            continue
        q = [T(p) for p in pts]
        x0, x1 = round(min(p[0] for p in q)), round(max(p[0] for p in q))
        y0, y1 = round(min(p[1] for p in q)), round(max(p[1] for p in q))
        if max(x1 - x0, y1 - y0) > 700:
            seg.add((x0, y0, x1, y1))
    for k in sorted(seg):
        print(f'   ({k[0]:6d},{k[1]:6d})-({k[2]:6d},{k[3]:6d})   {k[2]-k[0]:6d} × {k[3]-k[1]:6d}')

    print('\n== 房间图注 ==')
    cur = []
    for L, s, x, y in sorted(texts(PLAN_DXF), key=lambda t: (-round(t[3]), t[2])):
        if L in ('p—平面—文字', 'TEXT　文字', 'I—文字—房间名称', '家具尺寸'):
            cur.append((round((Y0 - y) * K), round((x - X0) * K), L, s))
    for y, x, L, s in cur:
        print(f'   ({x:7d},{y:7d})  [{L}]  {s}')


# ------------------------------------------------------------------ 立面
def elev():
    K = MM_PER_UNIT
    P = [(L, pts) for L, _, pts in polys(ELEV_DXF)
         if all(44e6 < p[0] < 45e6 and 44e6 < p[1] < 45e6 for p in pts)]   # 剔水印（8800 万处）
    O = 44e6
    # 连通聚类找立面图块
    G = collections.defaultdict(list)
    for L, pts in P:
        for p in pts:
            G[(int((p[0]-O)//40), int((p[1]-O)//40))].append((L, p[0]-O, p[1]-O))
    seen, groups = set(), []
    for k in list(G):
        if k in seen:
            continue
        seen.add(k); stack, cur = [k], []
        while stack:
            c = stack.pop(); cur += G[c]
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    n = (c[0]+dx, c[1]+dy)
                    if n in G and n not in seen:
                        seen.add(n); stack.append(n)
        groups.append(cur)
    groups.sort(key=len, reverse=True)
    print(f'{len(groups)} 个图块（取前 9 个立面）\n')

    for gi, g in enumerate(groups[:9]):
        xs = [p[1] for p in g]; ys = [p[2] for p in g]
        box = (min(xs), min(ys), max(xs), max(ys))
        # 基准面 = E—立面完成面 的最长水平线
        ffl, best = None, 0
        lines = collections.defaultdict(float)
        for L, pts in P:
            if not all(box[0] <= p[0]-O <= box[2] and box[1] <= p[1]-O <= box[3] for p in pts):
                continue
            for i in range(len(pts) - 1):
                a, b = pts[i], pts[i+1]
                if abs(b[1]-a[1]) < .05 and abs(b[0]-a[0]) > 3:
                    key = (L, round(a[1]-O, 2))
                    lines[key] = max(lines[key], abs(b[0]-a[0]))
                    if L == 'E—立面完成面' and lines[key] > best:
                        best, ffl = lines[key], a[1]-O
        if ffl is None:
            continue
        # 剔除 45° 剖面填充：同图层内以 ~2 单位等间距密集出现、且长度不满幅的线
        bylay = collections.defaultdict(list)
        for (L, y), ln in lines.items():
            bylay[L].append((y, ln))
        keep = []
        for L, v in bylay.items():
            v.sort()
            span = (box[2] - box[0])
            for y, ln in v:
                near = [u for u, _ in v if 0 < abs(u - y) < 2.2]
                if len(near) >= 2 and ln < span * 0.9:
                    continue
                keep.append(((y - ffl) * K, L, ln * K))
        keep.sort()
        print(f'--- 图块 #{gi}  立面宽 {(box[2]-box[0])*K:.0f} mm ---')
        shown = set()
        for h, L, ln in keep:
            if not (-400 < h < 5200) or ln < 300:
                continue
            r = round(h / 10) * 10
            if (r, L) in shown:
                continue
            shown.add((r, L))
            print(f'    {h:+8.0f} mm   长 {ln:7.0f}   {L}')
        print()


if __name__ == '__main__':
    {'convert': convert, 'plan': plan, 'elev': elev}[
        sys.argv[1] if len(sys.argv) > 1 else 'plan']()
