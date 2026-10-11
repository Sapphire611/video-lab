/* 逐帧渲染。动画全部写成 render(t) 的纯函数，所以同一 t 永远出同一帧——
   不录屏，因此不掉帧、不抖动，还能只重渲某一个镜头。

   用法：
     node tools/render.mjs <期目录> stills [s3]   出几张样帧自检
     node tools/render.mjs <期目录> full  [s3]    全量渲染（可只渲一个镜头）
     cd <期目录> && node ../../tools/render.mjs full s3
*/
import { chromium } from "playwright";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { REPO, loadEpisode, parseEpisodeArgs, fail } from "./episode.mjs";

const USAGE = "node tools/render.mjs <期目录> [stills|full] [镜头id]";
const { dir, mode, extra } = parseEpisodeArgs(process.argv.slice(2), ["stills", "full"], {
  def: "stills",
  usage: USAGE,
});
if (extra.length > 1) fail(`多余的参数：${extra.slice(1).join(" ")}`, `用法：${USAGE}`);

const ep = loadEpisode(dir);
const only = extra[0];
const script = ep.script;
const timing = JSON.parse(fs.readFileSync(ep.timingJson, "utf8"));

const { fps, lead, tail, width, height } = script;
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml",
};

/** 镜头时长 = 前导 + 语音 + 尾留白 */
const shotDuration = (id) => lead + timing[id].voiced_end + tail;

/* 服务的根是仓库根：场景要用 /tools/assets/ 下的共用资产，
   html 也按仓库内的路径取。防穿越的判断照旧按这个根来。 */
function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
    const file = path.join(REPO, rel);
    // 只允许读仓库内的文件
    if (!file.startsWith(REPO + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

/** 仓库内的路径 → 服务用的 URL。slug 和镜头 id 都限定了字符集，不用转义。 */
const urlOf = (p) => "/" + path.relative(REPO, p).split(path.sep).join("/");

async function open(page, port, id) {
  const errs = [];
  page.removeAllListeners("pageerror");
  page.removeAllListeners("response");
  page.on("pageerror", (e) => errs.push(String(e)));
  /* 资源 404 不触发 pageerror：base.css 挂掉时 window.render 照样存在、截图照样写，
     出来却是白底黑字。所以把 4xx/5xx 也当致命错误，并记下是哪个 URL。 */
  page.on("response", (r) => {
    if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`);
  });

  await page.goto(`http://127.0.0.1:${port}${urlOf(ep.sceneHtml(id))}`, { waitUntil: "load" });
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForTimeout(150);           // 让首帧布局稳定
  const ready = await page.evaluate(() => typeof window.render === "function");
  if (!ready) throw new Error(`${id}: window.render 未定义`);
  return errs;
}

const shots = script.shots.filter((s) => !only || s.id === only);
if (!shots.length) {
  fail(
    `没有匹配的镜头：${only}`,
    `script.json 里是 ${script.shots.map((s) => s.id).join(", ")}`
  );
}

console.log(`期目录 ${path.relative(REPO, ep.dir)}   模式 ${mode}\n`);

const server = await serve();
const port = server.address().port;
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor: 1,
});
// 场景脚本运行前就把数据挂上——晚于 load 注入会来不及
await page.addInitScript((f) => { window.FUNCS = f; }, script.functions);

let total = 0;
let failed = false;

for (const shot of shots) {
  const dur = shotDuration(shot.id);
  const dirOf = ep.shotDir(shot.id);

  /* 先清空再渲染：报错的镜头若留着上一轮的帧，compose 会拿旧帧配新时长，
     静默错位且不报错。清掉之后帧数不齐，compose 那张断言就会拦下来。 */
  if (mode === "full") fs.rmSync(dirOf, { recursive: true, force: true });

  const errs = await open(page, port, shot.id);
  if (errs.length) {
    console.error(`✗ ${shot.id} 页面报错:\n  ${errs.join("\n  ")}`);
    failed = true;
    continue;
  }

  if (mode === "stills") {
    fs.mkdirSync(ep.previewDir, { recursive: true });
    const marks = [0.05, 0.35, 0.6, 0.85, 0.98].map((k) => +(dur * k).toFixed(2));
    for (const t of marks) {
      await page.evaluate((tt) => window.render(tt), t);
      const out = path.join(ep.previewDir, `${shot.id}_t${String(t).replace(".", "_")}.png`);
      await page.screenshot({ path: out });
      console.log(`  ${shot.id}  t=${t}s  →  ${path.relative(REPO, out)}`);
    }
    console.log(`${shot.id}: ${dur.toFixed(2)}s（样帧 ${marks.length} 张）`);
    continue;
  }

  fs.mkdirSync(dirOf, { recursive: true });
  const frames = Math.round(dur * fps);
  const t0 = Date.now();
  for (let f = 0; f < frames; f++) {
    await page.evaluate((tt) => window.render(tt), f / fps);
    await page.screenshot({
      path: path.join(dirOf, `f${String(f).padStart(5, "0")}.png`),
    });
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  total += frames;
  console.log(`${shot.id}: ${frames} 帧  ${dur.toFixed(2)}s  用时 ${secs}s`);
}

if (mode === "full") {
  const all = script.shots.map((s) => shotDuration(s.id));
  console.log(`\n合计 ${total} 帧 / ${all.reduce((a, b) => a + b, 0).toFixed(2)}s`);
  if (failed) {
    console.error("✗ 有镜头渲染失败，不写 timeline.json —— 否则 compose 会拿残缺的帧去配时长");
    process.exitCode = 1;
  } else {
    fs.writeFileSync(
      ep.timelineJson,
      JSON.stringify(
        Object.fromEntries(script.shots.map((s) => [s.id, +shotDuration(s.id).toFixed(3)])),
        null, 2
      )
    );
  }
}

if (process.exitCode) console.error("渲染未全部成功。");

await browser.close();
server.close();
