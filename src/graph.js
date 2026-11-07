import {
  CATEGORIES,
  ERAS,
  ERA_ORDER,
  CATEGORY_ORDER,
  STATUSES,
  escapeHtml,
  formatYear,
  clamp,
} from "./constants.js";
import { NODE_H, NODE_W, boundsOf, computeLayout } from "./layout.js";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2.6;
const COMPACT_ZOOM = 0.5;
const COMPACT_HALF = 9;

function svgEl(name, attrs = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}

export class TechGraph {
  constructor({
    stage,
    canvas,
    world,
    edgesEl,
    nodesEl,
    minimapCanvas,
    zoomLabel,
    onSelect,
    onVisibleChange,
    onEditRequest,
  }) {
    this.stage = stage;
    this.canvas = canvas;
    this.world = world;
    this.edgesEl = edgesEl;
    this.nodesEl = nodesEl;
    this.minimapCanvas = minimapCanvas;
    this.zoomLabel = zoomLabel;
    this.onSelect = onSelect ?? (() => {});
    this.onVisibleChange = onVisibleChange ?? (() => {});
    this.onEditRequest = onEditRequest ?? (() => {});

    this.data = { nodes: [] };
    this.nodeMap = new Map();
    this.positions = new Map();
    this.layout = null;
    this.visibleIds = new Set();

    this.filters = {
      eras: new Set(ERA_ORDER),
      categories: new Set(CATEGORY_ORDER),
    };

    this.selected = null;
    this.hovered = null;
    this.hoverEdges = [];
    this.hoverNodes = [];
    this.matches = new Set();

    this.tx = 0;
    this.ty = 0;
    this.k = 1;
    this.compact = false;
    this.renderedOnce = false;
    this.rightInset = 0;

    this.pointers = new Map();
    this.drag = null;
    this.pinch = null;
    this.moved = false;
    this.suppressClick = false;
    this.animTimer = 0;
    this.minimapFrame = 0;
    this.minimapDrag = false;
    this.minimapBox = null;

    this.edgeEls = [];
    this.baseEdgeClass = "edge";

    this._bindEvents();
    this._observeResize();
    this._resizeMinimap();
  }

  /* ------------------------------------------------------------------ */
  /* 数据与筛选                                                         */
  /* ------------------------------------------------------------------ */

  setFilters({ eras, categories }, { fit = true, animate = true } = {}) {
    this.filters.eras = new Set(eras);
    this.filters.categories = new Set(categories);
    this.refresh({ preserveCenter: false });

    if (this.selected && this.visibleIds.has(this.selected)) {
      this.centerOn(this.selected, Math.max(this.k, 0.72), { animate });
    } else if (fit) {
      this.fit({ animate });
    }
  }

  setData(data, { initial = false, focusId = null, keepView = true } = {}) {
    this.data = data;
    this.nodeMap = new Map((data.nodes ?? []).map((node) => [node.id, node]));
    if (this.selected && !this.nodeMap.has(this.selected)) {
      this.selected = null;
      this.onSelect(null);
    }
    this.refresh({ preserveCenter: keepView && !initial, focusId });
    if (initial) {
      this.renderedOnce = true;
      this.initialView();
    }
    this.applyHighlight();
    this.applyMatches();
  }

  isVisible(node) {
    return this.filters.eras.has(node.era) && this.filters.categories.has(node.category);
  }

  getVisibleNodes() {
    return (this.data.nodes ?? []).filter((node) => this.isVisible(node));
  }

