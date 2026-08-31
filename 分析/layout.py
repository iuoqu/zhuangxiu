# -*- coding: utf-8 -*-
"""工位排布引擎：把长条形工作区切成 背靠背工位带 + 通道，并统计工位数。"""
from dataclasses import dataclass, field

@dataclass
class Desk:
    x: float; y: float; w: float; d: float; facing: str   # facing = 'N'/'S' 使用者朝向

@dataclass
class Field:
    """一个矩形工位区。benches 沿 X 方向排列（桌宽沿 X，桌深沿 Y）。"""
    x0: float; y0: float; x1: float; y1: float
    desk_w: float; desk_d: float
    aisle_head: float          # 靠窗/靠墙的第一条横向通道
    chair_zone: float          # 两条工位带之间的座椅+通行区（含两侧各一把椅）
    aisle_w: float             # 纵向主通道（工位区西端）
    cross_aisle: float         # 纵向次通道宽
    cross_after: int = 0       # 每隔几张桌插入一条纵向次通道，0=不插
    trail: float = 900         # 最后一条工位带之后必须留出的座椅净距
    band_cols: list = None     # 每条工位带的列数（None = 各带满列）；用于让某一带让出位置给打印/储物
    desks: list = field(default_factory=list)
    bands: list = field(default_factory=list)
    lanes: list = field(default_factory=list)

    def build(self):
        W = self.x1 - self.x0
        H = self.y1 - self.y0
        band = 2 * self.desk_d
        # --- 纵向(Y)：确定能放几条背靠背工位带 ---
        y = self.y0 + self.aisle_head
        while y + band + self.trail <= self.y1:
            self.bands.append((y, y + band))
            y += band + self.chair_zone
        # --- 横向(X)：桌位列 ---
        x = self.x0 + self.aisle_w
        n = 0
        while x + self.desk_w <= self.x1:
            if self.cross_after and n and n % self.cross_after == 0:
                x += self.cross_aisle
                if x + self.desk_w > self.x1:
                    break
            self.lanes.append(x)
            x += self.desk_w
            n += 1
        for bi, (by0, by1) in enumerate(self.bands):
            n = len(self.lanes)
            if self.band_cols and bi < len(self.band_cols):
                n = min(n, self.band_cols[bi])
            for lx in self.lanes[:n]:
                self.desks.append(Desk(lx, by0, self.desk_w, self.desk_d, 'N'))
                self.desks.append(Desk(lx, by0 + self.desk_d, self.desk_w, self.desk_d, 'S'))
        return self

    @property
    def seats(self):
        return len(self.desks)

    def report(self, name):
        a = (self.x1 - self.x0) * (self.y1 - self.y0) / 1e6
        print(f'  {name}: {self.x1-self.x0:.0f} x {self.y1-self.y0:.0f} = {a:.1f}㎡  '
              f'{len(self.bands)}带/{2*len(self.bands)}排 x {len(self.lanes)}列 = {self.seats} 工位 '
              f'({a/max(self.seats,1):.2f} ㎡/位)')
