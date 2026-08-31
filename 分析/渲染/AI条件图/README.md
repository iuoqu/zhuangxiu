# AI 出图条件图（方案 D）

这套图是给 **AI 生成器做几何约束**用的 —— 让 AI 画出照片质感，但**构图和尺寸严格锁死在方案 D 的真实平面上**，
不会像纯文字生图那样画出一个不存在的房间。

所有图由 `分析/render.py --passes` 从同一个三维场景一次导出，与 `../01~06_*.jpg` 六张渲染成图**逐像素对齐**。
分辨率 1500×940。几何来自 `plan_model.py` ＋ `scheme_d.py`，竖向为 `03.4F-立面系统图.dwg` 实测标高。

---

## 四种图各自干什么

| 后缀 | 喂给哪个 ControlNet | 作用 | 建议权重 |
|---|---|---|---|
| `_深度.png` | `depth`（depth_anything / midas / zoe） | **最重要**。锁住空间进深、家具前后关系 | 0.75 ~ 1.0 |
| `_线稿.png` | `lineart` / `mlsd` / `canny` | 锁住墙线、家具轮廓、幕墙分格 | 0.4 ~ 0.6 |
| `_法线.png` | `normalbae` | 锁住表面朝向，配合重打光 | 0.3 ~ 0.5（可不用） |
| `_分区掩码.png` | 不直接喂 ControlNet | 在 PS / ComfyUI 里做**选区**：单独改地面材质、单独调玻璃 | — |

> 深度图为**近白远黑**（ControlNet depth 惯例），每个视角按房间实际进深单独定标
> （大空间 15~17 m，会议室 / 茶水区 8~9 m），所以小房间也有足够的明暗对比。
> 法线图已转成**相机空间**（R=右 G=上 B=朝向镜头）。

### 分区掩码的颜色对照

| 颜色 | 部位 | 颜色 | 部位 |
|---|---|---|---|
| 白 250 | 吊顶 | 蓝 (60,170,230) | 玻璃（幕墙＋隔断） |
| 浅灰 190 | 墙 | 深蓝灰 (30,30,40) | 幕墙竖挺 / 边框 |
| 灰 150 | 结构柱 | 橙 (230,160,60) | 工位桌面 |
| 棕 (120,70,35) | 木纹地胶（北区） | 米黄 (250,210,120) | 会议桌 |
| 灰蓝 (95,95,100) | 浅灰地胶（通道） | 蓝灰 (90,130,170) | 工位屏风 |
| 紫灰 (70,60,95) | 地毯（会议 / 洽谈） | 红 (220,60,60) | 座椅 |
| 灰 (140,140,150) | 地砖（茶水区） | 深棕 (150,90,45) | 吧台 |
| 棕黄 (170,110,60) | 木饰面 / 储物 | 近黑 (20,20,25) | 显示屏 |

---

## 怎么用

### 路线 A：ComfyUI / WebUI（可控性最高，推荐）

1. 底模选**室内擅长**的：SDXL 系（如 RealVisXL、Juggernaut XL）或 FLUX.1-dev
2. txt2img ＋ 两个 ControlNet：
   - `depth`，权重 **0.85**，起止 0 ~ 0.85
   - `lineart`，权重 **0.5**，起止 0 ~ 0.6
3. 分辨率 1500×940 直接跑（SDXL 可 1216×768 出图再放大）
4. 采样 30 步，CFG 4.5~6

### 路线 B：img2img 保底（最省事，最稳）

直接拿 `../01~06_*.jpg` 六张渲染图做 img2img：
**重绘幅度 0.45 ~ 0.6** ＋ `depth` 权重 0.6。
幅度低于 0.4 只是加噪点；高于 0.65 家具位置就开始漂。

### 路线 C：OpenAI（ChatGPT）API —— 省事，但几何锁不住

脚本：**`../ai_openai.py`**（在你自己的机器上跑）

```bash
pip install openai pillow
export OPENAI_API_KEY=sk-...
python ai_openai.py            # 六张全跑
python ai_openai.py 04 --n 3   # 单张出 3 个方案
python ai_openai.py --dry-run  # 只看提示词，不花钱
```

