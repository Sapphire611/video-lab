# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目

用代码生成短视频：画面全部由 HTML/CSS/SVG 绘制，不碰剪辑软件、不用素材库。用途是自媒体视频批量产出。
**一期一个文件夹**（`videos/<期>/`），引擎在 `tools/` 里共用。
当前样片：`videos/001-mbti-funcs/`，MBTI 认知功能雷达图 5 个镜头约 30 秒。

成片名跟着期目录名走（`out/<期名>.mp4`），没有需要手改的硬编码文件名。

## 管线

```
videos/<期>/script.json ─┬─ tools/tts.py ──────→ audio/<id>.mp3 + audio/timing.json
                         │
                         ├─ videos/<期>/scenes/<id>.html   每镜一个场景，动画是 render(t) 的纯函数
                         │
                         ├─ tools/render.mjs ─→ build/<id>/f00000.png + build/timeline.json
                         │
                         └─ tools/compose.mjs ─→ out/<期名>.mp4 + out/<期名>.srt
                                                       │
                                                  tools/burn.mjs ─→ out/<期名>-box.mp4（硬字幕）
```

**核心设计**：动画是 `render(t)` 的纯函数，同一个 `t` 永远出同一帧。所以不录屏 —— 不掉帧、
不抖动，可以只重渲某一个镜头，也可以改配色后批量重出。任何"用录屏或计时器驱动动画"的改动都会破坏这一点。

## 命令

```bash
./.venv/bin/python tools/tts.py videos/001-mbti-funcs   # 配音 + 句级时间戳
node tools/render.mjs videos/001-mbti-funcs full        # 全量渲染（879 帧，实测约 35 秒）
node tools/render.mjs videos/001-mbti-funcs full s3     # 只重渲一个镜头（timeline 仍按全片写）
node tools/compose.mjs videos/001-mbti-funcs            # → out/001-mbti-funcs.mp4 + .srt
node tools/burn.mjs videos/001-mbti-funcs box           # → out/001-mbti-funcs-box.mp4

# 自检（秒级）
node tools/render.mjs videos/001-mbti-funcs stills s3   # 出 5 张样帧到 build/preview/
node tools/probe.mjs videos/001-mbti-funcs/build/preview/s3_t5_9.png 960,450 100,100
# 文件名里的秒数会掉尾零（t5.90 → s3_t5_9.png），别按 toFixed(2) 去猜路径
```

**看画面只有两条路：`stills` 出 PNG，或者 compose 出成片看 mp4。**
用户本人核对画面的方式就是看视频，所以改了画面之后要把成片重出一遍给他看，
不要只丢一堆 PNG 路径过去。

`cd videos/001-mbti-funcs` 之后 `node ../../tools/render.mjs full s3` 同样可用。

无 lint、无测试框架（`npm test` 是空壳）。验证靠 `stills` + `probe.mjs` + OCR 读文字，
判断依据是像素而不是"看着像跑通了"。

## 期目录的路径契约

**所有路径只在 `tools/episode.mjs` 的 `loadEpisode()` 里定义一次**，谁也不许自己拼。
`ROOT` 一个名字以前同时指三件事（脚本同级目录 / HTTP 服务根 / 输出基准），
漏改一处 join 就会让两个期共用同一个 `build/`，而两边都"成功" —— B 期覆盖 A 期的帧，
A 期的 compose 拿 B 期的画面配 A 期的音。所以：

- `TOOLS` = 脚本所在目录，`REPO` = 仓库根，`EP` = 期目录。服务根是 `REPO`，其余一律相对 `EP`。
- 每个工具启动时打印解析出的期目录，跑错了一眼能看见。
- 期目录名限 `^[A-Za-z0-9._-]+$` —— 它会进 ffmpeg 的 `subtitles=` 滤镜语法和 concat 清单。

**命令行参数认不出来就报错，绝不回退到当前目录。** 规则是：第一个参数若命中该工具的
模式关键字（`render` 是 `stills|full`，`burn` 是 `box|outline`）就是模式，期目录取当前目录；
否则第一个参数必须是存在的期目录。这防止 `cd` 进 001 后想指 002 而打错路径时**默默渲染 001**。

## 跨文件约定（改任何一环都要顾到）

**镜头时长是推导出来的，不是写死的。** `shotDuration(id) = lead + timing[id].voiced_end + tail`，
参数取自 `script.json`。所以改 `vo` 后必须重跑 `tts.py`，否则时长还是旧的。
（场景里曾经有个 `window.DURATION`，没有任何代码读它，已删除。）

**`script.json` 的 `shots[].id` ↔ `scenes/<id>.html` ↔ `audio/<id>.json` ↔ `build/<id>/` 靠 id 字符串对应。**
加镜头要同时加 `script.json` 条目和场景 HTML；漏一个 render 会报 `window.render 未定义`。

**`window.FUNCS` 由 `render.mjs` 用 `page.addInitScript` 在场景脚本运行前注入**（内容为
`script.json` 的 `functions`）。晚于 `load` 注入会来不及，场景也不能自己去 fetch 数据。

**场景只在渲染器里成立**：它既依赖注入的 `window.FUNCS`，又用根绝对路径
（`/tools/assets/base.css`）引用共用资产，初始状态还都是 `opacity: 0`（全靠 `window.render(t)` 画）。
所以**双击 `scenes/s1.html` 一定是白屏，这不是 bug，也没有能双击打开的替代形式**
（曾经做过一个 localhost 预览页，用不上，已删）。要看画面就出帧或看成片。

