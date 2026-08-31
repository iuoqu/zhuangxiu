# 4F 方案 D · AI 出图（Vercel）

一个带四位门禁码的小页面：选视角 → 改提示词 → 调 OpenAI 出图 → 左右滑块和渲染底图对比。
`OPENAI_API_KEY` 和门禁码都只存在服务端环境变量里，**不会下发到浏览器**。

## 部署

1. 把这个仓库连到 Vercel（New Project → Import Git Repository）
2. **Root Directory 填 `ai-web`** —— 这一步不能漏，否则 Vercel 会去仓库根目录找
3. Framework Preset 选 **Other**，Build Command 和 Output Directory 都留空
   （纯静态 ＋ Serverless Function，不需要构建）
4. Environment Variables 加两条：

   | Key | Value | 说明 |
   |---|---|---|
   | `OPENAI_API_KEY` | `sk-...` | 你的 OpenAI key |
   | `PIN` | 四位数字，如 `4816` | 门禁码 |

5. Deploy。之后改环境变量要 **Redeploy** 才生效。

命令行部署同理：

```bash
npm i -g vercel
cd ai-web
vercel                      # 首次会问 Root Directory，确认是当前目录
vercel env add OPENAI_API_KEY
vercel env add PIN
vercel --prod
```

## 关于那个四位门禁码 —— 请务必看完

**它挡得住路人，挡不住有心人。** 四位数字只有 1 万种组合。我做了两件事拖慢暴力破解：
服务端用 `timingSafeEqual` 做常数时间比较，猜错强制等 1.2 秒。但这只是拖延，不是防护。

**真正的护栏是下面两条，请一定做：**

1. **在 OpenAI 后台给这把 key 设消费上限**（Billing → Limits）。就算门禁被撞开，损失也封顶。
2. 给这把 key **单独建一个、只用于这个页面**，别用主账号的万能 key。

如果这页要对外发链接，更稳的做法是开 **Vercel 自带的 Deployment Protection**
（Settings → Deployment Protection → Password Protection / Vercel Authentication），
那是平台层的，比页面级门禁强得多。我这个门禁的定位是「同事之间图个方便」。

## 可能踩到的坑

| 现象 | 原因 / 处理 |
|---|---|
| 生成到一半 504 | 函数超时。`vercel.json` 里写的是 `maxDuration: 300`，但**各套餐上限不同**，Hobby 可能吃不满。先把画质降到 `medium` 或 `low`；还不行就用本地脚本 `../分析/渲染/ai_openai.py` |
| `unknown parameter input_fidelity` | 后端已经会自动退回不带该参数重试一次，正常看不到。若持续报错，删掉 `api/generate.js` 里那一行即可 |
| 403 / 提示组织未验证 | gpt-image-1 需要 OpenAI 组织完成身份验证，到后台 Settings → Organization 做一下 |
| 图出来了但工位数不对 | 见下一节 |

## 出图后必须核这三条

gpt-image-1 **没有 ControlNet**，是「看着参考图重画一张」，没有重绘幅度、没有深度约束。
提示词里已经写死「不许增删移动任何家具、不许改工位数」，能压一部分，压不住全部：

1. **工位 50 个**（北区 3 带 × 9/9/7）—— AI 最爱自己加桌子
2. **主通道 1800、纵向支通道 1400** —— 常被画窄
3. **幕墙 4050 分格、落地玻璃无窗下墙** —— 常被画成有窗台的普通窗

页面上的左右滑块就是干这个用的：拖动对比渲染底图和 AI 出图，几何漂没漂一眼能看出来。

**要尺寸能当方案依据，走 ComfyUI + ControlNet depth** —— 条件图和参数在
`../分析/渲染/AI条件图/README.md`。这个页面的定位是快速看氛围和材质基调。

## 目录

```
ai-web/
  api/generate.js         Serverless Function：校验门禁 → 调 OpenAI → 返回 base64
  public/index.html       整个界面（无构建，原生 JS/CSS）
  public/refs/01~06.jpg   Blender/Cycles 渲染底图（送给 OpenAI 的参考图）
  public/lines/01~06.png  线稿（勾选「附加线稿」时一起送，实验性）
  vercel.json             maxDuration 300 ＋ includeFiles，保证函数读得到 public/
```
