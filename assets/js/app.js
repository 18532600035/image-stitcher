"use strict";

// cells(count) 和凸多边形 polygons(count) 使用 0~1 的归一化坐标。
// regions() 直接返回含间距的像素区域；顶点按画布上的顺时针顺序排列。
const TEMPLATES = {
  diagonal: {
    label: "V 形斜切",
    counts: [3],
    polygons: () => equalDiagonalPolygons()
  },
  parallel: {
    label: "平行斜切",
    counts: [3],
    polygons: () => equalParallelPolygons()
  },
  hexagon: {
    label: "六边形聚焦",
    counts: [3],
    regions: () => equalHexagonRegions()
  },
  sixCenter: {
    label: "六拼 · 中心汇聚",
    counts: [6],
    regions: () => sixCenterRegions()
  },
  fiveCenter: {
    label: "五拼 · 中间梯形",
    counts: [5],
    regions: () => fiveCenterRegions()
  },
  grid: {
    label: "基础网格",
    counts: [5],
    cells(count) {
      if (count === 3) return [{ x: 0, y: 0, w: 1, h: .5 }, { x: 0, y: .5, w: .5, h: .5 }, { x: .5, y: .5, w: .5, h: .5 }];
      return [{ x: 0, y: 0, w: .5, h: .5 }, { x: .5, y: 0, w: .5, h: .5 }, ...Array.from({ length: 3 }, (_, i) => ({ x: i / 3, y: .5, w: 1 / 3, h: .5 }))];
    }
  },
  horizontal: { label: "横向排列", counts: [5, 6], cells: count => Array.from({ length: count }, (_, i) => ({ x: i / count, y: 0, w: 1 / count, h: 1 })) },
  vertical: { label: "纵向排列", counts: [5, 6], cells: count => Array.from({ length: count }, (_, i) => ({ x: 0, y: i / count, w: 1, h: 1 / count })) }
};

const state = { count: 3, layout: "diagonal", layouts: { 3: "diagonal", 5: "fiveCenter", 6: "sixCenter" }, width: 1200, height: 900, gap: 12, fit: "cover", background: "#ffffff", images: Array(6).fill(null), loading: false, exporting: false };
const canvasSizes = { 3: [1200, 900], 5: [2300, 979], 6: [2300, 979] };
const $ = id => document.getElementById(id);
const canvas = $("preview-canvas");
let replaceIndex = null;
let toastTimer;
let diagonalCache;
let parallelCache;
let hexagonCache;
let sixCenterCache;
let fiveCenterCache;

function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 4500);
}