⚠️ **OpenAI 的图像 API 没有 ControlNet**，本目录这些深度图 / 线稿它用不上。
`gpt-image-1` 走的是「看着参考图重画一张」，没有重绘幅度、没有深度约束 ——
材质和光感会很像照片，但**几何会漂**：工位数量、通道宽度、幕墙分格都可能被改掉。
脚本里已经把「不许增删移动任何家具、不许改工位数」写进提示词，能压一部分，压不住全部。

所以：**要氛围用它，要尺寸用路线 A。**

### 路线 D：国内工具

- **D5 Render / Enscape 的 AI 渲染** —— 支持直接导入深度/线稿做约束，出图快，装饰行业用得多
- **即梦 / 堆友（阿里）** —— 有"线稿生图""参考图控图"，把线稿图当参考图，风格强度调到 60~70%
- **Midjourney** —— 只能用图生图（`--iw 2`），**几何锁不住**，只适合找风格不适合定方案

---

> 想要几何真正锁死又不想自己搭 ComfyUI，可以用带 ControlNet 的托管服务（fal.ai、Replicate 等），
> 或阿里云百炼 / 通义万相的线稿生图。判断标准只有一条：**这个工具收不收深度图或线稿**。
> 收 → 几何能锁；只收「参考图」→ 就会漂。

## 提示词（英文，直接粘）

**通用负面提示词**

```
fisheye, distorted vertical lines, warped perspective, people, human figures, text, watermark,
signage, oversaturated, HDR halo, cartoon, illustration, 3d render look, plastic materials,
cluttered, messy cables, blurry, lowres, deformed furniture
```

**通用后缀**（接在每条正面词后面）

```
interior architectural photography, 24mm tilt-shift lens, two-point perspective, vertical lines
perfectly straight, soft overcast daylight from floor-to-ceiling glazing mixed with 4000K recessed
downlights, realistic material response, muted warm neutral palette, high dynamic range but natural,
crisp detail, shot on Sony A7R IV, f/8
```

### 01 北区工位全景

```
photograph of a modern open-plan office floor, three bands of back-to-back light oak bench desks
with soft grey-blue fabric privacy screens, black mesh task chairs, wide-plank warm oak vinyl
flooring, flat white plaster ceiling with small recessed downlights and a linear cove light along
the window, floor-to-ceiling curtain wall on the right, oak-slatted storage volume on the left
```

### 02 贴窗工位带

```
photograph of a workstation row along a floor-to-ceiling glazed facade, light oak bench desks,
grey-blue fabric screens, warm oak plank flooring, bright diffuse north daylight washing across
the desktops, linear cove light above the glazing, white ceiling with recessed downlights,
slim black aluminium mullions at 4 metre spacing
```

### 03 南区主通道

```
photograph of a wide office circulation spine, light grey vinyl floor, open-plan oak bench desks
on the left, full-height frameless glass meeting-room partitions with slim dark aluminium frames
on the right, white plaster ceiling with recessed downlights, warm oak flooring visible in the
open office beyond the glass
```

### 04 大会议室

```
photograph of a corporate boardroom, long light grey conference table for fourteen with slab legs,
dark grey mesh executive chairs, dark blue-grey loop carpet, white plaster walls, large wall-mounted
display screen, full-height glass partition wall with slim dark frames looking out to the office
beyond, recessed downlights and a wall grazing light
```

### 05 中会议室

```
photograph of a medium meeting room for twelve, light grey rectangular conference table, dark grey
mesh chairs, blue-grey loop carpet, wall-mounted display screen on a white plaster wall,
full-height glazed partition on one side with the open office visible beyond, recessed downlights
```

### 06 茶水区

```
photograph of a narrow office pantry and coffee bar, long dark walnut bar counter with a pale stone
worktop, round upholstered bar stools, large-format light grey floor tiles, white plaster walls,
oak-slatted tall cabinet at the end, recessed downlights, calm minimal styling
```

---

## 出图后必须核对的三件事

AI 会"顺手美化"，这三处一旦被改掉，图就不能当方案依据了：

1. **工位数**（北区应为 3 带 × 9/9/7 列 = **50 个**）—— AI 常会自己加桌子
2. **通道宽度**（主通道 1800、纵向支通道 1400）—— 常被画窄
3. **幕墙分格 4050、无窗下墙（落地玻璃）** —— 常被画成有窗台的普通窗

对不上就降重绘幅度、或把 depth 权重加到 1.0 重跑。
