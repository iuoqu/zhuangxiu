# -*- coding: utf-8 -*-
"""模数敏感性：同样的配套预留与 900 座椅净距下，桌面尺寸对工位数的影响。"""
from layout import Field
from plan_model import N_ZONE, S_ZONE, area
from schemes import SPINE_Y, SPINE_X, TOTAL

def run(dw, dd, head, west=3600, chair=1800, aisle=1000, cross=1200, ca=5):
    nf = Field(N_ZONE[0]+west, N_ZONE[1], SPINE_X[0], N_ZONE[3], dw, dd, head, chair, aisle, cross, ca).build()
    sf = Field(S_ZONE[0]+west, SPINE_Y[1], S_ZONE[2], S_ZONE[3], dw, dd, 0, chair, aisle, cross, ca).build()
    return nf, sf

print(f'{"桌面":>10} {"通廊":>5} {"北区":>16} {"南区":>16} {"合计":>6} {"㎡/位":>7}')
for dw, dd in [(1200,600),(1400,700),(1500,750),(1600,800),(1800,800)]:
    for head in (1200, 1500):
        nf, sf = run(dw, dd, head)
        tot = nf.seats + sf.seats
        print(f'{dw}×{dd:<5} {head:>5} '
              f'{2*len(nf.bands)}排×{len(nf.lanes)}列={nf.seats:<3}      '
              f'{2*len(sf.bands)}排×{len(sf.lanes)}列={sf.seats:<3}      '
              f'{tot:>4}   {TOTAL/tot:>6.2f}')
    print()

# --- 可选：客房 01/02 一并改造的增量 ---
print('\n=== 若客房 01/02（南向采光面）一并改造，按方案 B 模数 ===')
kf = Field(17750, 12950, 27650, 20899, 1500, 750, 0, 1800, 1000, 1200, 5).build()
kf.report('客房区 X17750~27650 / Y12950~20899')