function setActive(selector, attribute, value) {
  document.querySelectorAll(selector).forEach(button => {
    const active = button.dataset[attribute] === String(value);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function polygonBounds(points) {
  const x = Math.min(...points.map(point => point[0]));
  const y = Math.min(...points.map(point => point[1]));
  return { x, y, w: Math.max(...points.map(point => point[0])) - x, h: Math.max(...points.map(point => point[1])) - y };
}

function polygonArea(points) {
  return Math.abs(points.reduce((area, a, i) => {
    const b = points[(i + 1) % points.length];
    return area + a[0] * b[1] - b[0] * a[1];
  }, 0)) / 2;
}

function equalDiagonalPolygons() {
  const key = `${state.width}:${state.height}:${state.gap}`;
  if (diagonalCache?.key === key) return diagonalCache.polygons;
  const create = t => [
    [[0, 0], [t, 0], [.5, 1], [0, 1]],
    [[t, 0], [1 - t, 0], [.5, 1]],
    [[1 - t, 0], [1, 0], [1, 1], [.5, 1]]
  ];
  // 无间距时顶边分割点为 1/6、5/6，三块面积严格各占 1/3。
  // 有间距时微调对称分割点，补偿斜边留白，使可见图片面积也相等。
  let t = 1 / 6;
  if (state.gap > 0) {
    let low = 0, high = .49;
    for (let i = 0; i < 40; i++) {
      t = (low + high) / 2;
      const areas = create(t).slice(0, 2).map(points => polygonArea(insetPolygon(points.map(([x, y]) => [x * state.width, y * state.height]), state.gap)));
      if (areas[0] > areas[1]) high = t;
      else low = t;
    }
  }
  const polygons = create(t);
  diagonalCache = { key, polygons };
  return polygons;
}

function equalParallelPolygons() {
  const key = `${state.width}:${state.height}:${state.gap}`;
  if (parallelCache?.key === key) return parallelCache.polygons;
  const slant = .24;
  const create = t => {
    const aTop = t + slant / 2, aBottom = t - slant / 2;
    const bTop = 1 - t + slant / 2, bBottom = 1 - t - slant / 2;
    return [
      [[0, 0], [aTop, 0], [aBottom, 1], [0, 1]],
      [[aTop, 0], [bTop, 0], [bBottom, 1], [aBottom, 1]],
      [[bTop, 0], [1, 0], [1, 1], [bBottom, 1]]
    ];
  };
  let t = 1 / 3;
  if (state.gap > 0) {
    let low = slant / 2, high = .49;
    for (let i = 0; i < 40; i++) {
      t = (low + high) / 2;
      const areas = create(t).slice(0, 2).map(points => polygonArea(insetPolygon(points.map(([x, y]) => [x * state.width, y * state.height]), state.gap)));
      if (areas[0] > areas[1]) high = t;
      else low = t;
    }
  }
  const polygons = create(t);
  parallelCache = { key, polygons };
  return polygons;
}

function equalHexagonRegions() {
  const key = `${state.width}:${state.height}:${state.gap}`;
  if (hexagonCache?.key === key) return hexagonCache.regions;
  const { width: w, height: h, gap: g } = state;
  const slant = .12;
  const slope = 2 * slant * w / h;
  const offset = g / 2 * Math.hypot(1, slope);
  // 两侧包含内凹折点，直接平移折线边界，保留参考图的六边形轮廓。
  const create = t => {
    const edge = t * w - slope * g;
    const tip = (t - slant) * w;
    const polygons = [
      [[g, g], [edge - offset, g], [tip - offset, h / 2], [edge - offset, h - g], [g, h - g]],
      [[edge + offset, g], [w - edge - offset, g], [w - tip - offset, h / 2], [w - edge - offset, h - g], [edge + offset, h - g], [tip + offset, h / 2]],
      [[w - edge + offset, g], [w - g, g], [w - g, h - g], [w - edge + offset, h - g], [w - tip + offset, h / 2]]
    ];
    return polygons.map(points => ({ ...polygonBounds(points), points }));
  };
  let low = .30, high = .49;
  for (let i = 0; i < 40; i++) {
    const t = (low + high) / 2;
    const regions = create(t);
    if (polygonArea(regions[0].points) > polygonArea(regions[1].points)) high = t;
    else low = t;
  }
  const regions = create((low + high) / 2);
  hexagonCache = { key, regions };
  return regions;
}

function framedRegions(polygons) {
  const g = state.gap;
  const w = state.width - 2 * g, h = state.height - 2 * g;
  return polygons.map(polygon => {
    const points = insetPolygon(polygon.map(([x, y]) => [g + x * w, g + y * h]), g, [g, g, state.width - g, state.height - g], 0);
    return { ...polygonBounds(points), points };
  });
}

function sixCenterRegions() {
  const key = `${state.width}:${state.height}:${state.gap}`;
  if (sixCenterCache?.key === key) return sixCenterCache.regions;
  const regions = framedRegions([
    [[0, 0], [.25, 0], [.5, .5], [0, .5]],
    [[.25, 0], [.75, 0], [.5, .5]],
    [[.75, 0], [1, 0], [1, .5], [.5, .5]],
    [[0, .5], [.5, .5], [.25, 1], [0, 1]],
    [[.5, .5], [.75, 1], [.25, 1]],
    [[.5, .5], [1, .5], [1, 1], [.75, 1]]
  ]);
  sixCenterCache = { key, regions };
  return regions;
}

function fiveCenterRegions() {
  const key = `${state.width}:${state.height}:${state.gap}`;
  if (fiveCenterCache?.key === key) return fiveCenterCache.regions;
  const regions = framedRegions([
    [[0, 0], [.30, 0], [.40, 1], [.28, 1], [0, .22]],
    [[0, .22], [.28, 1], [0, 1]],
    [[.30, 0], [.70, 0], [.60, 1], [.40, 1]],
    [[.70, 0], [1, 0], [1, .22], [.72, 1], [.60, 1]],
    [[1, .22], [1, 1], [.72, 1]]
  ]);
  fiveCenterCache = { key, regions };
  return regions;
}

// 将每条边向内平移后裁剪，斜边间距按垂直距离计算。
// 尖角自然收窄，不会因简单移动顶点而使分区重叠。
function insetPolygon(points, gap, bounds = [0, 0, state.width, state.height], outerOffset = gap) {
  if (gap === 0) return points;
  let result = points;
  points.forEach((a, index) => {
    const b = points[(index + 1) % points.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length < 1e-7) return;
    const nx = -dy / length, ny = dx / length;
    const outer = (a[0] === b[0] && (a[0] === bounds[0] || a[0] === bounds[2])) || (a[1] === b[1] && (a[1] === bounds[1] || a[1] === bounds[3]));
    const offset = outer ? outerOffset : gap / 2;
    const distance = point => nx * (point[0] - a[0]) + ny * (point[1] - a[1]) - offset;
    const clipped = [];
    result.forEach((p, i) => {
      const q = result[(i + 1) % result.length];
      const dp = distance(p), dq = distance(q);
      const pInside = dp >= -1e-7, qInside = dq >= -1e-7;
      if (pInside) clipped.push(p);
      if (pInside !== qInside) {
        const t = dp / (dp - dq);
        clipped.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    });
    result = clipped.filter((point, i) => {
      const next = clipped[(i + 1) % clipped.length];
      return Math.hypot(point[0] - next[0], point[1] - next[1]) > 1e-7;
    });
  });
  return result;
}

function cellRegions() {
  const gap = state.gap;
  if (TEMPLATES[state.layout].regions) return TEMPLATES[state.layout].regions();
  if (TEMPLATES[state.layout].polygons) {
    return TEMPLATES[state.layout].polygons(state.count).map(polygon => {
      const points = insetPolygon(polygon.map(([x, y]) => [x * state.width, y * state.height]), gap);
      return { ...polygonBounds(points), points };
    });
  }
  return TEMPLATES[state.layout].cells(state.count).map(cell => {
    const left = cell.x === 0 ? gap : gap / 2;
    const top = cell.y === 0 ? gap : gap / 2;
    const right = cell.x + cell.w >= .99999 ? gap : gap / 2;
    const bottom = cell.y + cell.h >= .99999 ? gap : gap / 2;
    const x = cell.x * state.width + left, y = cell.y * state.height + top;
    const w = Math.max(1, cell.w * state.width - left - right), h = Math.max(1, cell.h * state.height - top - bottom);
    return { x, y, w, h, points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] };
  });
}

function regionContains(region, x, y) {
  let inside = false;
  for (let i = 0; i < region.points.length; i++) {
    const a = region.points[i];
    const b = region.points[(i + 1) % region.points.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const cross = (dx * (y - a[1]) - dy * (x - a[0])) / Math.hypot(dx, dy);
    if (Math.abs(cross) <= 1e-7 && x >= Math.min(a[0], b[0]) - 1e-7 && x <= Math.max(a[0], b[0]) + 1e-7 && y >= Math.min(a[1], b[1]) - 1e-7 && y <= Math.max(a[1], b[1]) + 1e-7) return true;
    if ((a[1] > y) !== (b[1] > y) && x < a[0] + (y - a[1]) * dx / dy) inside = !inside;
  }
  return inside;
}

function polygonCenter(points) {
  let area = 0, x = 0, y = 0;
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length];
    const cross = a[0] * b[1] - b[0] * a[1];
    area += cross;
    x += (a[0] + b[0]) * cross;
    y += (a[1] + b[1]) * cross;
  });
  return [x / (3 * area), y / (3 * area)];
}

function imagePlacement(region, image) {
  let cx = region.x + region.w / 2, cy = region.y + region.h / 2;
  let ratio = Math.max(region.w / image.naturalWidth, region.h / image.naturalHeight);
  if (state.fit === "contain") {
    [cx, cy] = polygonCenter(region.points);
    // 用各条边的内侧半平面限制四角，也避开两侧分区的内凹折点。
    ratio = Math.min(...region.points.map((a, i) => {
      const b = region.points[(i + 1) % region.points.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const distance = -dy * (cx - a[0]) + dx * (cy - a[1]);
      const extent = (Math.abs(dy) * image.naturalWidth + Math.abs(dx) * image.naturalHeight) / 2;
      return distance / extent;
    }));
  }
  const w = image.naturalWidth * ratio, h = image.naturalHeight * ratio;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function draw(target, preview) {
  const scale = preview ? Math.min(1, 1600 / Math.max(state.width, state.height)) : 1;
  target.width = Math.round(state.width * scale);
  target.height = Math.round(state.height * scale);
  const context = target.getContext("2d");
  if (!context) throw new Error("浏览器不支持画布，请使用新版浏览器。");
  context.scale(target.width / state.width, target.height / state.height);
  context.fillStyle = state.background;
  context.fillRect(0, 0, state.width, state.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const colors = ["#e6e9df", "#e9dfd3", "#dce4df", "#e5e0e8", "#e5e7d7", "#dae3ed"];
  cellRegions().forEach((rect, index) => {
    const asset = state.images[index];
    context.save();
    context.beginPath();
    rect.points.forEach(([x, y], i) => i === 0 ? context.moveTo(x, y) : context.lineTo(x, y));
    context.closePath();
    context.clip();
    if (asset) {
      const image = asset.image;
      const placement = imagePlacement(rect, image);
      context.drawImage(image, placement.x, placement.y, placement.w, placement.h);
    } else if (preview) {
      context.fillStyle = colors[index];
      context.fillRect(rect.x, rect.y, rect.w, rect.h);
      const [cx, cy] = polygonCenter(rect.points);
      const clearance = Math.min(...rect.points.map((a, i) => {
        const b = rect.points[(i + 1) % rect.points.length];
        return Math.abs((b[0] - a[0]) * (cy - a[1]) - (b[1] - a[1]) * (cx - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]);
      }));
      const size = Math.min(rect.w, rect.h, state.width * .15, clearance * 1.25);
      context.strokeStyle = "#9ba88c";
      context.lineWidth = Math.max(1, state.width / 600);
      context.globalAlpha = .65;
      context.strokeRect(cx - size * .22, cy - size * .38, size * .44, size * .34);
      context.beginPath();
      context.moveTo(cx - size * .22, cy - size * .04);
      context.lineTo(cx - size * .04, cy - size * .22);
      context.lineTo(cx + size * .08, cy - size * .10);
      context.lineTo(cx + size * .17, cy - size * .18);
      context.lineTo(cx + size * .22, cy - size * .12);
      context.stroke();
      context.beginPath();
      context.arc(cx + size * .10, cy - size * .28, size * .035, 0, Math.PI * 2);
      context.stroke();
      context.fillStyle = "#748369";
      context.globalAlpha = .8;
      context.textAlign = "center";
      const fontSize = Math.min(state.width * .025, rect.w / 8, rect.h / 8, size * .17);
      context.font = `${fontSize}px "Microsoft YaHei", sans-serif`;
      context.fillText(`添加图片 ${index + 1}`, cx, cy + size * .22);
      context.globalAlpha = .5;
      context.font = `${fontSize * .65}px "Microsoft YaHei", sans-serif`;
      context.fillText("点击或拖入照片", cx, cy + size * .45);
    }
    context.restore();
  });
}

function renderList() {
  const list = $("image-list");
  list.replaceChildren();
  for (let index = 0; index < state.count; index++) {
    const asset = state.images[index];
    const row = document.createElement("div");
    row.className = "image-row";
    const thumb = document.createElement("button");
    thumb.type = "button";
    thumb.className = "thumb-button";
    thumb.setAttribute("aria-label", `${asset ? "替换" : "添加"}第 ${index + 1} 张图片`);
    thumb.disabled = state.loading || state.exporting;
    if (asset) {
      const img = document.createElement("img");
      img.src = asset.thumbnail;
      img.alt = asset.name;
      thumb.append(img);
    } else thumb.textContent = String(index + 1).padStart(2, "0");
    thumb.addEventListener("click", () => chooseReplacement(index));
    const meta = document.createElement("div");
    meta.className = "image-meta";
    const name = document.createElement("strong");
    name.textContent = asset ? asset.name : `等待添加图片 ${index + 1}`;
    name.title = name.textContent;
    const detail = document.createElement("span");
    detail.textContent = asset ? `${asset.image.naturalWidth} × ${asset.image.naturalHeight}` : "点击左侧添加";
    meta.append(name, detail);
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const definitions = [
      ["←", "向前移动", index === 0, () => swap(index, index - 1)],
      ["→", "向后移动", index === state.count - 1, () => swap(index, index + 1)],
      ["×", "移除图片", !asset, () => { state.images[index] = null; render(); }]
    ];
    definitions.forEach(([symbol, label, disabled, action]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = symbol;
      button.title = label;
      button.setAttribute("aria-label", `${label} ${index + 1}`);
      button.disabled = disabled || state.loading || state.exporting;
      button.addEventListener("click", action);
      actions.append(button);
    });
    row.append(thumb, meta, actions);
    list.append(row);
  }
}

function render() {
  draw(canvas, true);
  renderList();
  const busy = state.loading || state.exporting;
  document.querySelectorAll("[data-count], [data-layout], [data-ratio], .settings input, .settings select, #reset-settings, #format-input").forEach(control => { control.disabled = busy; });
  document.querySelectorAll("[data-layout]").forEach(button => {
    button.hidden = !TEMPLATES[button.dataset.layout].counts.includes(state.count);
  });
  $("template-options").classList.toggle("is-three", state.count === 3);
  $("template-badge").textContent = "斜切模板";
  $("template-hint").textContent = state.count === 3
    ? (state.layout === "hexagon" ? "中间六边形，左右对称，三块等面积。" : state.layout === "parallel" ? "三块等面积，两条斜线平行，间距一致。" : "三块等面积，左右对称，使用规整的 V 形斜切。")
    : (state.layout === "fiveCenter" ? "中间梯形，左右各两块斜切分区。" : state.layout === "sixCenter" ? "上下两排，六块分区汇聚到画布中心。" : "基础排列");
  const filled = state.images.slice(0, state.count).filter(Boolean).length;
  $("progress-label").textContent = `已添加 ${filled} / ${state.count} 张图片`;
  $("preview-size").textContent = `${state.width} × ${state.height} px`;
  $("layout-label").textContent = `${state.count} 张 · ${TEMPLATES[state.layout].label}`;
  $("export-button").disabled = filled !== state.count || state.loading || state.exporting;
  $("clear-button").disabled = !state.images.some(Boolean) || state.loading || state.exporting;
  $("upload-button").disabled = state.loading || state.exporting;
  $("export-description").textContent = state.loading ? "正在读取图片…" : filled === state.count ? `${state.width} × ${state.height} px · 已准备好导出` : "添加全部图片后，即可导出高清拼图";
}

function swap(a, b) { [state.images[a], state.images[b]] = [state.images[b], state.images[a]]; render(); }
function chooseReplacement(index) {
  if (state.loading || state.exporting) return;
  replaceIndex = index;
  $("replace-input").value = "";
  $("replace-input").click();
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/") && !/\.(jpe?g|png|webp|gif|bmp|avif|svg)$/i.test(file.name)) return reject(new Error(`无法读取「${file.name}」：请选择图片文件。`));
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      try {
        if (!image.naturalWidth || !image.naturalHeight) throw new Error("无效图片");
        const thumb = document.createElement("canvas");
        const ratio = Math.min(1, 120 / Math.max(image.naturalWidth, image.naturalHeight));
        thumb.width = Math.max(1, Math.round(image.naturalWidth * ratio));
        thumb.height = Math.max(1, Math.round(image.naturalHeight * ratio));
        thumb.getContext("2d").drawImage(image, 0, 0, thumb.width, thumb.height);
        resolve({ name: file.name, image, thumbnail: thumb.toDataURL("image/png") });
      } catch { reject(new Error(`无法处理「${file.name}」，请尝试 JPG 或 PNG 图片。`)); }
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`无法读取「${file.name}」，浏览器可能不支持此格式。`)); };
    image.src = url;
  });
}