  refresh({ preserveCenter = false, focusId = null } = {}) {
    const previousCenter = preserveCenter ? this.screenToWorld(this.stageW() / 2, this.stageH() / 2) : null;
    const previousK = this.k;

    const visible = this.getVisibleNodes();
    this.visibleNodes = visible;
    this.visibleIds = new Set(visible.map((node) => node.id));
    this.layout = computeLayout(visible);
    this.positions = this.layout.positions;

    if (this.selected && !this.visibleIds.has(this.selected)) {
      this.selected = null;
      this.onSelect(null);
    }

    this.world.style.width = `${this.layout.width}px`;
    this.world.style.height = `${this.layout.height}px`;
    this.edgesEl.setAttribute("width", String(this.layout.width));
    this.edgesEl.setAttribute("height", String(this.layout.height));
    this.edgesEl.setAttribute("viewBox", `0 0 ${this.layout.width} ${this.layout.height}`);

    this.renderNodes();
    this.renderEdges();
    this.applyHighlight();
    this.applyMatches();

    if (focusId && this.visibleIds.has(focusId)) {
      this.centerOn(focusId, Math.max(previousK, 0.82), { animate: true });
    } else if (previousCenter) {
      this.setTransform(
        this.stageW() / 2 - previousCenter.x * this.k,
        this.stageH() / 2 - previousCenter.y * this.k,
        this.k,
      );
    }

    this.onVisibleChange({
      visible: visible.length,
      total: this.data.nodes.length,
      edges: this.layout.edges.length,
    });
    this.scheduleMinimap();
  }

  /* ------------------------------------------------------------------ */
  /* 渲染                                                               */
  /* ------------------------------------------------------------------ */

  renderNodes() {
    this.hovered = null;
    this.hoverEdges = [];
    this.hoverNodes = [];
    const fragment = document.createDocumentFragment();
    const ordered = [...this.visibleNodes].sort((a, b) => {
      const pa = this.positions.get(a.id);
      const pb = this.positions.get(b.id);
      return pa.depth - pb.depth || pa.y - pb.y;
    });

    for (const node of ordered) {
      const point = this.positions.get(node.id);
      if (!point) continue;
      const era = ERAS[node.era] ?? { label: node.era, color: "#8fa3bf" };
      const category = CATEGORIES[node.category] ?? { label: node.category, color: "#8fa3bf" };
      const status = node.status && node.status !== "established" ? node.status : "";
      const button = document.createElement("button");
      button.type = "button";
      button.className = `node${status ? ` node-status-${status}` : ""}`;
      button.dataset.id = node.id;
      button.dataset.era = node.era;
      button.style.left = `${point.x}px`;
      button.style.top = `${point.y}px`;
      button.style.setProperty("--era", era.color);
      button.style.setProperty("--cat", category.color);
      button.setAttribute("aria-label", `${node.name}，${formatYear(node.year, node.approx)}，${era.label}`);
      button.title = `${node.name} · ${formatYear(node.year, node.approx)}`;
      button.innerHTML = `
        <span class="node-top">
          <span class="node-cat"><i class="cat-dot" aria-hidden="true"></i>${escapeHtml(category.label)}</span>
          <span class="node-year">${formatYear(node.year, node.approx)}</span>
        </span>
        <span class="node-name">${escapeHtml(node.name)}</span>
        ${status ? `<span class="node-status">${escapeHtml(STATUSES[status]?.label ?? status)}</span>` : ""}
      `;
      fragment.append(button);
    }

    this.nodesEl.replaceChildren(fragment);
  }

  renderEdges() {
    this.hovered = null;
    this.hoverEdges = [];
    this.hoverNodes = [];
    const half = this.compact ? COMPACT_HALF : NODE_W / 2;
    const fragment = document.createDocumentFragment();
    this.edgeEls = [];

    for (const edge of this.layout?.edges ?? []) {
      const from = this.positions.get(edge.from);
      const to = this.positions.get(edge.to);
      if (!from || !to) continue;
      const x1 = from.x + half;
      const y1 = from.y;
      const x2 = to.x - half;
      const y2 = to.y;
      const curve = Math.max(42, Math.abs(x2 - x1) * 0.52);
      const path = svgEl("path", {
        class: this.baseEdgeClass,
        d: `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${(x1 + curve).toFixed(1)} ${y1.toFixed(1)}, ${(x2 - curve).toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`,
        "data-from": edge.from,
        "data-to": edge.to,
      });
      fragment.append(path);
      this.edgeEls.push(path);
    }

    this.edgesEl.replaceChildren(fragment);
  }

