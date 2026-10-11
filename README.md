# video-lab

用代码生成视频：画面全部由 HTML/CSS/SVG 绘制，不碰剪辑软件、不用素材库。

**一期一个文件夹**，放在 `videos/` 下。当前样片：
`videos/001-mbti-funcs/out/001-mbti-funcs.mp4` —— MBTI 认知功能雷达图，30 秒。

## 目录

```
video-lab/
├─ tools/                    引擎，各期共用
│  ├─ tts.py  render.mjs  compose.mjs  burn.mjs  probe.mjs
│  ├─ episode.mjs            期目录的路径契约
│  └─ assets/                base.css / common.js / radar.js
└─ videos/
   └─ 001-mbti-funcs/
      ├─ script.json         ✓ 进 git ← 改内容改这里
      ├─ scenes/s1..s5.html  ✓ 进 git ← 画面代码
      ├─ audio/              ✗ 生成物（配音 + 时间戳）
      ├─ build/              ✗ 生成物（帧序列等中间产物）
      └─ out/                ✗ 成片 + 字幕
```

进 git 的只有**配方**：引擎、文案、画面代码。配音、帧序列、成片都能由脚本重跑，全忽略。
推论：新机器 clone 下来得先联网跑一次 `tts.py`，才能渲染。

## 管线

```
script.json          分镜稿（口播文本 + 雷达图数据）
     │
     ├─ tts.py       edge-tts 逐镜头配音 → audio/*.mp3 + 句级时间戳
     │
     ├─ scenes/*.html   每镜一个场景，动画写成 render(t) 的纯函数
     │
     ├─ render.mjs   Playwright 逐帧设 t 并截图 → build/<shot>/f00000.png
     │
     └─ compose.mjs  ffmpeg 拼帧 + 混音 + 生成 SRT → out/<期名>.mp4
                              │
                         burn.mjs  ffmpeg 烧硬字幕 → out/<期名>-box.mp4
```

**为什么不录屏**：动画是 `render(t)` 的纯函数，同一个 `t` 永远出同一帧。
所以不会掉帧、不会抖动，还能只重渲某一个镜头，或者改了配色批量重出。

## 跑一遍

两种方式都行：把期目录当第一个参数传，或者 `cd` 进去跑（脚本自己认当前目录）。

```bash
# 从仓库根
./.venv/bin/python tools/tts.py videos/001-mbti-funcs   # 1. 配音 + 时间戳
node tools/render.mjs videos/001-mbti-funcs full        # 2. 逐帧渲染（879 帧，实测约 35 秒）
node tools/compose.mjs videos/001-mbti-funcs            # 3. 合成成片
node tools/burn.mjs videos/001-mbti-funcs box           # 4. 烧硬字幕

# 或者
cd videos/001-mbti-funcs
node ../../tools/render.mjs full s3                     # 只重渲一个镜头
```

只想看某个镜头长什么样（出 5 张样帧，秒级）：

```bash
node tools/render.mjs videos/001-mbti-funcs stills s3
node tools/probe.mjs videos/001-mbti-funcs/build/preview/s3_t5_9.png 960,450 100,100
```

**怎么看画面**：看成片 `out/<期名>.mp4`（连起来看，和观众看到的一样），
或者 `stills` 出几张 PNG 单看某一镜。

> **双击 `scenes/s1.html` 是白屏的**，这不是坏了。这些文件是"帧函数"而不是网页 ——
> 它们用根绝对路径（`/tools/assets/…`）引用共用资产，靠渲染器注入 `window.FUNCS`，
> 而且初始状态本来就是 `opacity: 0`，全靠 `window.render(t)` 把画面画出来。
> 没有能直接双击打开的形式；要看就出帧，或者看成片。

**认不出来就报错，不会默默猜。** 期目录名打错会直接说找不到，而不是回退到当前目录
渲染错的一期 —— 后者最坏，要等成片出来才发现。

## 新开一期

```bash
cp -r videos/001-mbti-funcs videos/002-xxx
rm -rf videos/002-xxx/{audio,build,out}    # 那是上一期的产物
# 然后改 script.json 的文案/数据，改 scenes/*.html 的画面
```

成片名自动跟着期目录名走（`out/002-xxx.mp4`），不用改代码。
期目录名只能用字母、数字、点、下划线、连字符 —— 它会进 ffmpeg 的滤镜语法。

## 文件

