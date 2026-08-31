# -*- coding: utf-8 -*-
"""第三方 4F 平面方案（PLAN A / B）几何提取。坐标系已与四层平面布置图对齐。"""
import pymupdf, collections
K = 31.86; OX = 176.42; OY = 107.39
_c = {}
def segs(page=0):
    if page in _c: return _c[page]
    d = pymupdf.open('/home/user/zhuangxiu/4F 平面方案0828.pdf'); p = d[page]
    HW = p.cropbox.width                      # 旋转 270°：display_y = 宽 - x
    def T(pt): return ((pt.y - OX) * K, ((HW - pt.x) - OY) * K)
    V, Hz = [], []
    for g in p.get_drawings():
        it_all = []
        for it in g['items']:
            if it[0] == 'l': it_all.append((T(it[1]), T(it[2])))
            elif it[0] == 're':
                r = it[1]
                c = [T(pymupdf.Point(r.x0,r.y0)), T(pymupdf.Point(r.x1,r.y0)),
                     T(pymupdf.Point(r.x1,r.y1)), T(pymupdf.Point(r.x0,r.y1))]
                it_all += [(c[i], c[(i+1)%4]) for i in range(4)]
        for a, b in it_all:
            if abs(a[0]-b[0]) < 3 and abs(a[1]-b[1]) > 250:
                V.append(((a[0]+b[0])/2, min(a[1],b[1]), max(a[1],b[1])))
            elif abs(a[1]-b[1]) < 3 and abs(a[0]-b[0]) > 250:
                Hz.append(((a[1]+b[1])/2, min(a[0],b[0]), max(a[0],b[0])))
    _c[page] = (V, Hz); return _c[page]

def walls(page=0, tmin=60, tmax=340, ovl=600):
    key = ('w', page)
    if key in _c: return _c[key]
    V, Hz = segs(page)
    def pair(ls):
        out = []
        for (a, s0, s1) in ls:
            for (b, t0, t1) in ls:
                if tmin <= abs(a-b) <= tmax and min(s1,t1)-max(s0,t0) >= ovl:
                    out.append((a, s0, s1)); break
        return out
    _c[key] = (pair(V), pair(Hz)); return _c[key]

def box(sx, sy, page=0, span=700):
    V, Hz = walls(page)
    W = max((x for x,a,b in V if x < sx and a <= sy <= b and b-a >= span), default=None)
    E = min((x for x,a,b in V if x > sx and a <= sy <= b and b-a >= span), default=None)
    N = max((y for y,a,b in Hz if y < sy and a <= sx <= b and b-a >= span), default=None)
    S = min((y for y,a,b in Hz if y > sy and a <= sx <= b and b-a >= span), default=None)
    if None in (W,E,N,S): return None
    return dict(x0=W,y0=N,x1=E,y1=S,w=E-W,h=S-N,area=(E-W)*(S-N)/1e6)
