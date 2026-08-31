# -*- coding: utf-8 -*-
"""4F 三个工位排布方案。尺寸 mm。"""
from layout import Field
from plan_model import N_ZONE, S_ZONE, area

# 主疏散通道：贴 Ⓑ 轴柱北面起，宽 1800（②轴柱处局部加宽至 2500）
SPINE_Y = (10049, 11849)
SPINE_X_END = 12751      # 主通道东端止于保留墙（IT/备餐间/茶水间）
# 东侧纵向主通道（入口门厅 → 主通道），宽 1800
SPINE_X = (16298, 18098)

def build(desk_w, desk_d, head, chair, aisle, cross, cross_after,
          west_n=0, west_s=0, name='', tag='', support=None, cross_after_s=None):
    # 北区工位带的下边界取原隔墙线 Y=10652（其西段外即为南区主通道，座椅可外让）
    nf = Field(N_ZONE[0] + west_n, N_ZONE[1], SPINE_X[0], N_ZONE[3],
               desk_w, desk_d, head, chair, aisle, cross, cross_after).build()
    sf = Field(S_ZONE[0] + west_s, SPINE_Y[1], S_ZONE[2], S_ZONE[3],
               desk_w, desk_d, 0, chair, aisle, cross, cross_after_s or cross_after).build()
    return dict(name=name, tag=tag, n=nf, s=sf, desk=(desk_w, desk_d),
                west_n=west_n, west_s=west_s, seats=nf.seats + sf.seats,
                chair=chair, head=head, aisle=aisle, cross=cross, support=support or [])

SCHEMES = [
    build(1400, 700, 1500, 1800, 1000, 1200, 6, 0, 0, cross_after_s=4,
          name='方案 A · 容量优先', tag='A',
          support=['入口门厅设前台/接待', '打印、储物沿主通道布置', '4楼不设独立会议室，会议借用3楼']),
    build(1500, 750, 1200, 1800, 1000, 1200, 5, 3600, 3600,
          name='方案 B · 均衡（推荐）', tag='B',
          support=['北区西端 3.6m 宽协作休闲区（占据西向采光面）', '南区西端 2 间 10 人会议室',
                   '电话亭 ×2、打印/储物、储物柜墙', '入口门厅设前台/接待']),
    build(1600, 800, 1500, 1800, 1200, 1400, 5, 3600, 3600,
          name='方案 C · 品质优先', tag='C',
          support=['北区西端 3.6×9.7m 协作休闲 + 洽谈', '南区西端 3 间会议室（10人×1 + 6人×2）',
                   '电话亭 ×4、打印/储物', '桌间净距 1000mm，通道 1400mm']),
]

TOTAL = area(N_ZONE) + area(S_ZONE)

if __name__ == '__main__':
    print(f'改造总面积 {TOTAL:.1f} ㎡ = 北区 {area(N_ZONE):.1f} + 南区 {area(S_ZONE):.1f}')
    print(f'主疏散通道 Y {SPINE_Y[0]}~{SPINE_Y[1]} (宽 {SPINE_Y[1]-SPINE_Y[0]})，'
          f'东侧通道 X {SPINE_X[0]}~{SPINE_X[1]}\n')
    for s in SCHEMES:
        print(f'== {s["name"]}  桌 {s["desk"][0]}×{s["desk"][1]}，'
              f'背靠背带宽 {2*s["desk"][1]}，座椅区 {s["chair"]} ==')
        s['n'].report('北区')
        s['s'].report('南区')
        print(f'   ▶ 合计 {s["seats"]} 工位；改造区综合 {TOTAL/s["seats"]:.2f} ㎡/位')
        for t in s['support']: print(f'     · {t}')
        print()