| 路径 | 作用 |
|---|---|
| `videos/<期>/script.json` | **改内容改这里**。口播文本、雷达图八项数据、音色、语速、前导/尾留白 |
| `videos/<期>/scenes/s*.html` | 每期的镜头，各自暴露 `window.render(t)` |
| `videos/<期>/audio/timing.json` | 句级时间戳（配音的副产物，动画时间轴靠它） |
| `tools/episode.mjs` | 期目录的路径契约 —— 所有路径只在这里定义一次 |
| `tools/serve.mjs` | 渲染器用的只读静态服务（只把仓库内的文件喂给浏览器） |
| `tools/render.mjs` | 逐帧渲染器 |
| `tools/compose.mjs` | ffmpeg 合成 + 字幕生成 |
| `tools/burn.mjs` | 烧硬字幕 |
| `tools/probe.mjs` | 取 PNG 指定坐标的颜色，用来验证「东西真的画出来了」 |
| `tools/assets/base.css` | 配色 token、字体、画布尺寸 |
| `tools/assets/radar.js` | 雷达图绘制 + 缓动函数，只负责画不管时间 |
| `tools/assets/common.js` | 颜色插值、高亮包络 |
| `videos/<期>/build/preview/` | 样帧 |

## 改动的常见姿势

- **改文案** → 编辑 `script.json` 的 `vo`，重跑 `tts.py`。
  镜头时长由语音时长自动推导（`前导 0.35s + 语音 + 尾留白 0.65s`），不用手调。
  注意：重跑会让时间轴整体漂移，`scenes/s3.html` 里手调的时间点（0.45/2.53/4.41/6.91 秒）
  是按当时的配音调出来的，得跟着重调。
- **换音色** → 改 `script.json` 的 `voice`，重跑 `tts.py`。画面不用重渲。
- **换配色** → 改 `tools/assets/base.css` 的 CSS 变量。改完务必重跑配色校验（见下）。
- **只改一个镜头** → `node tools/render.mjs videos/<期> full s3`，再接 `compose.mjs`。
  （只重渲用到的镜头，其余镜头的帧原样留着，比全量快。）
- **调字幕位置** → 改 `script.json` 的 `subtitle`：`{ "fontSize": 56, "marginV": 64 }`。
  `burn.mjs` 把 `PlayResX/Y` 钉成了画布尺寸，所以这两个数是**真像素**：字号 56px、
  离底边 64px。改完只重烧（秒级），不用重渲。不同平台的底部 UI 安全区不一样，
  所以这个值按每期单独给。
- **画面被字幕压住** → 要么调上面的 `marginV`，要么动 `tools/assets/radar.js` 的
  `CY`（图整体上下移）。注意 `radar.js` 是共用资产，改了所有期都跟着变。

## 配色

取自 dataviz 规范里已验证的深色调用色板，并跑过校验器：

```
紫 #9085e9  ← 单序列主色（INFP 多边形 / 四个主功能）
琥珀 #c98500 ← 强调，同一时刻只出现一处（当前讲到的那项）
灰 #c3c2b7  ← 阴影功能
底 #1a1a19
```

紫 ↔ 琥珀的色盲色差 **ΔE 27.3**（门槛 8）。改色后要重跑：

```bash
node <dataviz-skill>/scripts/validate_palette.js "#9085e9,#c98500" --mode dark
```

**单序列只用一个色相，不要给八个功能各配一个颜色。** 那是数据可视化里最典型的
错误——「八个色相讲一个故事」。正确做法是「强调一个、其余压灰」。

## 烧字幕要 libass

brew 的 `ffmpeg` 没编 libass，`subtitles` 滤镜不存在，所以另装了 **`ffmpeg-full`**：

```bash
brew install ffmpeg-full          # keg-only，不会覆盖 PATH 上现有的 ffmpeg
```

`burn.mjs` 按 `$FFMPEG` → `/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg` → PATH 上的 `ffmpeg`
的顺序找，并自检滤镜在不在；不在就打印补救命令，而不是抛一句 `No such filter`。
想换一个 ffmpeg：`FFMPEG=/path/to/ffmpeg node tools/burn.mjs <期目录> box`。

中文必须显式指定字体（`PingFang SC`），否则 libass 会退到没有中文字形的字体会出一片方块。

## 已知限制 / 待办

- **中文没有词级时间戳**：edge-tts 对中文只发 `SentenceBoundary`。字幕的字级
  时间是按字数在句内插值的，误差约百毫秒。要精确到字得换 ASR（whisper）。
- **雷达图数值是示意性的**，为了视觉上拉开差距，不是量表实测值。要标来源得先定口径。
- **所有期共用 1920×1080**：`base.css` 和 `radar.js` 里的画布常量是按这个尺寸写死的，
  两期用不同尺寸会静默按错的比例渲染。要换尺寸得同时改 `script.json`、`base.css`、`radar.js`。
- **没有审美闭环**：产出画面无法自检，只能靠 `probe.mjs` 验几何/配色，
  以及用 OCR 读文字。构图好不好看得人来判断。
