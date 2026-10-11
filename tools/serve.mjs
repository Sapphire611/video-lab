/* 本地静态服务：把仓库喂给浏览器，只读，且只读仓库内的文件。

   render.mjs（逐帧截图）和 preview.mjs（肉眼预览）共用它 —— 「预览看到的」
   和「渲出来存盘的」必须走同一条路径、同一份资产，预览才有意义。
*/
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".mp4": "video/mp4",
};

/** URL 路径 → 仓库内真实存在的文件。越界（../）或不存在返回 null。 */
export function resolveStatic(root, urlPath) {
  const rel = decodeURIComponent(urlPath.split("?")[0]).replace(/^\/+/, "");
  const file = path.join(root, rel);
  if (!file.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return null;
  return file;
}

export function sendFile(res, file) {
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

export function sendHtml(res, html) {
  res.writeHead(200, { "Content-Type": MIME[".html"] });
  res.end(html);
}

export function notFound(res) {
  res.writeHead(404);
  res.end("not found");
}

/**
 * 起一个只绑 127.0.0.1 的服务。
 * routes 是「精确 URL → handler(req,res)」，命中优先；其余当静态文件从 root 取。
 * 默认端口被占就退回随机端口，返回实际端口。
 */
export function listen(server, port) {
  return new Promise((ok, bad) => {
    const onErr = (e) => {
      if (e.code === "EADDRINUSE" && port !== 0) {
        server.removeListener("error", onErr);
        server.listen(0, "127.0.0.1", () => ok(server.address().port));
      } else bad(e);
    };
    server.on("error", onErr);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", onErr);
      ok(server.address().port);
    });
  });
}

export function createServer(root, routes = {}) {
  return http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    const route = routes[url];
    if (route) return route(req, res);
    const file = resolveStatic(root, req.url);
    if (!file) return notFound(res);
    sendFile(res, file);
  });
}