async function addFiles(files, targetIndex = null) {
  if (state.loading || state.exporting || !files.length) return;
  const indices = targetIndex === null ? Array.from({ length: state.count }, (_, i) => i).filter(i => !state.images[i]) : [targetIndex];
  if (!indices.length) { toast("图片位置已满。点击缩略图可替换，或先移除一张图片。"); return; }
  state.loading = true;
  render();
  let added = 0;
  const errors = [];
  try {
    for (const file of Array.from(files)) {
      if (added >= indices.length) break;
      try { state.images[indices[added]] = await readImage(file); added++; }
      catch (error) { errors.push(error.message); }
    }
  } finally { state.loading = false; render(); }
  const extra = files.length - added - errors.length;
  if (errors.length) toast(`${errors[0]}${added ? ` 已成功添加 ${added} 张。` : ""}`);
  else if (extra > 0) toast(`已添加 ${added} 张，其余 ${extra} 张超出当前模板数量。`);
  else if (added) toast(targetIndex === null ? `已添加 ${added} 张图片` : "图片已替换");
}

document.querySelectorAll("[data-count]").forEach(button => button.addEventListener("click", () => {
  if (state.loading || state.exporting) return;
  if (state.count === Number(button.dataset.count)) return;
  canvasSizes[state.count] = [state.width, state.height];
  state.count = Number(button.dataset.count);
  [state.width, state.height] = canvasSizes[state.count];
  state.layout = state.layouts[state.count];
  setActive("[data-count]", "count", state.count);
  setActive("[data-layout]", "layout", state.layout);
  const ratio = state.width === 2300 && state.height === 979 ? "wide"
    : ["3:4", "1:1", "4:3"].find(value => { const [w, h] = value.split(":").map(Number); return Math.abs(state.width * h / w - state.height) < 1; }) || "custom";
  setActive("[data-ratio]", "ratio", ratio);
  syncSettings();
  updateGapLimit();
  render();
}));
document.querySelectorAll("[data-layout]").forEach(button => button.addEventListener("click", () => {
  if (state.loading || state.exporting || !TEMPLATES[button.dataset.layout].counts.includes(state.count)) return;
  state.layout = button.dataset.layout;
  state.layouts[state.count] = state.layout;
  setActive("[data-layout]", "layout", state.layout);
  updateGapLimit();
  render();
}));
document.querySelectorAll("[data-ratio]").forEach(button => button.addEventListener("click", () => {
  const ratio = button.dataset.ratio;
  setActive("[data-ratio]", "ratio", ratio);
  if (ratio !== "custom") {
    const [w, h] = ratio === "wide" ? [2300, 979] : ratio.split(":").map(Number);
    state.width = ratio === "wide" ? 2300 : 1200;
    state.height = Math.round(state.width * h / w);
    syncSettings();
  }
  render();
}));

