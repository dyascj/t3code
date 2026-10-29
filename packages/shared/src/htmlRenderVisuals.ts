/**
 * The chart kit rendered pages get as `window.t3viz`. Fills are ordered dithering:
 * a tone in [0, 1] inks that share of 3px cells via a 4x4 Bayer matrix. Colors
 * come from theme variables, and every visual repaints when the theme changes.
 */
export const HTML_RENDER_VISUAL_GUIDE = [
  "Charts: the page has window.t3viz, T3's native chart kit, drawn as dithered pixel cells with glowing lines that match the app. Prefer it over chart libraries and hand-drawn SVG charts.",
  "Each call returns an element to append, e.g. document.body.append(t3viz.chart('bar', [{label: 'Deploys', values: [3, 5, 4]}], {labels: ['Mon', 'Tue', 'Wed']})).",
  "t3viz.chart('bar'|'line'|'area', [{label, values, color?}], {labels?, height?}): a single-series bar chart labels its latest bar; give each series its own color.",
  "t3viz.stat(label, value, {detail?, delta?, trend?, better?, color?}): delta is a signed change such as '+12.4%', trend an array of numbers drawn as a sparkline, better: 'lower' colors a falling delta as good (latency, errors, cost).",
  "t3viz.gauge(label, value, {min?, max?, unit?, color?}) for a reading against a range. t3viz.donut([{label, value, color?}], {label?, value?}) for parts of a whole.",
  "t3viz.heatmap(rows, {rows?, columns?, color?}): rows is an array of equal-length number arrays, such as weekdays by weeks. t3viz.progress(label, value, {max?, detail?, color?}).",
  "t3viz.card(children, {gap?}) groups a chart or stats on a raised panel; lay cards out with your own CSS grid or flex.",
  "Colors are tokens: accent, series1 through series6, positive, negative, warning, ink, muted, faint. Series default to series1, series2, and so on.",
  "Publish one small visual per idea (a chart, a stat row, a gauge) rather than one dashboard holding everything. Chart heights around 220-320.",
].join(" ");

