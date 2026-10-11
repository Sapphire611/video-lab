/* 期目录的路径契约。

   以前 ROOT 一个名字同时指三件事：脚本同级的配置目录、Playwright 的 HTTP 服务根、
   输出的基准目录。挤在一个名字里，改布局时只要漏改一处 join，两个期的 build/ 就会
   写进同一个地方，而两边都"成功"——B 期的帧覆盖 A 期，A 期的 compose 拿 B 期的画面
   配 A 期的音。所以路径只在这里定义一次，谁也不许自己拼。

   命令行参数怎么认「哪一期」也在这里，因为唯一的硬规则是：
   认不出来就报错，绝不回退到当前目录——那会默默渲染错的一期。
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TOOLS = fs.realpathSync(path.dirname(fileURLToPath(import.meta.url)));
export const REPO = path.dirname(TOOLS);
export const VIDEOS = path.join(REPO, "videos");

/* slug 会进 ffmpeg 的滤镜语法（burn.mjs 的 subtitles=<名字>.srt）和 concat 清单，
   冒号、逗号、引号都会把它弄坏，而且是烧出半截字幕那种坏法。 */
const SLUG_RE = /^[A-Za-z0-9._-]+$/;

/** 仓库里现成的期目录，报错时列出来给人挑。 */
export function availableEpisodes() {
  if (!fs.existsSync(VIDEOS)) return [];
  return fs
    .readdirSync(VIDEOS)
    .filter((n) => fs.existsSync(path.join(VIDEOS, n, "script.json")))
    .sort();
}

/** 报错并退出。带上可选期目录，省得人再想「我叫什么名来着」。 */
export function fail(msg, hint) {
  console.error(`\n✗ ${msg}`);
  if (hint) console.error(`  ${hint}`);
  const list = availableEpisodes();
  if (list.length) console.error(`\n  可选期目录：${list.join("  ")}`);
  console.error();
  process.exit(1);
}

/** 校验一个期目录，读出它的 script.json，连同全部路径一起返回。 */
export function loadEpisode(dir) {
  let abs;
  try {
    abs = fs.realpathSync(path.resolve(dir)); // realpath：符号链接也能正确比对
  } catch {
    fail(`期目录不存在：${dir}`, "期目录要放在 videos/ 下。");
  }
  if (!fs.statSync(abs).isDirectory()) fail(`不是一个目录：${dir}`);
  if (abs !== REPO && !abs.startsWith(REPO + path.sep)) {
    fail(`期目录必须在仓库内：${abs}`, "本地渲染服务只服务仓库里的文件。");
  }

  const slug = path.basename(abs);
  if (!SLUG_RE.test(slug)) {
    fail(`期目录名只能用字母、数字、点、下划线、连字符：${slug}`);
  }

  const scriptJson = path.join(abs, "script.json");
  if (!fs.existsSync(scriptJson)) {
    fail(
      `${abs} 里没有 script.json，不是期目录`,
      abs === process.cwd()
        ? "当前目录不是期目录——cd 进 videos/<期>/ 再跑，或者显式把期目录当第一个参数传进来。"
        : "期目录要放在 videos/ 下。"
    );
  }

  const buildDir = path.join(abs, "build");
  const outDir = path.join(abs, "out");

  return {
    dir: abs,
    slug,
    script: JSON.parse(fs.readFileSync(scriptJson, "utf8")),
    scriptJson,
    scenesDir: path.join(abs, "scenes"),
    audioDir: path.join(abs, "audio"),
    buildDir,
    outDir,
    previewDir: path.join(buildDir, "preview"),
    timingJson: path.join(abs, "audio", "timing.json"),
    timelineJson: path.join(buildDir, "timeline.json"),
    mp4: path.join(outDir, `${slug}.mp4`),
    srt: path.join(outDir, `${slug}.srt`),
    burned: (style) => path.join(outDir, `${slug}-${style}.mp4`),
    sceneHtml: (id) => path.join(abs, "scenes", `${id}.html`),
    shotDir: (id) => path.join(buildDir, id),
  };
}

/**
 * 从命令行位置参数里认出「哪一期」和「模式」。
 *
 *     node tools/render.mjs videos/001-mbti-funcs full s3
 *     cd videos/001-mbti-funcs && node ../../tools/render.mjs full s3
 *
 * 规则：第一个参数若命中 keywords 就是模式，期目录取当前目录；
 *       否则第一个参数必须是一个存在的期目录，第二个才是模式。
 *       （所以「想指 002 却打错路径」会明确报错，而不是默默渲染 001。）
 */
export function parseEpisodeArgs(argv, keywords, { def = null, usage = "" } = {}) {
  let dir = process.cwd();
  let mode = def;
  let extra = [];

  if (argv.length) {
    if (keywords.includes(argv[0])) {
      mode = argv[0];
      extra = argv.slice(1);
    } else {
      dir = argv[0];
      if (argv.length > 1) {
        mode = argv[1];
        extra = argv.slice(2);
      }
    }
  }

  if (mode !== null && !keywords.includes(mode)) {
    const what = keywords.length ? `未知模式「${mode}」` : `多余的参数「${mode}」`;
    const hint = keywords.length
      ? `可选：${keywords.join(" / ")}${usage ? `\n  用法：${usage}` : ""}`
      : usage;
    fail(what, hint);
  }
  return { dir, mode, extra };
}
