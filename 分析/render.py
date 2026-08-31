# -*- coding: utf-8 -*-
"""方案 D 实景渲染 —— Blender / Cycles 路径追踪，几何全部来自 plan_model + scheme_d。

竖向标高取自 03.4F-立面系统图.dwg 实测（见 dwg_check.py）：
    吊顶 3000、门洞 2700、幕墙 0→4230 落地玻璃、结构板底 4280。

    pip install bpy==4.2.0
    python3 render.py <视角> [--w 1600] [--h 1000] [--s 128]
    python3 render.py all

视角：n_open 北区工位区 ｜ n_window 贴窗工位 ｜ big_mr 大会议室
      spine 南区主通道 ｜ pantry 茶水区 ｜ mid_mr 中会议室
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector

import plan_model as M
import scheme_d as D
from plan_model import COLS, GLAZ_N, GLAZ_W, GLAZ_S, KEEP, N_ZONE, S_ZONE
from schemes import SPINE_X, SPINE_Y, SPINE_X_END

H_CEIL, H_DOOR, H_SOFFIT = 3000, 2700, 4280
WALL = 100

OUT = os.environ.get('RENDER_OUT', '/tmp/render')


# ---------------------------------------------------------------- 基础工具
def m(v):
    return v / 1000.0


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, base, rough=0.5, metal=0.0, transmit=0.0, ior=1.45,
        emit=None, emit_str=0.0, wood=False, bump=0.0, plank=0.19):
    """一个 Principled BSDF 材质。wood=True 时叠一层程序化木纹。"""
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    ma = bpy.data.materials.new(name)
    ma.use_nodes = True
    nt = ma.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*base, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    b.inputs['IOR'].default_value = ior
    if transmit:
        b.inputs['Transmission Weight'].default_value = transmit
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = emit_str
    # 所有程序化纹理用 Object 坐标 —— 网格建在世界坐标系里，等价于「按米算」
    co = nt.nodes.new('ShaderNodeTexCoord')
    if wood:
        seam = nt.nodes.new('ShaderNodeTexWave')      # 板缝
        seam.wave_type, seam.bands_direction = 'BANDS', 'Y'
        seam.wave_profile = 'SAW'
        seam.inputs['Scale'].default_value = 1.0 / plank
        seam.inputs['Distortion'].default_value = 0.0
        grain = nt.nodes.new('ShaderNodeTexWave')     # 木纹
        grain.wave_type, grain.bands_direction = 'BANDS', 'Y'
        grain.inputs['Scale'].default_value = 26.0
        grain.inputs['Distortion'].default_value = 14.0
        grain.inputs['Detail'].default_value = 3.0
        nt.links.new(co.outputs['Object'], seam.inputs['Vector'])
        nt.links.new(co.outputs['Object'], grain.inputs['Vector'])
        rg = nt.nodes.new('ShaderNodeValToRGB')       # 木纹深浅
        rg.color_ramp.elements[0].color = (*[c * 0.80 for c in base], 1)
        rg.color_ramp.elements[1].color = (*[min(1, c * 1.25) for c in base], 1)
        nt.links.new(grain.outputs['Fac'], rg.inputs['Fac'])
        rs = nt.nodes.new('ShaderNodeValToRGB')       # 缝：起点一小段压深
        rs.color_ramp.interpolation = 'CONSTANT'
        rs.color_ramp.elements[0].color = (0.30, 0.30, 0.30, 1)
        rs.color_ramp.elements[1].position = 0.055
        rs.color_ramp.elements[1].color = (1, 1, 1, 1)
        nt.links.new(seam.outputs['Fac'], rs.inputs['Fac'])
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type, mix.blend_type = 'RGBA', 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        nt.links.new(rg.outputs['Color'], mix.inputs[6])
        nt.links.new(rs.outputs['Color'], mix.inputs[7])
        nt.links.new(mix.outputs[2], b.inputs['Base Color'])
    if bump:
        n = nt.nodes.new('ShaderNodeTexNoise')
        n.inputs['Scale'].default_value = 260.0
        n.inputs['Detail'].default_value = 6.0
        nt.links.new(co.outputs['Object'], n.inputs['Vector'])
        bm = nt.nodes.new('ShaderNodeBump')
        bm.inputs['Strength'].default_value = bump
        nt.links.new(n.outputs['Fac'], bm.inputs['Height'])
        nt.links.new(bm.outputs['Normal'], b.inputs['Normal'])
    return ma


_BUF = {}


def box(mname, x, y, z, dx, dy, dz):
    """按毫米给一个轴对齐长方体，按材质累积。"""
    if dx <= 0 or dy <= 0 or dz <= 0:
        return
    _BUF.setdefault(mname, []).append((m(x), -m(y + dy), m(z),
                                       m(x + dx), -m(y), m(z + dz)))


def cyl(mname, cx, cy, z, r, h, seg=20):
    _BUF.setdefault('#cyl' + mname, []).append((m(cx), -m(cy), m(z), m(r), m(h), seg))


def flush(bevel=0.006):
    """把累积的体块合并成每材质一个网格对象。"""
    objs = []
    for key, items in _BUF.items():
        iscyl = key.startswith('#cyl')
        mname = key[4:] if iscyl else key
        verts, faces = [], []
        for it in items:
            n = len(verts)
            if iscyl:
                cx, cy, z, r, h, seg = it
                for i in range(seg):
                    a = 2 * math.pi * i / seg
                    verts.append((cx + r * math.cos(a), cy + r * math.sin(a), z))
                for i in range(seg):
                    a = 2 * math.pi * i / seg
                    verts.append((cx + r * math.cos(a), cy + r * math.sin(a), z + h))
                for i in range(seg):
                    j = (i + 1) % seg
                    faces.append((n + i, n + j, n + seg + j, n + seg + i))
                faces.append(tuple(n + i for i in range(seg)))
                faces.append(tuple(n + seg + i for i in range(seg - 1, -1, -1)))
            else:
                x0, y0, z0, x1, y1, z1 = it
                verts += [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
                          (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
                faces += [(n+0, n+1, n+2, n+3), (n+7, n+6, n+5, n+4),
                          (n+0, n+4, n+5, n+1), (n+1, n+5, n+6, n+2),
                          (n+2, n+6, n+7, n+3), (n+3, n+7, n+4, n+0)]
        me = bpy.data.meshes.new(mname)
        me.from_pydata(verts, [], faces)
        me.validate()
        me.shade_flat()
        ob = bpy.data.objects.new(mname, me)
        ob.data.materials.append(bpy.data.materials[mname])
        bpy.context.collection.objects.link(ob)
        if bevel:
            bv = ob.modifiers.new('bevel', 'BEVEL')
            bv.width, bv.segments, bv.limit_method = bevel, 2, 'ANGLE'
            bv.angle_limit = math.radians(35)
        objs.append(ob)
    _BUF.clear()
    return objs


# ---------------------------------------------------------------- 材质表
def materials():
    mat('ceiling', (0.90, 0.90, 0.89), 0.92)
    mat('wall',    (0.84, 0.83, 0.81), 0.88)
    mat('column',  (0.80, 0.79, 0.77), 0.80)
    mat('floor_wood', (0.30, 0.185, 0.105), 0.28, wood=True, plank=0.19, bump=0.02)          # PF-01 木纹地胶
    mat('floor_grey', (0.50, 0.50, 0.51), 0.40, bump=0.02)                     # PF-02 浅灰地胶
    mat('carpet',  (0.22, 0.23, 0.27), 0.95, bump=0.12)             # CA-05 难燃地毯
    mat('tile',    (0.68, 0.68, 0.67), 0.25)                        # CT-02 地砖
    mat('glass',   (0.86, 0.92, 0.93), 0.02, transmit=1.0, ior=1.46)
    mat('mullion', (0.20, 0.21, 0.23), 0.35, metal=0.85)
    mat('desk_top', (0.50, 0.375, 0.235), 0.26, wood=True, plank=0.75)
    mat('desk_leg', (0.80, 0.80, 0.81), 0.38, metal=0.55)
    mat('screen',  (0.30, 0.36, 0.43), 0.95, bump=0.05)
    mat('seat',    (0.15, 0.16, 0.19), 0.90, bump=0.04)
    mat('metal_dk', (0.14, 0.14, 0.15), 0.40, metal=0.70)
    mat('table',   (0.82, 0.82, 0.81), 0.20)
    mat('counter', (0.20, 0.145, 0.10), 0.35, wood=True, plank=0.30)
    mat('cove',    (1, 1, 1), 0.5, emit=(1.0, 0.96, 0.90), emit_str=3.5)
    mat('panel',   (0.33, 0.245, 0.165), 0.45, wood=True, plank=0.55)
    mat('ground',  (0.20, 0.20, 0.21), 0.95)
    mat('city',    (0.34, 0.35, 0.38), 0.80)


# ---------------------------------------------------------------- 场景构件
def shell():
    sh = M.SHELL
    x0, y0, x1, y1 = sh['x0'], sh['y0'], sh['x1'], sh['y1']
    box('floor_grey', x0, y0, -120, x1 - x0, y1 - y0, 120)          # 楼板
    box('ceiling',    x0, y0, H_CEIL, x1 - x0, y1 - y0, 120)        # 吊顶

    def facade(axis, pos, runs, lo, hi, t=250):
        """axis='H' 横向外墙(沿 X)，'V' 纵向外墙(沿 Y)。runs 为玻璃段。"""
        cuts, p = [], lo
        for a, b in runs:
            if a > p:
                cuts.append((p, a, False))
            cuts.append((a, b, True))
            p = b
        if p < hi:
            cuts.append((p, hi, False))
        for a, b, g in cuts:
            if axis == 'H':
                if g:
                    box('glass', a, pos + 100, 0, b - a, 40, H_CEIL)
                    for u in (a, b):                                 # 竖挺
                        box('mullion', u - 30, pos, 0, 60, t, H_SOFFIT)
                    n = max(1, round((b - a) / 4050))
                    for i in range(1, n):
                        box('mullion', a + (b - a) * i / n - 25, pos, 0, 50, t, H_SOFFIT)
                    box('mullion', a, pos, H_CEIL - 40, b - a, t, 40)
                else:
                    box('wall', a, pos, 0, b - a, t, H_CEIL)
            else:
                if g:
                    box('glass', pos + 100, a, 0, 40, b - a, H_CEIL)
                    for u in (a, b):
                        box('mullion', pos, u - 30, 0, t, 60, H_SOFFIT)
                    n = max(1, round((b - a) / 4050))
                    for i in range(1, n):
                        box('mullion', pos, a + (b - a) * i / n - 25, 0, t, 50, H_SOFFIT)
                    box('mullion', pos, a, H_CEIL - 40, t, b - a, 40)
                else:
                    box('wall', pos, a, 0, t, b - a, H_CEIL)

    facade('H', 101, GLAZ_N, x0, x1)                 # 北立面（内表面 351）
    facade('H', 20900, GLAZ_S, x0, x1)               # 南立面
    facade('V', 51, GLAZ_W, y0, y1)                  # 西立面
    box('wall', 27650, y0, 0, 250, y1 - y0, H_CEIL)  # 东侧核心筒外墙

    for (cx, cy, w, h) in COLS:                      # 结构柱
        box('column', cx, cy, 0, w, h, H_CEIL)

    for (rx0, ry0, rx1, ry1, _n) in KEEP:            # 保留房间：实体墙
        for r in ((rx0, ry0, rx1 - rx0, 150), (rx0, ry1 - 150, rx1 - rx0, 150),
                  (rx0, ry0, 150, ry1 - ry0), (rx1 - 150, ry0, 150, ry1 - ry0)):
            box('wall', r[0], r[1], 0, r[2], r[3], H_CEIL)


def context():
    """窗外环境 —— 没有它玻璃就是一片死白。4 楼约在 +13.35 m。"""
    G = -13350
    box('ground', -120000, -120000, G - 300, 300000, 300000, 300)
    box('city', -40000, -52000, G, 120000,  9000, 34000)      # 北侧对楼
    box('city', -46000, -20000, G,  10000, 70000, 26000)      # 西侧对楼
    box('city', -20000,  56000, G, 100000, 12000, 30000)      # 南侧对楼


def floors():
    """分区地面材质（贴在 z=0 上方 8 mm）。"""
    box('floor_wood', N_ZONE[0], N_ZONE[1], 0,
        N_ZONE[2] - N_ZONE[0], N_ZONE[3] - N_ZONE[1], 8)
    box('floor_grey', S_ZONE[0], SPINE_Y[0], 0,
        SPINE_X_END - S_ZONE[0], SPINE_Y[1] - SPINE_Y[0], 8)         # 主通道
    box('floor_grey', D.SPUR[0], D.SPUR[1], 0,
        D.SPUR[2] - D.SPUR[0], D.SPUR[3] - D.SPUR[1], 8)             # 支通道
    for x0, y0, x1, y1, name, _c, _s in D.ROOMS:
        f = 'tile' if name == '茶水区' else 'carpet'
        box(f, x0 + WALL, y0 + WALL, 0, x1 - x0 - 2 * WALL, y1 - y0 - 2 * WALL, 8)


def _fill_gaps():
    """相邻房间之间的 100 缝隙就是共用隔墙，补上，避免漏光。"""
    R = [(r[0], r[1], r[2], r[3]) for r in D.ROOMS]
    for i, a in enumerate(R):
        for b in R[i + 1:]:
            gx = b[0] - a[2] if b[0] > a[2] else a[0] - b[2]
            gy = b[1] - a[3] if b[1] > a[3] else a[1] - b[3]
            oy = min(a[3], b[3]) - max(a[1], b[1])
            ox = min(a[2], b[2]) - max(a[0], b[0])
            if 0 < gx <= 120 and oy > 0:
                x = min(a[2], b[2])
                box('wall', x, max(a[1], b[1]), 0, gx, oy, H_CEIL)
            if 0 < gy <= 120 and ox > 0:
                y = min(a[3], b[3])
                box('wall', max(a[0], b[0]), y, 0, ox, gy, H_CEIL)


def rooms():
    _fill_gaps()
    """南区新建房间：下半实墙 + 上半玻璃（走道侧全玻），门洞 900×2700。"""
    for x0, y0, x1, y1, name, _c, side in D.ROOMS:
        dx, dy = D.door_of((x0, y0, x1, y1, name, _c, side))
        glassy = {'N': 'N', 'E': 'E', 'W': 'W', 'S': 'S'}[side]      # 开门那一侧做玻璃隔断
        for s in ('N', 'S', 'W', 'E'):
            if s == 'N':
                ax, ay, aw, ah, horiz = x0, y0, x1 - x0, WALL, True
            elif s == 'S':
                ax, ay, aw, ah, horiz = x0, y1 - WALL, x1 - x0, WALL, True
            elif s == 'W':
                ax, ay, aw, ah, horiz = x0, y0, WALL, y1 - y0, False
            else:
                ax, ay, aw, ah, horiz = x1 - WALL, y0, WALL, y1 - y0, False
            gl = (s == glassy)
            # 门洞
            if gl:
                d0 = (dx - 450) if horiz else (dy - 450)
                segs = [((ax, ax + (d0 - ax)) if horiz else (ay, d0)),
                        ((d0 + 900, ax + aw) if horiz else (d0 + 900, ay + ah))]
            else:
                segs = [((ax, ax + aw) if horiz else (ay, ay + ah))]
            for a, b in segs:
                if b - a <= 1:
                    continue
                if horiz:
                    if gl:
                        box('wall', a, ay, 0, b - a, ah, 100)
                        box('glass', a + 40, ay + 40, 100, b - a - 80, 20, H_CEIL - 100)
                        box('mullion', a, ay, H_CEIL - 60, b - a, ah, 60)
                        for u in (a, b - 60):
                            box('mullion', u, ay, 0, 60, ah, H_CEIL)
                    else:
                        box('wall', a, ay, 0, b - a, ah, H_CEIL)
                else:
                    if gl:
                        box('wall', ax, a, 0, aw, b - a, 100)
                        box('glass', ax + 40, a + 40, 100, 20, b - a - 80, H_CEIL - 100)
                        box('mullion', ax, a, H_CEIL - 60, aw, b - a, 60)
                        for u in (a, b - 60):
                            box('mullion', ax, u, 0, aw, 60, H_CEIL)
                    else:
                        box('wall', ax, a, 0, aw, b - a, H_CEIL)
            if gl:   # 门洞上方亮子
                if horiz:
                    box('glass', dx - 410, ay + 40, H_DOOR, 820, 20, H_CEIL - H_DOOR - 60)
                else:
                    box('glass', ax + 40, dy - 410, H_DOOR, 20, 820, H_CEIL - H_DOOR - 60)


def chair(cx, cy, facing):
    """一把办公转椅：座 + 背 + 气杆 + 五星脚。"""
    s = 1 if facing == 'N' else -1
    box('seat', cx - 240, cy - 240, 430, 480, 480, 60)               # 座面
    box('seat', cx - 230, cy + s * 230 - 30, 490, 460, 60, 480)      # 靠背
    cyl('metal_dk', cx, cy, 60, 35, 370)
    for i in range(5):
        a = 2 * math.pi * i / 5 + 0.4
        box('metal_dk', cx + 250 * math.cos(a) - 30, cy + 250 * math.sin(a) - 30, 30, 60, 60, 40)
    cyl('metal_dk', cx, cy, 20, 120, 40, seg=16)


def desks():
    dw, dd = D.DESK
    for d in D.NF.desks:
        box('desk_top', d.x, d.y, 720, dw, dd, 30)
        for ux in (d.x + 90, d.x + dw - 140):
            for uy in (d.y + 80, d.y + dd - 130):
                box('desk_leg', ux, uy, 0, 50, 50, 700)
            box('desk_leg', ux, d.y + 90, 660, 50, dd - 180, 55)
        # 背靠背屏风
        if d.facing == 'N':
            box('screen', d.x, d.y + dd - 30, 750, dw, 60, 450)
        cy = d.y - 620 if d.facing == 'N' else d.y + dd + 620
        chair(d.x + dw / 2, cy, 'S' if d.facing == 'N' else 'N')
    # 打印 / 储物 / 电话亭
    sx0, sy0, sx1, sy1 = D.SVC
    box('panel', sx0, sy0, 0, 700, sy1 - sy0 - 200, 1800)
    box('panel', sx0 + 900, sy0, 0, 1200, 1200, 2200)


def meeting():
    for x0, y0, x1, y1, name, cap, _s in D.ROOMS:
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        if name.startswith('洽谈') and 'Ø900' in cap:
            cyl('table', cx, cy, 730, 450, 30)
            cyl('metal_dk', cx, cy, 0, 60, 730)
            cyl('metal_dk', cx, cy, 0, 250, 30, seg=24)
            for i in range(4):
                a = 2 * math.pi * i / 4 + math.pi / 4
                chair(cx + 900 * math.cos(a), cy + 900 * math.sin(a),
                      'N' if math.sin(a) < 0 else 'S')
        elif name == '洽谈间 D':
            box('table', cx - 800, cy - 450, 730, 1600, 900, 30)
            for i in range(3):
                chair(cx - 550 + i * 550, cy - 1000, 'S')
                chair(cx - 550 + i * 550, cy + 1000, 'N')
        elif name in ('大会议室', '中会议室'):
            tw, td, per = (5050, 1800, 6) if name == '大会议室' else (1500, 4100, 5)
            if name == '大会议室':
                box('table', cx - tw / 2, cy - td / 2, 730, tw, td, 40)
                for i in range(per):
                    px = cx - tw / 2 + tw * (i + 0.5) / per
                    chair(px, cy - td / 2 - 620, 'S')
                    chair(px, cy + td / 2 + 620, 'N')
                chair(cx - tw / 2 - 700, cy, 'S')
                chair(cx + tw / 2 + 700, cy, 'N')
                box('panel', cx - 1400, y0 + WALL + 20, 900, 2800, 60, 1600)   # 屏幕墙
            else:
                box('table', cx - tw / 2, cy - td / 2, 730, tw, td, 40)
                for i in range(per):
                    py = cy - td / 2 + td * (i + 0.5) / per
                    chair(cx - tw / 2 - 620, py, 'S')
                    chair(cx + tw / 2 + 620, py, 'N')
                box('panel', cx - 800, y0 + WALL + 20, 900, 1600, 60, 900)
        elif name == '茶水区':
            box('counter', x0 + 300, y1 - WALL - 700, 0, x1 - x0 - 600, 600, 900)
            box('table', x0 + 300, y1 - WALL - 720, 900, x1 - x0 - 600, 640, 40)
            for i in range(6):
                px = x0 + 700 + i * 1000
                cyl('metal_dk', px, y1 - WALL - 1300, 0, 180, 750, seg=16)
                cyl('seat', px, y1 - WALL - 1300, 750, 190, 60, seg=20)
            box('panel', x0 + WALL, y0 + WALL, 0, 700, 700, 2100)             # 高柜


def lights():
    w = bpy.context.scene.world
    if w is None:
        w = bpy.data.worlds.new('W')
        bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    sky = nt.nodes.new('ShaderNodeTexSky')
    sky.sky_type = 'NISHITA'
    sky.sun_elevation = math.radians(52)
    sky.sun_rotation = math.radians(200)      # 太阳在南 —— 北窗只进天空漫射光
    sky.altitude = 60
    sky.air_density, sky.dust_density = 1.0, 1.4
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = 0.32
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(sky.outputs['Color'], bg.inputs['Color'])
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])

    for a, b in GLAZ_N:                                   # 北窗灯槽（DWG 实测 2800）
        box('cove', a, 420, 2800, b - a, 120, 50)
    flush(bevel=0)

    def area(x, y, size, power):
        d = bpy.data.lights.new('L', 'AREA')
        d.shape, d.size, d.energy = 'SQUARE', size, power
        d.color = (1.0, 0.97, 0.93)
        o = bpy.data.objects.new('L', d)
        o.location = (m(x), -m(y), m(H_CEIL - 20))
        bpy.context.collection.objects.link(o)
        cyl('cove', x, y, H_CEIL - 22, 80, 18, seg=16)              # 可见筒灯 Ø160

    for gx in range(1200, 18000, 2600):                       # 北区
        for gy in range(1200, 10400, 2600):
            area(gx, gy, 1.1, 26)
    for x0, y0, x1, y1, name, _c, _s in D.ROOMS:              # 南区各房间
        nx = max(1, int((x1 - x0) // 2600))
        ny = max(1, int((y1 - y0) // 2600))
        for i in range(nx):
            for j in range(ny):
                area(x0 + (x1 - x0) * (i + .5) / nx, y0 + (y1 - y0) * (j + .5) / ny, 1.0, 30)
    for gy in range(11200, 21000, 2400):                      # 通道
        area(3700, gy, 0.8, 18)
    for gx in range(1000, 12800, 2400):
        area(gx, 10949, 0.8, 18)
    flush(bevel=0)


# ---------------------------------------------------------------- 相机
VIEWS = {
    #             眼点 (x, y, z)            看向 (x, y, z)          焦距
    'n_open':   ((16900,  7150, 1600), ( 2200,  3000, 1050), 20),   # 斜穿全区，右侧为北窗
    'n_window': (( 1150,  4300, 1500), (15000,  1900, 1250), 24),   # 贴窗工位带
    'big_mr':   ((  850, 15100, 1450), ( 7300, 18150, 1000), 20),   # 大会议室（向玻璃门墙看）
    'mid_mr':   ((11900, 20300, 1500), ( 9600, 15000, 1150), 24),   # 中会议室
    'spine':    ((  400, 10949, 1550), (12600, 11550, 1350), 24),   # 南区主通道
    'pantry':   (( 6800, 19050, 1450), (  200, 20300, 1000), 24),   # 茶水区
}


def camera(view):
    ex, ey, ez = VIEWS[view][0]
    tx, ty, tz = VIEWS[view][1]
    cd = bpy.data.cameras.new('C')
    cd.lens, cd.sensor_width = VIEWS[view][2], 36
    cd.clip_start = 0.05
    ob = bpy.data.objects.new('C', cd)
    ob.location = (m(ex), -m(ey), m(ez))
    d = Vector((m(tx) - m(ex), -m(ty) + m(ey), m(tz) - m(ez)))
    yaw = math.atan2(d.y, d.x) - math.pi / 2
    pitch = math.atan2(d.z, math.hypot(d.x, d.y))
    ob.rotation_euler = (math.pi / 2 + pitch, 0, yaw)     # 保持水平摇摄，竖线不倾斜
    bpy.context.collection.objects.link(ob)
    bpy.context.scene.camera = ob
    return ob


def build():
    clear()
    materials()
    shell(); context(); floors(); rooms(); desks(); meeting()
    flush()
    lights()


def render(view, W=1600, H=1000, samples=128):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 8
    sc.cycles.transmission_bounces = 8
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    sc.render.resolution_x, sc.render.resolution_y = W, H
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    sc.view_settings.exposure = -0.05
    camera(view)
    os.makedirs(OUT, exist_ok=True)
    sc.render.filepath = os.path.join(OUT, f'{view}.png')
    bpy.ops.render.render(write_still=True)
    return sc.render.filepath


if __name__ == '__main__':
    a = sys.argv[1:]
    v = a[0] if a and not a[0].startswith('-') else 'n_open'
    g = lambda k, d: int(a[a.index(k) + 1]) if k in a else d
    W, H, S = g('--w', 1600), g('--h', 1000), g('--s', 128)
    build()
    for name in (list(VIEWS) if v == 'all' else [v]):
        print('>>>', name, render(name, W, H, S))
