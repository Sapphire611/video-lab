/* 把 SRT 烧成硬字幕。抖音这类竖屏/信息流场景一般不接受外挂字幕。
   中文必须显式指定字体名，否则 libass 会退到缺中文字形的字体，出来一片方块。

   用法：node tools/burn.mjs <期目录> [字幕样式="box"|"outline"]
*/
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { REPO, loadEpisode, parseEpisodeArgs, fail } from "./episode.mjs";

const USAGE = 'node tools/burn.mjs <期目录> [box|outline]';
const { dir, mode: style, extra } = parseEpisodeArgs(process.argv.slice(2), ["box", "outline"], {
  def: "box",
  usage: USAGE,
});
if (extra.length) fail(`多余的参数：${extra.join(" ")}`, `用法：${USAGE}`);

// libass 的 FontSize 以 PlayResY=288 为基准，实际像素 ≈ FontSize × 1080/288
const STYLES = {
  box: "BorderStyle=3,Outline=0,Shadow=0,BackColour=&H78000000",
  outline: "BorderStyle=1,Outline=2.5,Shadow=0",
};

/** 这个 ffmpeg 有没有 libass（subtitles/ass 滤镜）。 */
function hasSubtitles(bin) {
  const r = spawnSync(bin, ["-hide_banner", "-filters"], { encoding: "utf8" });
  return !r.error && r.status === 0 && /\bsubtitles\b/.test(r.stdout);
}

const REMEDY = `烧硬字幕要 libass，而 brew 的 ffmpeg 没编（\`subtitles\` 滤镜因此不存在）。
  装一个有的：

      brew install ffmpeg-full       # keg-only，不会覆盖 PATH 上现有的 ffmpeg

  或用 $FFMPEG 指定一个带 libass 的：
      FFMPEG=/path/to/ffmpeg node tools/burn.mjs <期目录> ${style}`;

/* $FFMPEG 显式指定就用它，不合格直接报错——不要偷偷换一个，
   否则「我以为在用 A」和实际用的不是一个，出了画质差异无从追起。 */
let ffmpeg = process.env.FFMPEG;
if (ffmpeg) {
  if (!hasSubtitles(ffmpeg)) {
    console.error(`\n✗ $FFMPEG 指的那个没有 \`subtitles\` 滤镜：${ffmpeg}\n\n  ${REMEDY}\n`);
    process.exit(1);
  }
} else {
  for (const c of ["/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg", "ffmpeg"]) {
    if (hasSubtitles(c)) { ffmpeg = c; break; }
  }
  if (!ffmpeg) {
    console.error(`\n✗ 找不到带 libass 的 ffmpeg。\n\n  ${REMEDY}\n`);
    process.exit(1);
  }
}

const ep = loadEpisode(dir);
const src = ep.mp4;
const srt = ep.srt;
const dst = ep.burned(style);
for (const f of [src, srt]) {
  if (!fs.existsSync(f)) {
    fail(`缺少 ${path.relative(REPO, f)}`, "先跑 compose.mjs。");
  }
}

const vf = [
  `subtitles=${path.basename(srt)}`,
  `force_style='FontName=PingFang SC,FontSize=15,PrimaryColour=&H00FFFFFF,` +
  `MarginV=72,Alignment=2,${STYLES[style]}'`,
].join(":");

// 在 out/ 里跑，让 subtitles 滤镜拿到的是干净相对路径
const r = spawnSync(ffmpeg,
  ["-hide_banner", "-loglevel", "error", "-y", "-i", path.basename(src),
   "-vf", vf, "-c:v", "libx264", "-preset", "medium", "-crf", "18",
   "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart",
   path.basename(dst)],
  { cwd: ep.outDir, stdio: ["ignore", "inherit", "inherit"] });

if (r.status !== 0) {
  console.error(`\n✗ 烧字幕失败（用的 ${ffmpeg}）。\n  ${REMEDY}\n`);
  process.exit(1);
}
console.log(`硬字幕成片  ${path.relative(REPO, dst)}  （样式 ${style}，用的 ${ffmpeg}）`);