  applyHighlight() {
    const selected = this.selected;
    const related = new Set();
    if (selected) {
      related.add(selected);
      this.collectAncestors(selected, related);
      this.collectDescendants(selected, related);
    }

    this.world.classList.toggle("has-selection", Boolean(selected));
    for (const nodeEl of this.nodesEl.children) {
      const id = nodeEl.dataset.id;
      nodeEl.classList.toggle("is-selected", id === selected);
      nodeEl.classList.toggle("is-related", Boolean(selected) && related.has(id));
      nodeEl.classList.toggle("is-dim", Boolean(selected) && !related.has(id));
    }

    for (const path of this.edgeEls) {
      const onChain = Boolean(selected) &&
        related.has(path.dataset.from) &&
        related.has(path.dataset.to);
      path.classList.toggle("is-related", onChain);
      path.classList.toggle("is-dim", Boolean(selected) && !onChain);
    }

    this.updateHoverClasses();
    this.scheduleMinimap();
  }

  applyMatches() {
    const hasSearch = this.matches.size > 0;
    this.world.classList.toggle("has-search", hasSearch);
    for (const nodeEl of this.nodesEl.children) {
      nodeEl.classList.toggle("is-match", hasSearch && this.matches.has(nodeEl.dataset.id));
    }
  }

  setMatches(ids) {
    this.matches = new Set(ids);
    this.applyMatches();
  }

  setHover(id) {
    if (this.hovered === id) return;
    this.hovered = id;
    this.hoverEdges = [];
    this.hoverNodes = [];

    if (id) {
      const node = this.nodeMap.get(id);
      if (node) {
        for (const path of this.edgeEls) {
          if (path.dataset.from === id || path.dataset.to === id) {
            path.classList.add("is-hover");
            this.hoverEdges.push(path);
          }
        }
        const nearby = new Set([...(node.prereqs ?? [])]);
        for (const other of this.data.nodes) {
          if ((other.prereqs ?? []).includes(id)) nearby.add(other.id);
        }
        for (const nodeEl of this.nodesEl.children) {
          if (nearby.has(nodeEl.dataset.id)) {
            nodeEl.classList.add("is-near");
            this.hoverNodes.push(nodeEl);
          }
        }
      }
    }
    this.scheduleMinimap();
  }

  updateHoverClasses() {
    for (const path of this.hoverEdges) path.classList.add("is-hover");
    for (const nodeEl of this.hoverNodes) nodeEl.classList.add("is-near");
  }

  /* ------------------------------------------------------------------ */
  /* 选择与高亮链                                                       */
  /* ------------------------------------------------------------------ */

  collectAncestors(id, target) {
    const queue = [id];
    while (queue.length) {
      const current = queue.pop();
      const node = this.nodeMap.get(current);
      for (const prereq of node?.prereqs ?? []) {
        if (target.has(prereq) || !this.nodeMap.has(prereq)) continue;
        target.add(prereq);
        queue.push(prereq);
      }
    }
  }

  collectDescendants(id, target) {
    const queue = [id];
    while (queue.length) {
      const current = queue.pop();
      for (const other of this.data.nodes) {
        if (!(other.prereqs ?? []).includes(current)) continue;
        if (target.has(other.id)) continue;
        target.add(other.id);
        queue.push(other.id);
      }
    }
  }

  select(id, { center = false, animate = true, silent = false } = {}) {
    const node = this.nodeMap.get(id);
    if (!node) return;
    this.selected = id;
    this.applyHighlight();
    if (!silent) this.onSelect(node);
    if (center) this.centerOn(id, Math.max(this.k, 0.85), { animate });
    this.scheduleMinimap();
  }

  clearSelection({ silent = false } = {}) {
    if (!this.selected) return;
    this.selected = null;
    this.applyHighlight();
    if (!silent) this.onSelect(null);
  }

  /* ------------------------------------------------------------------ */
  /* 视图变换                                                           */
  /* ------------------------------------------------------------------ */

  stageW() {
    return this.canvas.clientWidth || 1;
  }

  stageH() {
    return this.canvas.clientHeight || 1;
  }

  screenToWorld(sx, sy) {
    return { x: (sx - this.tx) / this.k, y: (sy - this.ty) / this.k };
  }

  /** 详情面板打开时，把“可见画布”的宽度让出来，避免选中节点被面板压住。 */
  setRightInset(px) {
    this.rightInset = Math.max(0, px || 0);
  }