function updateGapLimit() {
  // 保证小画布和五联布局中始终有足够的图片区域。
  const template = TEMPLATES[state.layout];
  if (template.regions) {
    const maximum = Math.min(80, Math.floor(Math.min(state.width, state.height) / 8));
    $("gap-input").max = maximum;
    state.gap = Math.min(state.gap, maximum);
    $("gap-input").value = state.gap;
    $("gap-output").textContent = `${state.gap} px`;
    return;
  }
  const cells = template.polygons ? template.polygons(state.count).map(polygonBounds) : template.cells(state.count);
  const shortest = Math.min(...cells.map(cell => Math.min(cell.w * state.width, cell.h * state.height)));
  const maximum = Math.max(0, Math.min(80, Math.floor(shortest / 3)));
  $("gap-input").max = maximum;
  state.gap = Math.min(state.gap, maximum);
  $("gap-input").value = state.gap;
  $("gap-output").textContent = `${state.gap} px`;
}

function syncSettings() {
  $("width-input").value = state.width;
  $("height-input").value = state.height;
  $("fit-input").value = state.fit;
  $("background-input").value = state.background;
  $("color-value").textContent = state.background.toUpperCase();
  updateGapLimit();
}
for (const [id, key] of [["width-input", "width"], ["height-input", "height"]]) {
  $(id).addEventListener("change", () => {
    const value = Number($(id).value);
    if (!Number.isFinite(value) || value < 100 || value > 6000) {
      $(id).value = state[key];
      toast("画布宽高支持 100–6000 像素。");
      return;
    }
    state[key] = Math.round(value);
    $(id).value = state[key];
    setActive("[data-ratio]", "ratio", "custom");
    updateGapLimit();
    render();
  });
}
$("gap-input").addEventListener("input", () => { state.gap = Number($("gap-input").value); $("gap-output").textContent = `${state.gap} px`; draw(canvas, true); });
$("fit-input").addEventListener("change", () => { state.fit = $("fit-input").value; draw(canvas, true); });
$("background-input").addEventListener("input", () => { state.background = $("background-input").value; $("color-value").textContent = state.background.toUpperCase(); draw(canvas, true); });
$("reset-settings").addEventListener("click", () => {
  Object.assign(state, { width: 1200, height: 900, gap: 12, fit: "cover", background: "#ffffff" });
  setActive("[data-ratio]", "ratio", "4:3");
  syncSettings(); render();
});
$("upload-button").addEventListener("click", () => { $("file-input").value = ""; $("file-input").click(); });
$("file-input").addEventListener("change", event => addFiles(event.target.files));
$("replace-input").addEventListener("change", event => addFiles(event.target.files, replaceIndex));
$("clear-button").addEventListener("click", () => { state.images.fill(null); render(); });