**顺序依赖**：`compose.mjs` 读 `build/timeline.json`，而它只在 `render.mjs full` 模式写。

**画布尺寸 1920×1080 是全局约束**：`script.json` 是每期一份，但 `tools/assets/base.css` 和
`tools/assets/radar.js`（`CX 960 / CY 596 / R 286`）把尺寸写死了。两期用不同尺寸会静默按错的比例
渲染。改尺寸要同时动这三处。

**`deviceScaleFactor: 1` 和 `channel: "chrome"` 是承重的**：换成 Playwright 自带的 Chromium
会改变栅格化结果，重渲出来的帧就不再和以前一致了。

**音画对齐**：`compose.mjs` 按 `frames = Math.round(tl[id] * fps)` 反推每镜时长（`durOf = frames/fps`），
并断言盘上 PNG 张数与它相等 —— ffmpeg 会照单全收少几帧的序列，编出短一截的段落再被 `-shortest`
悄悄截掉音频，这是最难发现的一种错。给每段 mp3 加 `adelay = (lead - 首个 span 的 start)`，
把语音起点对齐到前导之后（edge-tts 的 mp3 自带约 0.1s 静音）。

## 场景编写约定

场景暴露 `window.render(t)`（t 为镜头内秒数，已含前导），只设属性、不碰计时器。可复用的部分：

- `Radar.build(container, funcs)` → refs（`poly` / `markers` / `labels` / `centerLabel`）
- `Radar.shape(refs, values)` —— values 为 0..100 的数组，把多边形和标记点摆到位
- `Radar.Ease`（`outCubic` / `inOutCubic` / `outBack` / `outQuint`）与 `Radar.at(t, a, b)`（把 t 映射到区间 0..1）
- `C.envelope(t, a, b)` —— 高亮包络，提前 0.18s 起亮、延后 0.4s 退净

**配色是硬约束**：单序列只用一个色相（紫 `--series`），琥珀 `--accent` 仅作"此刻讲到的那一项"的
强调，同一时刻只出现一处；阴影功能压灰 `--dim`。**不要给八个功能各配一个颜色** —— 那是
"八个色相讲一个故事"，是数据可视化里最典型的错误。改 `tools/assets/base.css` 的变量后要重跑
校验器（`node <dataviz-skill>/scripts/validate_palette.js "#9085e9,#c98500" --mode dark`，
门槛 ΔE 8，当前 27.3）。

**渲染时的静默失败防线**：`render.mjs` 把资源 4xx/5xx 也当致命错误（`base.css` 404 不触发
`pageerror`，页面照样出图，只是白底黑字）；渲染前先清空该镜头的帧目录，任一镜头失败就不写
`timeline.json` —— 免得旧帧配新时长。

## 字幕

`compose.mjs` 不用 ASR：稿子是自己写的，按标点切行、按字数在句内插值，中文计 1、拉丁字符计 0.55。
中文走 edge-tts 只有 `SentenceBoundary`，所以字级时间是插值出来的，误差约百毫秒；要精确到字得换 whisper。

`burn.mjs` 烧硬字幕（抖音这类信息流场景一般不接受外挂字幕）。**要 libass，而 brew 的 `ffmpeg`
没编**，所以本机另装了 keg-only 的 `ffmpeg-full`；`burn.mjs` 按 `$FFMPEG` →
`/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg` → PATH 上的 `ffmpeg` 找，并自检 `subtitles` 滤镜。
中文必须显式给 `FontName=PingFang SC`，否则 libass 退到没有中文字形的字体会出一片方块。

字幕的位置和字号写在每期的 `script.json` 里（`subtitle: { fontSize, marginV }`），单位是**像素** ——
`burn.mjs` 把 `PlayResX/Y` 钉成了 `script.width/height`。不钉的话 libass 按自己的基准
（`PlayResY=288`）换算，同一个数字在不同片子里出来的大小不一样，没法调。
改这两个数只重烧（秒级），不用重渲。**画面被字幕压住时，先看这里，再看 `radar.js` 的 `CY`。**

## git 里有什么

进 git 的只有**配方**：`tools/`、`videos/<期>/script.json`、`videos/<期>/scenes/`。
`audio/`、`build/`、`out/` 和 `node_modules/`、`.venv/` 全部忽略（`.gitignore` 里按 `videos/*/` 收）。

推论：新机器 clone 后必须先联网跑 `tts.py` 才能渲染；而重跑 `tts.py` 会让时间轴整体漂移，
`scenes/s3.html` 里手调的句时间点（0.45 / 2.53 / 4.41 / 6.91 秒）是按当时的配音调出来的，
会和新配音对不上。**所以没有明确要求，不要重跑 `tts.py`。**

新开一期：`cp -r videos/001-mbti-funcs videos/002-xxx`，删掉复制过来的 `audio/ build/ out/`，再改内容。

## 待办 / 已知限制

- 雷达图数值是示意性的（为了视觉拉开差距），不是量表实测值；要标来源得先定口径。
- `build/verify/` 里的 png 没有任何脚本产出（全仓库 grep 不到 "verify"），是当初手工验片留下的，
  跟着 `build/` 一起被忽略。
- 没有审美闭环：产出画面无法自检，构图好不好看得人来判断，`probe.mjs` 只能验几何和配色。
