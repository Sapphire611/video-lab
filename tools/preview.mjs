/* 肉眼预览：起本地服务，把各镜头并排放到一条全局时间轴上拖。

   复用渲染路径 —— 同一个静态服务、同样赶在场景脚本之前注入 window.FUNCS，
   所以看到的和 render.mjs 渲出来的是同一条路径。
   （预览是给你调画面用的；最终验收仍以 render.mjs 出的帧为准。）

   用法：node tools/preview.mjs <期目录>     端口默认 5173，可用 PORT= 覆盖
*/
import fs from "node:fs";
import path from "node:path";
import { REPO, TOOLS, loadEpisode, parseEpisodeArgs, fail } from "./episode.mjs";
import { createServer, listen, sendHtml } from "./serve.mjs";

const USAGE = "node tools/preview.mjs <期目录>";
const { dir, extra } = parseEpisodeArgs(process.argv.slice(2), [], { usage: USAGE });
if (extra.length) fail(`多余的参数：${extra.join(" ")}`, `用法：${USAGE}`);

const ep = loadEpisode(dir);
const script = ep.script;
if (!fs.existsSync(ep.timingJson)) {
  fail(`缺少 ${path.relative(REPO, ep.timingJson)}`, "先跑 tts.py（时间轴要靠它）。");
}
const timing = JSON.parse(fs.readFileSync(ep.timingJson, "utf8"));
const { fps, lead, tail } = script;

/* 和 render.mjs 同一套时长推导，预览里的时间轴才和成片一致 */
const shotDuration = (id) => lead + timing[id].voiced_end + tail;

let acc = 0;
const shots = script.shots.map((s) => {
  const dur = shotDuration(s.id);
  const o = {
    id: s.id, note: s.note ?? "", vo: s.vo,
    dur: +dur.toFixed(3), start: +acc.toFixed(3), frames: Math.round(dur * fps),
  };
  acc += dur;
  return o;
});
const meta = { slug: ep.slug, fps, total: +acc.toFixed(3), shots };

/* 在 <head> 之后注入 window.FUNCS，等价于 render.mjs 的 addInitScript：
   都要赶在场景自己的脚本之前。 */
const cache = {};
function sceneHtml(id) {
  if (cache[id]) return cache[id];
  const file = ep.sceneHtml(id);
  if (!fs.existsSync(file)) fail(`缺少 ${path.relative(REPO, file)}`);
  const tag = `<script>window.FUNCS=${JSON.stringify(script.functions)};</script>`;
  cache[id] = fs.readFileSync(file, "utf8").replace(/<head>/i, `<head>\n${tag}`);
  return cache[id];
}

const routes = {
  "/__preview": (req, res) => sendHtml(res, fs.readFileSync(path.join(TOOLS, "preview.html"), "utf8")),
  "/__meta.json": (req, res) => {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(meta));
  },
};
for (const s of shots) {
  routes[`/__scene/${s.id}.html`] = (req, res) => sendHtml(res, sceneHtml(s.id));
}

const port = await listen(createServer(REPO, routes), Number(process.env.PORT) || 5173);
console.log(`期目录 ${path.relative(REPO, ep.dir)}   ${shots.length} 个镜头   共 ${meta.total}s\n`);
console.log(`  预览  http://127.0.0.1:${port}/__preview\n`);
console.log("改完场景存盘后刷新浏览器即可。Ctrl+C 结束。");