// 防止把图片拖到页面外层时浏览器直接跳转到图片文件。
document.addEventListener("dragover", event => { event.preventDefault(); });
document.addEventListener("drop", event => { event.preventDefault(); });
for (const zone of [$("upload-button"), $("preview-stage")]) {
  zone.addEventListener("dragover", event => { event.preventDefault(); zone.classList.add("drag-over"); });
  zone.addEventListener("dragleave", event => { if (!zone.contains(event.relatedTarget)) zone.classList.remove("drag-over"); });
  zone.addEventListener("drop", event => {
    event.preventDefault(); zone.classList.remove("drag-over");
    addFiles(event.dataTransfer.files);
  });
}
canvas.addEventListener("click", event => {
  const bounds = canvas.getBoundingClientRect();
  const x = (event.clientX - bounds.left) / bounds.width * state.width;
  const y = (event.clientY - bounds.top) / bounds.height * state.height;
  const index = cellRegions().findIndex(region => regionContains(region, x, y));
  if (index >= 0) chooseReplacement(index);
});

$("export-button").addEventListener("click", async () => {
  if (state.exporting || state.loading || state.images.slice(0, state.count).some(asset => !asset)) return;
  state.exporting = true;
  render();
  const button = $("export-button");
  button.textContent = "正在生成…";
  const format = $("format-input").value;
  try {
    const output = document.createElement("canvas");
    draw(output, false);
    const blob = await new Promise((resolve, reject) => output.toBlob(value => value ? resolve(value) : reject(new Error("生成失败，请降低画布尺寸后重试。")), `image/${format}`, .95));
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `拼一下-${state.count}张-${state.width}x${state.height}-${Date.now()}.${format === "jpeg" ? "jpg" : "png"}`;
    document.body.append(link);
    link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    // 及时释放高分辨率临时画布占用的内存。
    output.width = 1; output.height = 1;
    toast("拼图已生成，已发起下载。");
  } catch (error) { toast(`导出失败：${error.message}`); }
  finally { state.exporting = false; button.innerHTML = '<span aria-hidden="true">↓</span>下载拼接图片'; render(); }
});

syncSettings();
render();
