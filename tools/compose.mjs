/* 把帧序列 + 配音合成为成片，并生成 SRT 字幕。

   字幕不用语音识别：稿子是自己写的，直接按标点切行、按字数在句内分配时间，
   比 ASR 准，而且零成本。

   用法：node tools/compose.mjs [期目录]      （成片名 = 期目录名）
*/
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { REPO, loadEpisode, parseEpisodeArgs, fail } from "./episode.mjs";

const USAGE = "node tools/compose.mjs [期目录]";
const { dir, extra } = parseEpisodeArgs(process.argv.slice(2), [], { usage: USAGE });
if (extra.length) fail(`多余的参数：${extra.join(" ")}`, `用法：${USAGE}`);

const ep = loadEpisode(dir);
const script = ep.script;
const timing = JSON.parse(fs.readFileSync(ep.timingJson, "utf8"));
if (!fs.existsSync(ep.timelineJson)) {
  fail(`缺少 ${path.relative(REPO, ep.timelineJson)}`, "先跑 render.mjs full。");
}
const tl = JSON.parse(fs.readFileSync(ep.timelineJson, "utf8"));

const { fps, lead } = script;
const rel = (p) => path.relative(REPO, p);
const B = (p) => path.join(ep.buildDir, p);

function ff(args) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args],
    { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) throw new Error("ffmpeg 失败：\n  ffmpeg " + args.join(" "));
}

/* 每镜头的真实帧数——音频分段按 frames/fps 取齐，避免四舍五入造成的音画漂移 */
const frames = Object.fromEntries(
  script.shots.map((s) => [s.id, Math.round(tl[s.id] * fps)])
);
const durOf = (id) => frames[id] / fps;

/* 盘上的帧数必须和 timeline 说的一致。ffmpeg 会照单全收少几帧的序列，
   编出短一截的段落，再被 -shortest 悄悄截掉音频——那是最难发现的一种错。
   放在最前面查，免得白跑几分钟 ffmpeg 才炸。 */
for (const s of script.shots) {
  const d = ep.shotDir(s.id);
  if (!fs.existsSync(d)) fail(`缺少 ${rel(d)}`, "先跑 render.mjs full。");
  const n = fs.readdirSync(d).filter((f) => f.endsWith(".png")).length;
  if (n !== frames[s.id]) {
    fail(
      `${s.id}: 盘上 ${n} 帧，timeline 说该有 ${frames[s.id]} 帧`,
      "帧数不齐会编出短一截的段落再被 -shortest 截掉音频。重跑 render.mjs full。"
    );
  }
}

let acc = 0;
const startOf = {};
for (const s of script.shots) { startOf[s.id] = acc; acc += durOf(s.id); }
const TOTAL = acc;

/* ── 字幕 ───────────────────────────────────────────── */
const isCJK = (c) => /[　-鿿＀-￯]/.test(c);
const weight = (str) => [...str].reduce((n, c) => n + (isCJK(c) ? 1 : 0.55), 0);

function splitLines(text) {
  const parts = text.split(/(?<=[。！？])|(?<=[，；：])/).filter((s) => s.trim());
  const lines = [];
  for (const p of parts) {
    const prev = lines[lines.length - 1];
    // 极短碎片并进上一行，免得字幕一闪而过
    if (prev && weight(prev) < 6) lines[lines.length - 1] = prev + p;
    else lines.push(p);
  }
  return lines;
}

const stamp = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60), ms = Math.round((s % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:` +
         `${String(sec).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
};

const cues = [];
for (const s of script.shots) {
  const t = timing[s.id];
  if (!t.spans.length) continue;
  const span = t.spans[0];
  const lines = splitLines(s.vo);
  const total = lines.reduce((n, l) => n + weight(l), 0);

  let cursor = span.start;
  for (const line of lines) {
    const share = (weight(line) / total) * span.dur;
    const a = startOf[s.id] + lead + (cursor - span.start);
    const b = a + share;
    cues.push({ n: cues.length + 1, a, b, text: line });
    cursor += share;
  }
}

fs.mkdirSync(ep.outDir, { recursive: true });
fs.writeFileSync(
  ep.srt,
  cues.map((c) => `${c.n}\n${stamp(c.a)} --> ${stamp(c.b)}\n${c.text}\n`).join("\n"),
  "utf8"
);

/* ── 音频：每镜头补成精确时长，再首尾相接 ────────────── */
const aParts = [];
for (const s of script.shots) {
  const t = timing[s.id];
  const mp3SpeechStart = t.spans.length ? t.spans[0].start : 0.1;
  const delayMs = Math.round((lead - mp3SpeechStart) * 1000);
  const out = B(`a_${s.id}.wav`);
  ff(["-i", path.join(ep.audioDir, `${s.id}.mp3`),
      "-af", `adelay=${delayMs}|${delayMs},apad`,
      "-t", durOf(s.id).toFixed(4),
      "-ar", "48000", "-ac", "2", out]);
  aParts.push(out);
}
fs.writeFileSync(B("alist.txt"), aParts.map((p) => `file '${p}'`).join("\n"), "utf8");
ff(["-f", "concat", "-safe", "0", "-i", B("alist.txt"), "-c", "copy", B("full.wav")]);

/* ── 视频：每镜头帧序列编码，再直接与音轨合流 ────────── */
const vParts = [];
for (const s of script.shots) {
  const out = B(`v_${s.id}.mp4`);
  ff(["-framerate", String(fps), "-i", B(path.join(s.id, "f%05d.png")),
      "-c:v", "libx264", "-preset", "medium", "-crf", "18",
      "-pix_fmt", "yuv420p", "-r", String(fps), out]);
  vParts.push(out);
}
fs.writeFileSync(B("vlist.txt"), vParts.map((p) => `file '${p}'`).join("\n"), "utf8");

ff(["-f", "concat", "-safe", "0", "-i", B("vlist.txt"), "-i", B("full.wav"),
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest",
    "-movflags", "+faststart", ep.mp4]);

console.log(`成片    ${rel(ep.mp4)}`);
console.log(`字幕    ${rel(ep.srt)}（${cues.length} 条）`);
console.log(`时长    ${TOTAL.toFixed(2)}s  ${script.shots.map((s) => frames[s.id]).reduce((a, b) => a + b, 0)} 帧`);