// Plain ES5-style source, injected as-is, so no build step can rewrite it.
export const HTML_RENDER_VISUAL_KIT = String.raw`(function(){
if (window.t3viz) return;
var CELL = 3, BAYER = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5], TAU = Math.PI * 2;
var live = [], cache = {}, probe, pixel;
function inked(col, row, tone) { return tone > (BAYER[(row & 3) * 4 + (col & 3)] + 0.5) / 16; }
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
var TOKENS = { accent: "var(--chart-1)", ink: "var(--foreground)", positive: "var(--success)", negative: "var(--destructive)", warning: "var(--warning)",
  muted: "color-mix(in srgb, var(--foreground) 60%, transparent)", faint: "color-mix(in srgb, var(--foreground) 20%, transparent)" };
// A token or any CSS color, as CSS (for elements, which follow the theme live).
function tokenCss(token, index) {
  if (token == null) token = "series" + ((index || 0) % 6 + 1);
  var m = /^series([1-6])$/.exec(token);
  return m ? "var(--chart-" + m[1] + ")" : TOKENS[token] || String(token);
}
function mix(alpha) { return "color-mix(in srgb, var(--foreground) " + Math.round(alpha * 100) + "%, transparent)"; }
// Any CSS color, var() included, as [r, g, b, a] for the canvas.
function rgb(css) {
  if (cache[css]) return cache[css];
  if (!probe) { probe = document.createElement("i"); probe.style.display = "none"; pixel = document.createElement("canvas").getContext("2d", { willReadFrequently: true }); }
  if (!probe.isConnected) document.documentElement.appendChild(probe);
  probe.style.color = ""; probe.style.color = css;
  pixel.clearRect(0, 0, 1, 1); pixel.fillStyle = "#000"; pixel.fillStyle = getComputedStyle(probe).color; pixel.fillRect(0, 0, 1, 1);
  var d = pixel.getImageData(0, 0, 1, 1).data;
  return (cache[css] = [d[0], d[1], d[2], d[3] / 255]);
}
function paint(c, alpha) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + (alpha == null ? c[3] : c[3] * alpha) + ")"; }
function color(token, index) { return rgb(tokenCss(token, index)); }
function ink(alpha) { return paint(rgb("var(--foreground)"), alpha); }
// Dark ink on a light surface: glows turn muddy there, so they are softer.
function light() { var f = rgb("var(--foreground)"); return 0.299 * f[0] + 0.587 * f[1] + 0.114 * f[2] < 128; }
function font(mono, size, weight) { var s = getComputedStyle(document.documentElement); return (weight || 400) + " " + size + "px " + ((mono ? s.getPropertyValue("--font-mono") : s.getPropertyValue("--font-sans")).trim() || (mono ? "monospace" : "sans-serif")); }
function axis() { return { mono: true, size: 10, color: ink(0.45) }; }
function text(ctx, label, s, x, y, align) {
  if (!s) return 0;
  ctx.font = font(label.mono, label.size, label.weight); ctx.fillStyle = label.color;
  ctx.textAlign = align || "left"; ctx.textBaseline = "middle"; ctx.fillText(s, x, y);
  return ctx.measureText(s).width;
}
function measure(ctx, label, s) { ctx.font = font(label.mono, label.size, label.weight); return s ? ctx.measureText(s).width : 0; }

// A grid of cells from a pixel-snapped origin, painted one rect per run of a color.
function Grid(x, y, w, h) { this.x = Math.round(x); this.y = Math.round(y); this.cols = Math.max(0, Math.floor(w / CELL)); this.rows = Math.max(0, Math.floor(h / CELL)); }
Grid.center = function (col, row) { return [(col + 0.5) * CELL, (row + 0.5) * CELL]; };
Grid.prototype.paint = function (ctx, cell) {
  for (var row = 0; row < this.rows; row++) {
    var start = 0, run = null;
    for (var col = 0; col <= this.cols; col++) {
      var next = col < this.cols ? cell(col, row) : null;
      if (run !== null && next === run) continue;
      if (run !== null) { ctx.fillStyle = run; ctx.fillRect(this.x + start * CELL, this.y + row * CELL, (col - start) * CELL, CELL); }
      run = next; start = col;
    }
  }
};

function compact(value, step) {
  var trim = function (s) { return s.indexOf(".") > -1 ? s.replace(/0+$/, "").replace(/\.$/, "") : s; };
  var abs = Math.abs(value);
  if (abs >= 1e9) return trim((value / 1e9).toFixed(1)) + "B";
  if (abs >= 1e6) return trim((value / 1e6).toFixed(1)) + "M";
  if (abs >= 1e4) return trim((value / 1e3).toFixed(1)) + "K";
  var decimals = 4;
  for (var d = 0; d < 4; d++) { var scaled = Math.abs(step) * Math.pow(10, d); if (Math.abs(scaled - Math.round(scaled)) < 1e-6) { decimals = d; break; } }
  return trim(value.toFixed(decimals));
}
function reading(v) { return compact(v, 0.01); }
// A y domain with round ticks covering every value.
function Scale(values, zero) {
  var low = zero ? 0 : Infinity, high = zero ? 0 : -Infinity;
  values.forEach(function (v) { if (isFinite(v)) { low = Math.min(low, v); high = Math.max(high, v); } });
  if (low > high) { low = 0; high = 1; }
  var span = high - low > 0 ? high - low : Math.abs(high) > 0 ? Math.abs(high) : 1;
  var raw = span / 4, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  var step = ([1, 2, 2.5, 5, 10].filter(function (c) { return c * mag >= raw; })[0] || 10) * mag;
  this.step = step; this.min = Math.floor(low / step) * step; this.max = Math.ceil(high / step) * step;
  if (this.max <= this.min) this.max = this.min + step;
}
Scale.prototype.ticks = function () { var n = Math.min(12, Math.round((this.max - this.min) / this.step)), out = []; for (var i = 0; i <= n; i++) out.push(this.min + this.step * i); return out; };
Scale.prototype.depth = function (v) { return (this.max - v) / (this.max - this.min); };
// A smooth curve through points that never overshoots them (monotone cubic).
function Curve(points) {
  var n = points.length, xs = points.map(function (p) { return p[0]; }), ys = points.map(function (p) { return p[1]; }), ms = new Array(n).fill(0);
  if (n >= 2) {
    var d = [];
    for (var k = 0; k < n - 1; k++) d.push((ys[k + 1] - ys[k]) / Math.max(xs[k + 1] - xs[k], 1e-6));
    ms[0] = d[0]; ms[n - 1] = d[n - 2];
    for (k = 1; k < n - 1; k++) ms[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2;
    for (k = 0; k < n - 1; k++) {
      if (d[k] === 0) { ms[k] = 0; ms[k + 1] = 0; continue; }
      var a = ms[k] / d[k], b = ms[k + 1] / d[k], s = a * a + b * b;
      if (s > 9) { var t = 3 / Math.sqrt(s); ms[k] = t * a * d[k]; ms[k + 1] = t * b * d[k]; }
    }
  }
  this.xs = xs; this.ys = ys; this.ms = ms;
}
Curve.prototype.first = function () { return this.xs.length ? this.xs[0] : 0; };
Curve.prototype.last = function () { return this.xs.length ? this.xs[this.xs.length - 1] : 0; };
Curve.prototype.at = function (x) {
  var xs = this.xs, ys = this.ys, ms = this.ms, n = xs.length;
  if (!n) return 0;
  if (n === 1 || x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  var k = 0; while (k < n - 2 && xs[k + 1] <= x) k++;
  var h = Math.max(xs[k + 1] - xs[k], 1e-6), t = (x - xs[k]) / h, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * ms[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * ms[k + 1];
};
Curve.prototype.samples = function (step) {
  var a = this.first(), b = this.last(), self = this;
  if (this.xs.length < 2) return this.xs.map(function (x, i) { return [x, self.ys[i]]; });
  var count = Math.max(1, Math.ceil((b - a) / step)), out = [];
  for (var i = 0; i <= count; i++) { var x = a + (b - a) * i / count; out.push([x, this.at(x)]); }
  return out;
};
// A curve's points left of x, ending exactly there.
function drawnTo(points, curve, x) {
  var out = points.filter(function (p) { return p[0] <= x; });
  if (x > curve.first() && x < curve.last()) out.push([x, curve.at(x)]);
  return out;
}

function stroke(ctx, points, ox, oy, width, style) {
  if (points.length < 2) return;
  ctx.beginPath(); ctx.moveTo(ox + points[0][0], oy + points[0][1]);
  for (var i = 1; i < points.length; i++) ctx.lineTo(ox + points[i][0], oy + points[i][1]);
  ctx.lineWidth = width; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.strokeStyle = style; ctx.stroke();
}
// A line with a soft glow under it.
function glowingLine(ctx, points, ox, oy, width, c) {
  var dim = light() ? 0.45 : 1;
  stroke(ctx, points, ox, oy, width + 10, paint(c, 0.07 * dim));
  stroke(ctx, points, ox, oy, width + 5, paint(c, 0.14 * dim));
  stroke(ctx, points, ox, oy, width, paint(c));
}
// A square marker in a faint halo of its color.
function marker(ctx, x, y, side, c) {
  ctx.fillStyle = paint(c, 0.25); ctx.fillRect(x - (side + 6) / 2, y - (side + 6) / 2, side + 6, side + 6);
  ctx.fillStyle = paint(c); ctx.fillRect(x - side / 2, y - side / 2, side, side);
}
function crosshair(ctx, ox, oy, x, height) {
  ctx.fillStyle = ink(0.35);
  for (var y = 0; y < height; y += 5) ctx.fillRect(ox + Math.round(x), oy + y, 1, Math.min(2, height - y));
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
// The details card next to a hovered point, kept inside the canvas.
function readout(ctx, title, rows, ax, ay, bw, bh) {
  var head = { mono: true, size: 10, color: ink(0.55) }, name = { size: 12, color: ink(0.75) }, value = { mono: true, size: 12, color: ink(1) };
  var pad = 10, line = 20, names = 0, values = 0;
  rows.forEach(function (r) { names = Math.max(names, measure(ctx, name, r[1])); values = Math.max(values, measure(ctx, value, r[2])); });
  var w = Math.max(pad * 2 + 16 + names + 16 + values, measure(ctx, head, title) + pad * 2), h = pad * 2 + 16 + rows.length * line;
  var x = ax + 14; if (x + w > bw) x = ax - 14 - w; x = Math.max(0, x);
  var y = clamp(ay - h / 2, 0, Math.max(0, bh - h));
  ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.18)"; ctx.shadowBlur = 25; ctx.shadowOffsetY = 12;
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 8); ctx.fillStyle = paint(rgb("var(--popover)")); ctx.fill(); ctx.restore();
  ctx.strokeStyle = ink(0.1); ctx.lineWidth = 1; ctx.stroke();
  text(ctx, head, title, x + pad, y + pad + 7);
  rows.forEach(function (r, i) {
    var cy = y + pad + 16 + (i + 0.5) * line;
    ctx.fillStyle = paint(r[0]); ctx.fillRect(x + pad, cy - 4, 8, 8);
    text(ctx, name, r[1], x + pad + 16, cy);
    text(ctx, value, r[2], x + w - pad, cy, "right");
  });
}

function el(tag, style, children) {
  var node = document.createElement(tag);
  if (style) node.style.cssText = style;
  (children || []).forEach(function (c) { if (c != null) node.append(c); });
  return node;
}
// A legend swatch: a translucent body under a solid cap, like a bar.
function swatch(css) { return el("span", "width:10px;height:10px;flex-shrink:0;display:inline-block;background:color-mix(in srgb, " + css + " 40%, transparent)", [el("span", "display:block;height:2px;background:" + css)]); }
var stillMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)");
// A capture would catch a chart before it draws in.
var headless = /HeadlessChrome/.test(navigator.userAgent);
// A canvas that sizes itself to its box, plays its entrance once it is first
// laid out, and repaints on hover, resize and theme changes.
function surface(height, draw, width) {
  var canvas = el("canvas", "display:block;touch-action:pan-y;width:" + (width ? width + "px" : "100%") + ";height:" + height + "px");
  var ctx = canvas.getContext("2d"), hover = null, start = null, frame = 0;
  function render() {
    frame = 0;
    var w = canvas.clientWidth, h = canvas.clientHeight, dpr = window.devicePixelRatio || 1, pending = false;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    if (start === null) start = performance.now();
    // Eased progress, 0 to 1, of a step lasting ms that starts delay ms in.
    var motion = function (delay, ms) {
      if (headless || (stillMotion && stillMotion.matches)) return 1;
      var t = clamp((performance.now() - start - delay) / ms, 0, 1);
      if (t < 1) pending = true;
      return 1 - Math.pow(1 - t, 4);
    };
    try { draw(ctx, w, h, motion, hover); } catch (e) { console.error(e); }
    if (pending) schedule();
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(render); }
  canvas.addEventListener("pointermove", function (e) { var r = canvas.getBoundingClientRect(); hover = [e.clientX - r.left, e.clientY - r.top]; schedule(); });
  canvas.addEventListener("pointerleave", function () { hover = null; schedule(); });
  if (window.ResizeObserver) new ResizeObserver(schedule).observe(canvas);
  live.push(schedule);
  return canvas;
}
window.addEventListener("t3-theme", function () { cache = {}; live.forEach(function (s) { s(); }); });

function seriesOf(series) { return (series || []).map(function (s, i) { return { label: String(s.label == null ? "" : s.label), values: (s.values || []).map(Number), css: tokenCss(s.color, i) }; }); }

function cartesian(kind, series, labels, ctx, W, H, motion, hover) {
  var bars = kind === "bar", count = labels.length, all = [];
  series.forEach(function (s) { count = Math.max(count, s.values.length); all = all.concat(s.values); });
  if (!count) return;
  var colors = series.map(function (s) { return rgb(s.css); });
  var scale = new Scale(all, kind !== "line"), ticks = scale.ticks(), tickLabels = ticks.map(function (t) { return compact(t, scale.step); });
  var longest = Math.max.apply(null, tickLabels.map(function (l) { return l.length; }).concat([1]));
  var left = Math.ceil(longest * 6.1) + 10, top = bars ? 16 : 8, right = W - (bars ? 0 : 6);
  var grid = new Grid(left, top, right - left, H - top - 22), pw = grid.cols * CELL, ph = grid.rows * CELL, ox = grid.x, oy = grid.y;
  var yOf = function (v) { return scale.depth(v) * ph; }, band = pw / count;
  var xOf = function (i) { return bars ? band * (i + 0.5) : count <= 1 ? pw / 2 : i * pw / (count - 1); };
  ticks.forEach(function (t, k) { var y = Math.round(yOf(t)); ctx.fillStyle = ink(0.07); ctx.fillRect(ox, oy + y, pw, 1); text(ctx, axis(), tickLabels[k], ox - 10, oy + y, "right"); });
  var stride = Math.max(1, Math.ceil(count / Math.max(1, Math.floor(pw / 72))));
  for (var i = 0; i < labels.length; i += stride) {
    var label = String(labels[i]); if (label.length > 12) label = label.slice(0, 11) + "…";
    text(ctx, axis(), label, ox + xOf(i), oy + ph + 13, bars ? "center" : i === 0 ? "left" : i + 1 === count ? "right" : "center");
  }
  var hx = hover && hover[0] - ox >= 0 && hover[0] - ox <= pw ? hover[0] - ox : null;
  var title = function (i) { return labels[i] != null ? String(labels[i]) : "#" + (i + 1); };
  var rows = function (i) { return series.filter(function (s) { return s.values[i] != null; }).map(function (s) { return [rgb(s.css), s.label, reading(s.values[i])]; }); };
  if (bars) {
    var hovered = hx === null ? null : Math.min(Math.floor(hx / band), count - 1);
    if (hovered !== null) { ctx.fillStyle = ink(0.04); ctx.fillRect(ox + band * hovered, oy, band, ph); }
    barMarks(ctx, series, colors, count, scale, grid, band, hovered, motion);
    if (hovered !== null) {
      var peak = Math.max.apply(null, series.map(function (s) { return s.values[hovered]; }).filter(function (v) { return v != null; }).concat([-Infinity]));
      readout(ctx, title(hovered), rows(hovered), ox + band * (hovered + 0.5), oy + Math.min(yOf(peak), ph - 20), W, H);
    }
    return;
  }
  var points = series.map(function (s) { return s.values.map(function (v, i) { return [xOf(i), yOf(v)]; }); });
  var curves = points.map(function (p) { return new Curve(p); });
  var reach = motion(0, 900) * pw;
  if (kind === "area") {
    var baseline = yOf(Math.max(scale.min, 0)), BANDS = [[0.05, 1], [0.13, 0.8], [0.25, 0.65], [0.4, 0.5], [0.6, 0.35]];
    curves.forEach(function (curve, j) {
      var area = curve.samples(4).filter(function (p) { return p[0] <= reach; });
      if (!area.length) return;
      ctx.beginPath(); ctx.moveTo(ox + area[0][0], oy + baseline);
      area.forEach(function (p) { ctx.lineTo(ox + p[0], oy + p[1]); });
      ctx.lineTo(ox + area[area.length - 1][0], oy + baseline); ctx.closePath();
      ctx.fillStyle = paint(colors[j], light() ? 0.04 : 0.07); ctx.fill();
    });
    var styles = colors.map(function (c) { return paint(c); });
    grid.paint(ctx, function (col, row) {
      var c = Grid.center(col, row), x = c[0], y = c[1];
      if (y > baseline || x > reach) return null;
      // Later series sit in front, as stacked paper would.
      for (var j = curves.length - 1; j >= 0; j--) {
        var curve = curves[j];
        if (x < curve.first() || x > curve.last() || y < curve.at(x)) continue;
        var depth = (y - curve.at(x)) / Math.max(ph, 1), lead = Math.max(2 * CELL / Math.max(ph, 1), BANDS[0][0]), share = 0.2;
        if (depth < lead) share = 1; else for (var b = 0; b < BANDS.length; b++) if (depth < BANDS[b][0]) { share = BANDS[b][1]; break; }
        return inked(col, row, Math.round(0.625 * share * 16) / 16) ? styles[j] : null;
      }
      return null;
    });
  }
  var hoveredPoint = hx === null ? null : count <= 1 ? 0 : Math.round(hx / pw * (count - 1));
  if (hoveredPoint !== null) crosshair(ctx, ox, oy, xOf(hoveredPoint), ph);
  curves.forEach(function (curve, j) {
    var samples = drawnTo(curve.samples(2), curve, reach), pts = points[j];
    glowingLine(ctx, samples, ox, oy, 2, colors[j]);
    // The end marker rides the head of the line as it draws in.
    var head = reach >= curve.last() ? pts[pts.length - 1] : samples[samples.length - 1];
    if (hoveredPoint === null && head) marker(ctx, ox + head[0], oy + head[1], 2 * CELL, colors[j]);
    if (hoveredPoint !== null && pts[hoveredPoint]) marker(ctx, ox + pts[hoveredPoint][0], oy + pts[hoveredPoint][1], 2 * CELL, colors[j]);
  });
  if (hoveredPoint !== null) {
    var topmost = ph;
    points.forEach(function (p) { if (p[hoveredPoint]) topmost = Math.min(topmost, p[hoveredPoint][1]); });
    readout(ctx, title(hoveredPoint), rows(hoveredPoint), ox + xOf(hoveredPoint), oy + topmost, W, H);
  }
}

// Bars fade from their solid top edge toward the axis, and rise in one after another.
function barMarks(ctx, series, colors, count, scale, grid, band, hovered, motion) {
  var ph = grid.rows * CELL, n = Math.max(series.length, 1);
  var wide = Math.max(1, Math.round(Math.min((band * 0.7 - CELL * (n - 1)) / n, 36) / CELL)), group = wide * n + (n - 1);
  var rowOf = function (v) { return Math.round(scale.depth(v) * ph / CELL); };
  var zero = rowOf(Math.min(Math.max(scale.min, 0), scale.max)), last = count - 1, fade = Math.max(grid.rows * 0.7, 1);
  var columns = new Array(grid.cols), lastTop = null, settled = true;
  for (var i = 0; i < count; i++) {
    var rise = motion(Math.min(i * 30, 360), 700);
    settled = settled && rise >= 1;
    var start = Math.round(band * (i + 0.5) / CELL - group / 2);
    series.forEach(function (s, j) {
      var v = s.values[i]; if (v == null) return;
      var end = zero + Math.round((rowOf(v) - zero) * rise), top = Math.min(end, zero), bottom = Math.max(end, zero), first = start + j * (wide + 1);
      for (var col = first; col < first + wide; col++) if (col >= 0 && col < grid.cols) columns[col] = [top, bottom, j, i];
      if (i === last) lastTop = top;
    });
  }
  var styles = colors.map(function (c) { return paint(c); });
  grid.paint(ctx, function (col, row) {
    var c = columns[col];
    if (!c || row < c[0] || row >= c[1]) return null;
    var tone = 0.75 - (0.75 - 0.125) * Math.min((row - c[0]) / fade, 1);
    // The hovered group lights up: a denser dither, never solid.
    if (hovered === c[3]) tone = 0.5 + tone * 0.5;
    return row === c[0] || inked(col, row, tone) ? styles[c[2]] : null;
  });
  // With one series, the latest value is written over its bar once it has risen.
  if (series.length === 1 && lastTop !== null && settled && hovered === null && series[0].values[last] != null)
    text(ctx, { mono: true, size: 10, color: ink(0.9) }, compact(series[0].values[last], scale.step / 10), grid.x + band * (last + 0.5), grid.y + lastTop * CELL - 9, "center");
}

function chart(kind, series, options) {
  options = options || {};
  var s = seriesOf(series), labels = (options.labels || []).map(String);
  var canvas = surface(options.height || 240, function (ctx, w, h, motion, hover) { cartesian(kind, s, labels, ctx, w, h, motion, hover); });
  var legend = s.length > 1 ? el("div", "display:flex;flex-wrap:wrap;gap:4px 16px", s.map(function (x) {
    return el("span", "display:inline-flex;align-items:center;gap:6px;font:11px var(--font-mono);color:" + mix(0.6), [swatch(x.css), x.label]);
  })) : null;
  return el("div", "width:100%;display:flex;flex-direction:column;gap:12px", [canvas, legend]);
}

// The sparkline under a stat: a line over bands that step lighter downward.
function trend(values, css) {
  var LEVELS = [10 / 16, 6 / 16, 3 / 16, 1 / 16];
  return surface(56, function (ctx, W, H, motion) {
    if (values.length < 2) return;
    var grid = new Grid(0, 0, W, 56), width = grid.cols * CELL, height = grid.rows * CELL, tint = rgb(css), style = paint(tint);
    var low = Math.min.apply(null, values), high = Math.max.apply(null, values), range = high > low ? high - low : 1, top = 6, floor = height * 0.3;
    var curve = new Curve(values.map(function (v, i) { return [i / (values.length - 1) * width, top + (1 - (v - low) / range) * (height - top - floor)]; }));
    var reach = motion(150, 900) * width;
    grid.paint(ctx, function (col, row) {
      var c = Grid.center(col, row), depth = c[1] - curve.at(c[0]);
      if (depth < 0 || c[0] > reach) return null;
      return inked(col, row, LEVELS[Math.min(Math.floor(depth / 7), 3)]) ? style : null;
    });
    var samples = drawnTo(curve.samples(2), curve, reach);
    glowingLine(ctx, samples, 0, 0, 1.5, tint);
    var end = samples[samples.length - 1];
    if (end) marker(ctx, Math.min(end[0], width - CELL), end[1], 2 * CELL, tint);
  });
}

function stat(label, value, options) {
  options = options || {};
  var delta = options.delta, detail = options.detail;
  // "+12.4% vs last month" lends its leading change to the delta.
  var split = !delta && detail && /^([+\-−]\d\S*)\s*(.*)$/.exec(detail);
  if (split) { delta = split[1]; detail = split[2] || null; }
  var neutral = options.color == null || options.color === "ink" || options.color === "muted" || options.color === "faint";
  var deltaNode = null;
  if (delta) {
    var down = /^[\-−]/.test(delta), good = down === (options.better === "lower");
    deltaNode = el("span", "display:inline-flex;align-items:center;gap:4px;font:12px var(--font-mono);color:" + tokenCss(good ? "positive" : "negative"), [down ? "▼" : "▲", delta]);
  }
  var trendValues = (options.trend || []).map(Number);
  return el("div", "display:flex;flex-direction:column;gap:4px;min-width:0", [
    el("div", "font-size:13px;color:" + mix(0.6) + ";overflow:hidden;text-overflow:ellipsis;white-space:nowrap", [String(label)]),
    el("div", "font-size:30px;line-height:38px;font-weight:600;font-variant-numeric:tabular-nums;color:" + (options.color ? tokenCss(options.color) : "var(--foreground)"), [String(value)]),
    deltaNode || detail ? el("div", "display:flex;flex-wrap:wrap;align-items:center;column-gap:8px", [deltaNode, detail ? el("span", "font-size:12px;color:" + mix(0.55), [String(detail)]) : null]) : null,
    trendValues.length > 1 ? el("div", "padding-top:8px", [trend(trendValues, neutral ? tokenCss("accent") : tokenCss(options.color))]) : null,
  ]);
}

// A radial dial of dithered blocks; the block at the value steps out like a needle.
function gauge(label, value, options) {
  options = options || {};
  var min = options.min == null ? 0 : options.min, max = options.max == null ? 100 : options.max, unit = options.unit, css = tokenCss(options.color || "accent");
  var SEGMENTS = 36, SPAN = 270, ratio = clamp((value - min) / (max - min), 0, 1), size0 = 220;
  var format = function (v) { return unit === "%" ? compact(v, 1) + "%" : unit ? compact(v, 0.1) + " " + unit : compact(v, 0.1); };
  var height = size0 / 2 + (size0 / 2 - 1) * Math.SQRT1_2 + 18;
  return surface(height, function (ctx, W, H, motion) {
    var tint = rgb(css), style = paint(tint), track = paint(tint, 0.14), size = Math.min(size0, W);
    var grid = new Grid(Math.round((W - size) / 2), 0, size, height), cx = size / 2, cy = size / 2;
    var outer = size / 2 - 1 - CELL, thickness = Math.max(2, Math.round(size * 0.12 / CELL)) * CELL, inner = outer - thickness;
    var step = SPAN / SEGMENTS, middle = outer - thickness / 2, gap = 2 / middle * 180 / Math.PI;
    var grow = motion(0, 1000), filled = ratio * grow * SEGMENTS, active = Math.max(0, Math.ceil(filled - 1e-6));
    grid.paint(ctx, function (col, row) {
      var c = Grid.center(col, row), dx = c[0] - cx, dy = c[1] - cy, r = Math.sqrt(dx * dx + dy * dy);
      if (r < inner || r > outer + CELL) return null;
      var along = Math.atan2(dx, -dy) * 180 / Math.PI + 135;
      if (along < 0 || along >= SPAN) return null;
      var index = Math.floor(along / step), within = along - index * step;
      if (within < gap / 2 || within > step - gap / 2) return null;
      var head = active > 0 && index === active - 1;
      if (r > outer && !head) return null;
      if (index >= active) return track;
      if (head) {
        var part = clamp(filled - index, 0, 1);
        if (within > gap / 2 + (step - gap) * Math.max(part, 0.15)) return r <= outer ? track : null;
        return style;
      }
      return inked(col, row, Math.max(1 - (active - 1 - index) / 16, 9 / 16)) ? style : null;
    });
    var x0 = grid.x + cx, y0 = grid.y + cy, ends = middle * Math.SQRT1_2;
    text(ctx, { size: Math.round(size * 0.15), weight: 600, color: ink(1) }, format(min + (value - min) * grow), x0, y0 - 4, "center");
    text(ctx, { size: 12, color: ink(0.6) }, String(label), x0, y0 + size * 0.1 + 6, "center");
    text(ctx, axis(), compact(min, 1), x0 - ends, y0 + ends + thickness / 2 + 12, "center");
    text(ctx, axis(), compact(max, 1), x0 + ends, y0 + ends + thickness / 2 + 12, "center");
  });
}

// Parts of a whole as a dithered ring, solid at its rim, with a legend.
function donut(slices, options) {
  options = options || {};
  var SIZE = 184, FLOOR = 3 / 16;
  var items = (slices || []).map(function (s, i) { return { label: String(s.label), value: Number(s.value) || 0, css: tokenCss(s.color, i) }; });
  var total = items.reduce(function (t, s) { return t + Math.max(s.value, 0); }, 0);
  var totalReading = options.value != null ? String(options.value) : Math.abs(total) >= 1e4 ? Math.round(total).toLocaleString("en-US") : compact(total, 0.1);
  var ring = surface(SIZE, function (ctx, W, H, motion, hover) {
    var grid = new Grid(0, 0, SIZE, SIZE), half = grid.cols * CELL / 2, outer = half - 2 * CELL, inner = outer - Math.round(SIZE * 0.17 / CELL) * CELL;
    var sweep = motion(0, 900) * TAU, edges = [], running = 0;
    var angleOf = function (dx, dy) { var a = Math.atan2(dx, -dy); return a < 0 ? a + TAU : a; };
    var slot = function (a) { for (var k = edges.length - 1; k >= 0; k--) if (a >= edges[k]) return k; return null; };
    items.forEach(function (s) { edges.push(running / Math.max(total, 1e-9) * TAU); running += Math.max(s.value, 0); });
    var shown = items.filter(function (s) { return s.value > 0; }).length, hovered = null;
    if (hover) { var hdx = hover[0] - half, hdy = hover[1] - half, hr = Math.sqrt(hdx * hdx + hdy * hdy); if (hr >= inner - CELL && hr <= outer + CELL) hovered = slot(angleOf(hdx, hdy)); }
    // The hovered slice stays bright and the others dim.
    var styles = items.map(function (s, i) { return paint(rgb(s.css), hovered !== null && hovered !== i ? 0.25 : 1); });
    grid.paint(ctx, function (col, row) {
      var c = Grid.center(col, row), dx = c[0] - half, dy = c[1] - half, r = Math.sqrt(dx * dx + dy * dy);
      if (r < inner || r > outer) return null;
      var angle = angleOf(dx, dy);
      if (angle > sweep) return null;
      var index = slot(angle); if (index === null) return null;
      var outline = r > outer - CELL || r < inner + CELL;
      if (shown > 1) {
        var near = Infinity;
        edges.forEach(function (e, k) {
          if (items[k].value <= 0) return;
          var d = Math.abs(angle - e); d = Math.min(d, TAU - d);
          if (d <= Math.PI / 2) near = Math.min(near, r * Math.sin(d) / CELL);
        });
        if (near < 0.75) return null;
        outline = outline || near < 1.75;
      }
      var tone = FLOOR + (1 - FLOOR) * Math.pow(1 - (outer - r) / (outer - inner), 1.4);
      return outline || inked(col, row, tone) ? styles[index] : null;
    });
    // The middle names the hovered slice, else the whole.
    var h = hovered !== null ? items[hovered] : null;
    var caption = h ? h.label : options.label, figure = h ? reading(h.value) : totalReading;
    if (caption) text(ctx, axis(), String(caption).toUpperCase().slice(0, 18), half, half - 16, "center");
    var fit = Math.min((inner * 2 - 16) / (Math.max(figure.length, 1) * 0.62), 26);
    text(ctx, { size: Math.floor(fit), weight: 600, color: ink(1) }, figure, half, half + (caption ? 4 : 0), "center");
    if (h) text(ctx, axis(), Math.round(h.value / Math.max(total, 1e-9) * 100) + "%", half, half + 24, "center");
  }, SIZE);
  var legend = el("div", "flex:1;min-width:140px;max-width:320px;display:flex;flex-direction:column;gap:8px", items.map(function (s) {
    var share = total > 0 ? Math.round(s.value / total * 100) : 0;
    return el("div", "display:flex;align-items:center;gap:8px;font-size:12px", [
      swatch(s.css),
      el("span", "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:" + mix(0.8), [s.label]),
      el("span", "font-family:var(--font-mono);color:" + mix(0.5), [compact(s.value, 0.1) + " · " + share + "%"]),
    ]);
  }));
  return el("div", "width:100%;display:flex;flex-wrap:wrap;align-items:center;gap:24px", [el("div", "flex-shrink:0", [ring]), legend]);
}

// A grid of dithered squares, one Bayer tile each. A narrow one keeps its latest columns.
function heatmap(values, options) {
  options = options || {};
  var SQUARE = 4, PITCH = 5, rows = (options.rows || []).map(String), columns = (options.columns || []).map(String), css = tokenCss(options.color || "accent");
  values = (values || []).map(function (r) { return r.map(Number); });
  var width = values.length ? values[0].length : 0, gutter = rows.length ? 34 : 0, top = columns.length ? 18 : 0;
  var height = top + values.length * PITCH * CELL, high = Math.max(1e-9, Math.max.apply(null, [0].concat.apply([0], values)));
  return surface(height, function (ctx, W, H, motion, hover) {
    var tint = rgb(css), style = paint(tint), track = ink(0.07), grid = new Grid(gutter, top, W - gutter, height - top), pitch = PITCH * CELL;
    var fits = Math.max(1, Math.floor((grid.cols + PITCH - SQUARE) / PITCH)), skip = Math.max(0, width - fits), levels = [], hovered = null;
    for (var c = 0; c < fits; c++) levels.push(motion(c * 14, 420));
    if (hover && hover[0] >= gutter && hover[1] >= top) {
      var hc = Math.floor((hover[0] - gutter) / pitch), hr = Math.floor((hover[1] - top) / pitch);
      if (hc < fits && hr < values.length) hovered = [hc, hr];
    }
    grid.paint(ctx, function (col, row) {
      var x = col % PITCH, y = row % PITCH, cc = Math.floor(col / PITCH), rr = Math.floor(row / PITCH);
      if (x >= SQUARE || y >= SQUARE || cc >= fits || !values[rr]) return null;
      var v = values[rr][cc + skip];
      if (v == null) return null;
      if (v <= 0) return track;
      var tone = (0.25 + 0.75 * v / high) * levels[cc];
      if (hovered && hovered[0] === cc && hovered[1] === rr) tone = Math.min(tone + 0.3, 14 / 16);
      return inked(x, y, Math.round(tone * 16) / 16) ? style : track;
    });
    rows.forEach(function (label, i) { if (rows.length > 4 && i % 2 === 1) return; text(ctx, axis(), label, 0, grid.y + i * pitch + SQUARE * CELL / 2); });
    // Each new label (a month over its weeks) is written where it starts, when it clears the one before.
    var previous = null;
    columns.forEach(function (label, i) {
      if (i < skip) return;
      var x = (i - skip) * pitch;
      if (previous && (previous[0] === label || x - previous[1] < 36)) return;
      previous = [label, x];
      text(ctx, axis(), label, grid.x + x, grid.y - top / 2);
    });
    if (hovered) {
      var v = values[hovered[1]][hovered[0] + skip];
      if (v != null) {
        var name = [rows[hovered[1]], columns[hovered[0] + skip]].filter(Boolean).join(" · ");
        readout(ctx, name, [[tint, "Value", reading(v)]], grid.x + hovered[0] * pitch + SQUARE * CELL, grid.y + hovered[1] * pitch + SQUARE * CELL / 2, W, H);
      }
    }
  });
}

// A dithered progress bar: sparse at the start, solid at the head, like a comet.
function progress(label, value, options) {
  options = options || {};
  var max = options.max == null ? 100 : options.max, ratio = clamp(value / max, 0, 1), css = tokenCss(options.color || "accent");
  var bar = surface(3 * CELL, function (ctx, W, H, motion) {
    var tint = rgb(css), style = paint(tint), track = paint(tint, 0.14), grid = new Grid(0, 0, W, 3 * CELL);
    var head = Math.round(grid.cols * ratio * motion(0, 800));
    grid.paint(ctx, function (col, row) {
      if (col >= head) return track;
      return col >= head - 3 || inked(col, row, 0.3 + 0.7 * Math.pow(col / Math.max(head, 1), 1.5)) ? style : track;
    });
  });
  return el("div", "width:100%;display:flex;flex-direction:column;gap:8px", [
    el("div", "display:flex;align-items:baseline;gap:8px", [
      el("span", "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px", [String(label)]),
      el("span", "font:12px var(--font-mono);color:" + mix(0.55), [Math.round(ratio * 100) + "%"]),
    ]),
    bar,
    options.detail ? el("div", "font-size:12px;color:" + mix(0.55), [String(options.detail)]) : null,
  ]);
}

function card(children, options) {
  return el("div", "min-width:0;display:flex;flex-direction:column;gap:" + ((options && options.gap) || 12) + "px;padding:16px;border-radius:12px;background:" + mix(0.03) + ";border:1px solid " + mix(0.08), [].concat(children || []));
}

window.t3viz = { chart: chart, stat: stat, gauge: gauge, donut: donut, heatmap: heatmap, progress: progress, card: card };
})();`;
