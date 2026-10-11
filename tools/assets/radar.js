/* 共享雷达图。经典脚本（非 module）——file:// 下 module 会被 CORS 拦掉。
   只负责画，不管时间；各场景拿到 refs 后自行按 t 设属性。 */
(function (global) {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const CX = 960;
  const CY = 596;
  const R = 286;
  const RINGS = [0.25, 0.5, 0.75, 1];

  function el(name, attrs) {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function point(i, n, r01) {
    const a = ((-90 + (360 / n) * i) * Math.PI) / 180;
    return { x: CX + Math.cos(a) * R * r01, y: CY + Math.sin(a) * R * r01 };
  }

  function octagon(k, n) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const p = point(i, n, k);
      pts.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    }
    return pts.join(" ");
  }

  function build(container, funcs) {
    const n = funcs.length;
    const svg = el("svg", { class: "overlay", viewBox: "0 0 1920 1080" });
    const g = el("g", {});
    svg.appendChild(g);

    const rings = RINGS.map((k) =>
      el("polygon", {
        points: octagon(k, n),
        fill: "none",
        stroke: k === 1 ? "var(--grid-strong)" : "var(--grid)",
        "stroke-width": k === 1 ? 1.5 : 1,
      })
    );
    rings.forEach((r) => g.appendChild(r));

    const axes = funcs.map((_, i) => {
      const p = point(i, n, 1);
      return el("line", {
        x1: CX, y1: CY, x2: p.x, y2: p.y,
        stroke: "var(--grid)", "stroke-width": 1,
      });
    });
    axes.forEach((a) => g.appendChild(a));

    const poly = el("polygon", {
      points: octagon(0, n),
      fill: "var(--series)",
      "fill-opacity": 0,
      stroke: "var(--series)",
      "stroke-width": 2,
      "stroke-linejoin": "round",
      "stroke-opacity": 0,
    });
    g.appendChild(poly);

    const markers = funcs.map(() =>
      el("circle", { cx: CX, cy: CY, r: 0, fill: "var(--series)" })
    );
    markers.forEach((m) => g.appendChild(m));

    // 标签：键名（等宽，主导）在上，中文名（次要）在下
    const labels = funcs.map((f, i) => {
      const a = ((-90 + (360 / n) * i) * Math.PI) / 180;
      const lx = CX + Math.cos(a) * (R + 54);
      const ly = CY + Math.sin(a) * (R + 48);
      const cos = Math.cos(a);
      const anchor = Math.abs(cos) < 0.3 ? "middle" : cos > 0 ? "start" : "end";
      const dyKey = Math.sin(a) > 0.3 ? 22 : Math.sin(a) < -0.3 ? -6 : 8;

      const key = el("text", {
        x: lx.toFixed(1), y: (ly + dyKey).toFixed(1),
        "text-anchor": anchor, "font-size": 30, "font-weight": 600,
        class: "mono", fill: "var(--dim)",
      });
      key.textContent = f.key;

      const cn = el("text", {
        x: lx.toFixed(1), y: (ly + dyKey + 28).toFixed(1),
        "text-anchor": anchor, "font-size": 20,
        fill: "var(--dim)", "fill-opacity": 0.85,
      });
      cn.textContent = f.cn;

      g.appendChild(key);
      g.appendChild(cn);
      return { key, cn, x: lx, y: ly, anchor };
    });

    const centerLabel = el("text", {
      x: CX, y: CY + 14, "text-anchor": "middle",
      "font-size": 76, "font-weight": 700, class: "mono",
      fill: "var(--series)", "fill-opacity": 0,
    });
    centerLabel.textContent = "INFP";
    g.appendChild(centerLabel);

    container.appendChild(svg);
    return { svg, rings, axes, poly, markers, labels, centerLabel, CX, CY, R, n, funcs };
  }

  // 把 refs 的形状设为给定取值（values 为 0..100）
  function shape(refs, values) {
    const pts = values.map((v, i) => {
      const p = point(i, refs.n, v / 100);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    });
    refs.poly.setAttribute("points", pts.join(" "));
    values.forEach((v, i) => {
      const p = point(i, refs.n, v / 100);
      refs.markers[i].setAttribute("cx", p.x.toFixed(1));
      refs.markers[i].setAttribute("cy", p.y.toFixed(1));
    });
  }

  const Ease = {
    linear: (t) => t,
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    outBack: (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
    outQuint: (t) => 1 - Math.pow(1 - t, 5),
  };

  // 把 t 映射到 [a,b] 区间的 0..1
  const at = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));

  global.Radar = { build, shape, point, Ease, at, CX, CY, R };
})(window);
