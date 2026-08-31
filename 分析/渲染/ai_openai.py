# -*- coding: utf-8 -*-
"""把方案 D 的渲染图交给 OpenAI 图像 API 转成照片质感。

**在你自己的机器上跑**，不要在这个容器里跑 —— 容器的网络策略封了 api.openai.com，
而且 API key 不该落到别人的机器上。

    pip install openai pillow
    export OPENAI_API_KEY=sk-...            # Windows: set OPENAI_API_KEY=sk-...
    python ai_openai.py                     # 六张全跑
    python ai_openai.py 01                  # 只跑第 1 张
    python ai_openai.py 04 --quality high --n 3

────────────────────────────────────────────────────────────────────────
先说清楚一件事：**OpenAI 的图像 API 没有 ControlNet。**

同目录 AI条件图/ 里的深度图、线稿是给 Stable Diffusion / FLUX 的 ControlNet 用的，
OpenAI 这条路用不上它们。gpt-image-1 走的是「看着这张图重画一张」，
没有重绘幅度、没有深度约束 —— 所以它会把材质和光感做得很像照片，
但**几何会漂**：工位数量、通道宽度、幕墙分格都可能被改掉。

结论：
  · 要「感觉」「材质基调」「给业主看氛围」  → 用这个脚本，快且省事
  · 要「尺寸能对上、能当方案依据」          → 走 ComfyUI + ControlNet depth（见 AI条件图/README.md）

出图后务必按 README 最后一节核那三条（工位 50 个 / 通道 1800·1400 / 幕墙 4050 落地玻璃）。
────────────────────────────────────────────────────────────────────────
"""
import argparse
import base64
import io
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / 'AI成图'

COMMON = (
    "Interior architectural photography, 24 mm tilt-shift lens, two-point perspective with "
    "perfectly straight vertical lines, soft overcast daylight from floor-to-ceiling glazing "
    "mixed with 4000 K recessed downlights, realistic material response, muted warm neutral "
    "palette, natural dynamic range, crisp detail, no text, no signage, no CG or 3D-render look."
)

KEEP = (
    'The reference image is a SIMPLIFIED MASSING MODEL, not a finished render. Every plain block in '
    'it is a placeholder standing for a real object at that exact position, size and orientation. '
    'Replace each placeholder with properly detailed real-world furniture and fittings: ergonomic '
    'mesh-back task chairs with contoured seats, adjustable armrests, gas lift and five-star castor '
    'bases; bench desk systems with slim square legs, under-desk cable trays and cable grommets; '
    'fabric acoustic desk screens with slim aluminium edge trim; slim-bezel monitors on articulated '
    'arms, keyboards and mice; a few believable personal items. '
    'Keep unchanged: the camera and framing, the room shape, the number of desks and chairs, the '
    'aisle widths, the ceiling height, and the window mullion spacing. '
    'The result must read as a photograph of a completed, occupied office — never as a 3D render, '
    'never with blocky simplified furniture.'
)