  visibleWidth() {
    return Math.max(1, this.stageW() - this.rightInset);
  }

  setTransform(tx, ty, k, { animate = false } = {}) {
    this.tx = tx;
    this.ty = ty;
    this.k = clamp(k, MIN_ZOOM, MAX_ZOOM);
    if (animate) {
      this.world.classList.add("is-animating");
      window.clearTimeout(this.animTimer);
      this.animTimer = window.setTimeout(() => this.world.classList.remove("is-animating"), 520);
    }
    this.world.style.transform = `translate3d(${this.tx}px, ${this.ty}px, 0) scale(${this.k})`;
    if (this.zoomLabel) this.zoomLabel.textContent = `${Math.round(this.k * 100)}%`;
    this.stage.classList.toggle("is-zoomed", this.k >= 0.55);

    const compact = this.k < COMPACT_ZOOM;
    if (compact !== this.compact) {
      this.compact = compact;
      this.world.classList.toggle("compact", compact);
      this.renderEdges();
      this.applyHighlight();
    }
    this.scheduleMinimap();
  }

  zoomAt(factor, clientX, clientY, { animate = false } = {}) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const worldPoint = this.screenToWorld(sx, sy);
    const nextK = clamp(this.k * factor, MIN_ZOOM, MAX_ZOOM);
    this.setTransform(sx - worldPoint.x * nextK, sy - worldPoint.y * nextK, nextK, { animate });
  }

  zoomBy(factor) {
    this.zoomAt(factor, this.canvas.getBoundingClientRect().left + this.stageW() / 2, this.canvas.getBoundingClientRect().top + this.stageH() / 2, {
      animate: true,
    });
  }

  centerOn(id, k = this.k, { animate = true } = {}) {
    const point = this.positions.get(id);
    if (!point) return;
    this.setTransform(
      this.visibleWidth() / 2 - point.x * k,
      this.stageH() / 2 - point.y * k,
      k,
      { animate },
    );
  }

  fit({ animate = false, padding = 92, maxScale = 1.1 } = {}) {
    if (!this.layout || !this.visibleNodes.length) return;
    const width = this.visibleWidth();
    const height = this.stageH();
    const k = clamp(
      Math.min(
        (width - padding * 2) / this.layout.width,
        (height - padding * 2) / this.layout.height,
        maxScale,
      ),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    this.setTransform(
      (width - this.layout.width * k) / 2,
      (height - this.layout.height * k) / 2,
      k,
      { animate },
    );
  }

  focusNodeSet(ids, { padding = 110, maxScale = 0.95, minScale = 0.5, animate = false } = {}) {
    const bounds = boundsOf(this.positions, ids);
    if (!bounds) {
      this.fit({ animate });
      return;
    }
    const width = this.visibleWidth();
    const height = this.stageH();
    const k = clamp(
      Math.min(
        (width - padding * 2) / Math.max(bounds.width, 1),
        (height - padding * 2) / Math.max(bounds.height, 1),
        maxScale,
      ),
      minScale,
      MAX_ZOOM,
    );
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    this.setTransform(width / 2 - cx * k, height / 2 - cy * k, k, { animate });
  }

  initialView() {
    const width = this.stageW();
    // 默认落在大致“信息时代 → 智能时代”的位置：名字可读，同时能一眼看到
    // 现代技术链。全图仍可通过左上角按钮或小地图到达。
    const anchorId = ["transformer", "llm", "deep-learning", "internet", "computer", "steam-engine"].find(
      (id) => this.visibleIds.has(id),
    );
    if (anchorId) {
      this.centerOn(anchorId, width < 700 ? 0.66 : 0.8);
      return;
    }
    this.fit({ padding: 84, maxScale: 1.02 });
  }

  /* ------------------------------------------------------------------ */
  /* 小地图                                                             */
  /* ------------------------------------------------------------------ */

  _resizeMinimap() {
    const canvas = this.minimapCanvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  scheduleMinimap() {
    if (this.minimapFrame) return;
    this.minimapFrame = requestAnimationFrame(() => {
      this.minimapFrame = 0;
      this.drawMinimap();
    });
  }

  drawMinimap() {
    const canvas = this.minimapCanvas;
    if (!canvas || !this.layout) return;
    this._resizeMinimap();
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const pad = 7;
    const scale = Math.min(
      (rect.width - pad * 2) / this.layout.width,
      (rect.height - pad * 2) / this.layout.height,
    );
    const ox = (rect.width - this.layout.width * scale) / 2;
    const oy = (rect.height - this.layout.height * scale) / 2;
    this.minimapBox = { scale, ox, oy, width: rect.width, height: rect.height };

    for (const node of this.visibleNodes) {
      const point = this.positions.get(node.id);
      if (!point) continue;
      const era = ERAS[node.era];
      ctx.beginPath();
      ctx.arc(ox + point.x * scale, oy + point.y * scale, node.id === this.selected ? 2.4 : 1.25, 0, Math.PI * 2);
      ctx.fillStyle = node.id === this.selected ? "#ffe4a3" : (era?.color ?? "#8fa3bf");
      ctx.globalAlpha = 0.85;
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const viewX = -this.tx / this.k;
    const viewY = -this.ty / this.k;
    const viewW = this.stageW() / this.k;
    const viewH = this.stageH() / this.k;
    ctx.strokeStyle = "rgba(235, 244, 255, 0.72)";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      ox + viewX * scale,
      oy + viewY * scale,
      viewW * scale,
      viewH * scale,
    );

    ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
    ctx.strokeRect(0.5, 0.5, rect.width - 1, rect.height - 1);
  }

  minimapJump(event) {
    if (!this.minimapBox) return;
    const rect = this.minimapCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const { scale, ox, oy } = this.minimapBox;
    const worldX = (x - ox) / scale;
    const worldY = (y - oy) / scale;
    this.setTransform(
      this.stageW() / 2 - worldX * this.k,
      this.stageH() / 2 - worldY * this.k,
      this.k,
    );
  }

  /* ------------------------------------------------------------------ */
  /* 事件                                                               */
  /* ------------------------------------------------------------------ */

  _bindEvents() {
    this.canvas.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    this.canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
    this.canvas.addEventListener("pointerup", (event) => this.onPointerUp(event));
    this.canvas.addEventListener("pointercancel", (event) => this.onPointerUp(event));
    this.canvas.addEventListener("wheel", (event) => this.onWheel(event), { passive: false });
    this.canvas.addEventListener("click", (event) => this.onCanvasClick(event));
    this.canvas.addEventListener("dblclick", (event) => this.onCanvasDoubleClick(event));

    this.nodesEl.addEventListener("mouseover", (event) => {
      const button = event.target.closest(".node");
      if (button) this.setHover(button.dataset.id);
    });
    this.nodesEl.addEventListener("mouseout", (event) => {
      if (!event.relatedTarget?.closest?.(".node")) this.setHover(null);
    });

    if (this.minimapCanvas) {
      this.minimapCanvas.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        this.minimapDrag = true;
        this.minimapCanvas.setPointerCapture?.(event.pointerId);
        this.minimapJump(event);
      });
      this.minimapCanvas.addEventListener("pointermove", (event) => {
        if (this.minimapDrag) this.minimapJump(event);
      });
      this.minimapCanvas.addEventListener("pointerup", (event) => {
        this.minimapDrag = false;
        this.minimapCanvas.releasePointerCapture?.(event.pointerId);
        this.scheduleMinimap();
      });
      this.minimapCanvas.addEventListener("pointercancel", () => {
        this.minimapDrag = false;
      });
    }
  }

  _observeResize() {
    if (typeof ResizeObserver === "undefined") return;
    this.resizeObserver = new ResizeObserver(() => {
      this.scheduleMinimap();
      this._resizeMinimap();
    });
    this.resizeObserver.observe(this.canvas);
  }

  onPointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.target.closest(".detail-panel, .minimap, .zoom-controls, .draft-chip, .edit-bar, .stage-tip")) {
      return;
    }
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.canvas.setPointerCapture?.(event.pointerId);
    this.moved = false;
    this.suppressClick = false;
    this.world.classList.remove("is-animating");

    if (this.pointers.size === 1) {
      this.drag = { x: event.clientX, y: event.clientY, tx: this.tx, ty: this.ty };
      this.canvas.classList.add("is-panning");
      this.pinch = null;
    } else if (this.pointers.size === 2) {
      this.startPinch();
    }
  }

  startPinch() {
    const [a, b] = [...this.pointers.values()];
    const rect = this.canvas.getBoundingClientRect();
    const midX = (a.x + b.x) / 2 - rect.left;
    const midY = (a.y + b.y) / 2 - rect.top;
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    this.pinch = {
      distance: Math.max(distance, 1),
      k: this.k,
      worldX: (midX - this.tx) / this.k,
      worldY: (midY - this.ty) / this.k,
    };
    this.drag = null;
  }

  onPointerMove(event) {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointers.size >= 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const rect = this.canvas.getBoundingClientRect();
      const midX = (a.x + b.x) / 2 - rect.left;
      const midY = (a.y + b.y) / 2 - rect.top;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const ratio = distance / this.pinch.distance;
      const nextK = clamp(this.pinch.k * ratio, MIN_ZOOM, MAX_ZOOM);
      this.moved = this.moved || ratio > 1.03 || ratio < 0.97;
      this.setTransform(
        midX - this.pinch.worldX * nextK,
        midY - this.pinch.worldY * nextK,
        nextK,
      );
      return;
    }

    if (!this.drag) return;
    const dx = event.clientX - this.drag.x;
    const dy = event.clientY - this.drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) this.moved = true;
    this.setTransform(this.drag.tx + dx, this.drag.ty + dy, this.k);
  }

  onPointerUp(event) {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.delete(event.pointerId);
    this.canvas.releasePointerCapture?.(event.pointerId);

    if (this.pointers.size === 1) {
      const [remaining] = [...this.pointers.values()];
      this.drag = { x: remaining.x, y: remaining.y, tx: this.tx, ty: this.ty };
      this.pinch = null;
      this.canvas.classList.add("is-panning");
    } else if (this.pointers.size === 0) {
      this.drag = null;
      this.pinch = null;
      this.canvas.classList.remove("is-panning");
      if (this.moved) {
        this.suppressClick = true;
        window.setTimeout(() => { this.suppressClick = false; }, 90);
      }
      this.scheduleMinimap();
    }
  }

  onWheel(event) {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 800 : 1;
    const factor = Math.exp(-event.deltaY * unit * 0.0016);
    this.zoomAt(factor, event.clientX, event.clientY);
  }

  nodeAt(clientX, clientY) {
    // pointer capture 会把 pointerup/click 重定向到 canvas，因此不能只依赖
    // event.target 判断点中了哪个节点；这里用坐标做一次命中测试。
    const element = document.elementFromPoint(clientX, clientY);
    return element?.closest?.(".node") ?? null;
  }

  nodeFromEvent(event) {
    const direct = event.target?.closest?.(".node");
    if (direct && this.nodesEl.contains(direct)) return direct;
    return this.nodeAt(event.clientX, event.clientY);
  }

  onCanvasClick(event) {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    const button = this.nodeFromEvent(event);
    if (button) {
      this.select(button.dataset.id, { center: this.k < 0.55, animate: true });
      return;
    }
    if (this.k < 0.55) {
      const nearest = this.nearestNode(event.clientX, event.clientY);
      if (nearest) {
        this.select(nearest.id, { center: true, animate: true });
        return;
      }
    }
    this.clearSelection();
  }

  nearestNode(clientX, clientY, maxScreenDistance = 16) {
    const rect = this.canvas.getBoundingClientRect();
    const world = this.screenToWorld(clientX - rect.left, clientY - rect.top);
    let best = null;
    let bestDistance = Infinity;
    for (const node of this.visibleNodes) {
      const point = this.positions.get(node.id);
      if (!point) continue;
      const distance = Math.hypot(point.x - world.x, point.y - world.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = node;
      }
    }
    return best && bestDistance * this.k <= maxScreenDistance ? best : null;
  }

  onCanvasDoubleClick(event) {
    const button = this.nodeFromEvent(event);
    if (!button) return;
    event.preventDefault();
    const node = this.nodeMap.get(button.dataset.id);
    if (node) this.onEditRequest(node);
  }
}
