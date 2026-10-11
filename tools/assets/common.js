/* 场景共用小工具：颜色插值 + 高亮曲线。 */
(function (global) {
  "use strict";

  const DIM = [195, 194, 183];
  const AMBER = [201, 133, 0];
  const VIOLET = [144, 133, 233];

  const mixArr = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const css = (arr) => `rgb(${arr.join(",")})`;
  const mix = (a, b, t) => css(mixArr(a, b, t));

  const toDim = (t) => mix(AMBER, DIM, t);      // 1 = 全灰，0 = 全琥珀
  const toViolet = (t) => mix(AMBER, VIOLET, t);

  /* 高亮包络：a 前 0.18s 起亮，b 后 0.4s 退净 */
  function envelope(t, a, b) {
    const up = Math.min(1, Math.max(0, (t - (a - 0.18)) / 0.23));
    const down = 1 - Math.min(1, Math.max(0, (t - (b + 0.06)) / 0.34));
    return Math.min(up, down);
  }

  global.C = { DIM, AMBER, VIOLET, mix, mixArr, css, toDim, toViolet, envelope };
})(window);