VIEWS = {
    '01': ('01_北区工位全景.jpg',
           "A modern open-plan office floor: three bands of back-to-back light oak bench desks "
           "with soft grey-blue fabric privacy screens, black mesh task chairs, wide-plank warm "
           "oak vinyl flooring, flat white plaster ceiling with small recessed downlights and a "
           "linear cove light along the window, floor-to-ceiling curtain wall on the right, "
           "oak-slatted storage volume on the left."),
    '02': ('02_贴窗工位带.jpg',
           "A workstation row along a floor-to-ceiling glazed facade: light oak bench desks, "
           "grey-blue fabric screens, warm oak plank flooring, bright diffuse north daylight "
           "washing across the desktops, linear cove light above the glazing, white ceiling with "
           "recessed downlights, slim black aluminium mullions at 4 metre spacing."),
    '03': ('03_南区主通道.jpg',
           "A wide office circulation spine: light grey vinyl floor, open-plan oak bench desks on "
           "the left, full-height frameless glass meeting-room partitions with slim dark aluminium "
           "frames on the right, white plaster ceiling with recessed downlights, warm oak flooring "
           "visible in the open office beyond the glass."),
    '04': ('04_大会议室.jpg',
           "A corporate boardroom: long light grey conference table for fourteen with slab legs, "
           "dark grey mesh executive chairs, dark blue-grey loop carpet, white plaster walls, a "
           "large wall-mounted display screen, a full-height glass partition wall with slim dark "
           "frames looking out to the office beyond, recessed downlights and wall grazing light."),
    '05': ('05_中会议室.jpg',
           "A medium meeting room for twelve: light grey rectangular conference table, dark grey "
           "mesh chairs, blue-grey loop carpet, wall-mounted display screen on a white plaster "
           "wall, full-height glazed partition on one side with the open office visible beyond, "
           "recessed downlights."),
    '06': ('06_茶水区.jpg',
           "A narrow office pantry and coffee bar: long dark walnut bar counter with a pale stone "
           "worktop, round upholstered bar stools, large-format light grey floor tiles, white "
           "plaster walls, an oak-slatted tall cabinet at the end, recessed downlights, "
           "calm minimal styling."),
}

# gpt-image-1 支持的画幅：1024×1024 / 1536×1024 / 1024×1536。
# 渲染图是 1500×940（1.60:1），最接近 1536×1024（1.50:1），送之前先中心裁到 3:2。
SIZE = '1536x1024'


def prep(path):
    """中心裁成 3:2 并缩到 1536×1024，返回 PNG 字节。"""
    from PIL import Image
    im = Image.open(path).convert('RGB')
    w, h = im.size
    tw = int(h * 1.5)
    if tw <= w:
        x = (w - tw) // 2
        im = im.crop((x, 0, x + tw, h))
    else:
        th = int(w / 1.5)
        y = (h - th) // 2
        im = im.crop((0, y, w, y + th))
    im = im.resize((1536, 1024), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'PNG')
    buf.seek(0)
    buf.name = 'ref.png'          # SDK 用文件名判断 MIME
    return buf


def run(key, prompt, ref, quality, n):
    from openai import OpenAI
    client = OpenAI(api_key=key)
    r = client.images.edit(
        model='gpt-image-1',
        image=ref,
        prompt=prompt,
        size=SIZE,
        quality=quality,
        n=n,
        input_fidelity='high',    # 尽量贴合参考图；若 SDK 版本不支持就删掉这一行
    )
    return [base64.b64decode(d.b64_json) for d in r.data]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('view', nargs='?', default='all', help='01~06，或 all')
    ap.add_argument('--quality', default='high', choices=['low', 'medium', 'high'])
    ap.add_argument('--n', type=int, default=1, help='每个视角出几张')
    ap.add_argument('--dry-run', action='store_true', help='只打印提示词、不调 API')
    a = ap.parse_args()

    key = os.environ.get('OPENAI_API_KEY')
    if not key and not a.dry_run:
        sys.exit('请先设置 OPENAI_API_KEY')

    todo = list(VIEWS) if a.view == 'all' else [a.view]
    OUT.mkdir(exist_ok=True)
    for v in todo:
        if v not in VIEWS:
            sys.exit(f'没有视角 {v}，可选：{", ".join(VIEWS)}')
        fname, scene = VIEWS[v]
        src = HERE / fname
        if not src.exists():
            sys.exit(f'找不到 {src}')
        prompt = f'{scene}\n\n{COMMON}\n\n{KEEP}'
        print(f'\n=== {v} {fname} ===')
        if a.dry_run:
            print(prompt)
            continue
        try:
            imgs = run(key, prompt, prep(src), a.quality, a.n)
        except Exception as e:
            print(f'  ✗ 失败：{e}')
            continue
        for i, raw in enumerate(imgs):
            p = OUT / (fname.replace('.jpg', '') + (f'_AI{i+1}.png' if a.n > 1 else '_AI.png'))
            p.write_bytes(raw)
            print(f'  ✓ {p}')


if __name__ == '__main__':
    main()
