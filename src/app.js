import {
  CATEGORIES,
  CATEGORY_ORDER,
  ERAS,
  ERA_ORDER,
  STATUSES,
  escapeHtml,
  formatYear,
} from "./constants.js";
import { CONFIG, getRepoUrl } from "./config.js";
import { TechGraph } from "./graph.js";
import { clearDraft, draftIsEmpty, fetchTechData, readDraft, writeDraft } from "./store.js";
import { diffData } from "./diff.js";
import { validateData } from "./validate.js";
import { openDiff, openGuide, openNodeEditor } from "./editor.js";
import { confirmModal, openModal, showToast } from "./modal.js";
import { LiveClient, detectLive } from "./live.js";

const $ = (selector) => document.querySelector(selector);

const el = {};
const state = {
  base: null,
  data: null,
  filters: {
    eras: new Set(ERA_ORDER),
    categories: new Set(CATEGORY_ORDER),
  },
  validation: null,
  diff: null,
  editing: false,
  staleDraft: false,
  draftSavedAt: null,
  searchQuery: "",
  searchResults: [],
  searchMatchCount: 0,
  activeSearchIndex: -1,
  detailHideTimer: 0,
  selectedId: null,
  live: false,
  liveClient: null,
  liveConnected: false,
  user: null,
  online: 0,
  registration: true,
  lastRemoteToast: 0,
};

let graph;

/* -------------------------------------------------------------------------- */
/* 启动                                                                       */
/* -------------------------------------------------------------------------- */

init();

async function init() {
  cacheElements();
  setupGraph();
  bindUI();
  renderRepoLink();
  updateSearchPlaceholder();

  try {
    const liveInfo = await detectLive();
    let loaded;
    let draftIgnored = false;
    let restored = false;

    if (liveInfo) {
      loaded = await loadLiveData(liveInfo);
    } else {
      loaded = await loadStaticData();
      draftIgnored = loaded.draftIgnored;
      restored = loaded.restored;
    }

    state.base = loaded.base;
    state.data = loaded.data;
    state.validation = validateData(loaded.data);
    state.diff = diffData(loaded.base, loaded.data);

    graph.setData(loaded.data, { initial: true });
    renderSidebar();
    updateDraftUI();
    updateLiveUI();
    hideLoading();

    if (draftIgnored) {
      showToast("本地草稿格式已损坏或过于陈旧，已忽略并载入线上版本。", {
        tone: "warn",
        duration: 5600,
      });
    }

    if (restored) {
      showToast(
        state.staleDraft
          ? "已恢复本地草稿；它基于旧版数据，提交前请检查冲突。"
          : "已恢复上次未提交的本地草稿。",
        { tone: state.staleDraft ? "warn" : "info", duration: 5200 },
      );
    }

    const hash = readHash();
    if (hash) {
      if (graph.nodeMap.has(hash)) graph.select(hash, { center: true });
      else showToast("没有找到链接中的这项科技，可能已被重命名。", { tone: "warn" });
    }
  } catch (error) {
    showLoadError(error);
  }
}

async function loadStaticData() {
  const base = await fetchTechData();
  const baseCheck = validateData(base);
  if (!baseCheck.ok) {
    throw new Error(`数据校验失败：${baseCheck.errors[0]?.message ?? "未知错误"}`);
  }

  const draft = readDraft();
  let data = clone(base);
  let restored = false;
  let draftIgnored = false;

  if (draft && !draftIsEmpty(base, draft.data)) {
    const draftCheck = validateData(draft.data);
    if (draftCheck.ok) {
      data = draft.data;
      restored = true;
      state.staleDraft = draft.baseUpdated !== base.updated;
      state.draftSavedAt = draft.savedAt ?? null;
    } else {
      clearDraft();
      draftIgnored = true;
    }
  } else if (draft) {
    clearDraft();
  }

  return { base, data, restored, draftIgnored };
}

async function loadLiveData(liveInfo) {
  state.live = true;
  state.liveClient = new LiveClient({
    onData: handleRemoteData,
    onPresence: handlePresence,
    onUser: handleUserChange,
    onConnection: handleLiveConnection,
  });

  const data = await state.liveClient.start();
  state.user = state.liveClient.user;
  state.online = Number(liveInfo.online) || 0;
  state.registration = liveInfo.registration !== false;
  state.liveConnected = true;

  // 实时模式不使用本地草稿；服务器数据就是基线。
  return { base: clone(data), data };
}

function cacheElements() {
  el.app = $("#app");
  el.stage = $("#stage");
  el.canvas = $("#canvas");
  el.world = $("#world");
  el.edges = $("#edges");
  el.nodes = $("#nodes");
  el.minimapCanvas = $("#minimap-canvas");
  el.zoomLevel = $("#zoom-level");
  el.detail = $("#detail");
  el.detailScrim = $("#detail-scrim");
  el.sidebar = $("#sidebar");
  el.sidebarScrim = $("#sidebar-scrim");
  el.searchBox = $("#search-box");
  el.searchInput = $("#search-input");
  el.searchPanel = $("#search-panel");
  el.eraList = $("#era-list");
  el.catList = $("#cat-list");
  el.stats = $("#stats");
  el.statNodes = $("#stat-nodes");
  el.statEdges = $("#stat-edges");
  el.statSpan = $("#stat-span");
  el.dataMeta = $("#data-meta");
  el.visibleHint = $("#visible-hint");
  el.stageFilter = $("#stage-filter");
  el.filterSummary = $("#filter-summary");
  el.emptyState = $("#empty-state");
  el.draftChip = $("#draft-chip");
  el.draftText = $("#draft-text");
  el.editBar = $("#edit-bar");
  el.btnEdit = $("#btn-edit");
  el.btnGuide = $("#btn-guide");
  el.btnFit = $("#btn-fit");
  el.btnRepo = $("#btn-repo");
  el.btnMenu = $("#btn-menu");
  el.btnAccount = $("#btn-account");
  el.accountLabel = $("#account-label");
  el.liveStatus = $("#live-status");
  el.liveStatusText = $("#live-status-text");
  el.editHint = $("#edit-hint");
  el.btnNew = $("#btn-new");
  el.btnDone = $("#btn-done");
  el.loading = $("#loading");
  el.loadError = $("#load-error");
  el.loadErrorMessage = $("#load-error-message");
  el.stageTip = $("#stage-tip");
}

function setupGraph() {
  graph = new TechGraph({
    stage: el.stage,
    canvas: el.canvas,
    world: el.world,
    edgesEl: el.edges,
    nodesEl: el.nodes,
    minimapCanvas: el.minimapCanvas,
    zoomLabel: el.zoomLevel,
    onSelect: handleSelect,
    onVisibleChange: handleVisibleChange,
    onEditRequest: (node) => {
      if (state.editing) {
        openEditorFor(node);
        return;
      }
      showToast("进入编辑模式后，才能修改这棵树。", {
        tone: "info",
        action: {
          label: "进入编辑",
          onClick: () => {
            setEditing(true);
            if (state.editing) openEditorFor(node);
          },
        },
      });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* 加载与基础 UI                                                              */
/* -------------------------------------------------------------------------- */

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function hideLoading() {
  el.loading.classList.add("is-hidden");
  window.setTimeout(() => el.loading.remove(), 420);
}

function showLoadError(error) {
  el.loading?.remove();
  el.loadError.hidden = false;
  const isFile = window.location.protocol === "file:";
  el.loadErrorMessage.textContent = isFile
    ? "你正在用 file:// 直接打开页面，浏览器会阻止读取 data/tech.json。"
    : `读取数据时出错：${error?.message ?? error}`;
}

function renderRepoLink() {
  const repo = getRepoUrl();
  if (repo) {
    el.btnRepo.href = repo;
    el.btnRepo.hidden = false;
  } else {
    el.btnRepo.hidden = true;
  }
}

function updateSearchPlaceholder() {
  el.searchInput.placeholder = window.innerWidth <= 620 ? "搜索科技…" : "搜索科技、年份或分类…";
}

function readHash() {
  const match = window.location.hash.match(/^#tech=(.+)$/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

function writeHash(id) {
  const url = id
    ? `${window.location.pathname}${window.location.search}#tech=${encodeURIComponent(id)}`
    : `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(null, "", url);
}

/* -------------------------------------------------------------------------- */
/* 侧栏、统计与筛选                                                           */
/* -------------------------------------------------------------------------- */

function renderSidebar() {
  if (!state.data) return;
  const nodes = state.data.nodes;
  const eraCounts = new Map(ERA_ORDER.map((key) => [key, 0]));
  const categoryCounts = new Map(CATEGORY_ORDER.map((key) => [key, 0]));
  let edges = 0;

  for (const node of nodes) {
    if (eraCounts.has(node.era)) eraCounts.set(node.era, eraCounts.get(node.era) + 1);
    if (categoryCounts.has(node.category)) {
      categoryCounts.set(node.category, categoryCounts.get(node.category) + 1);
    }
    edges += node.prereqs?.length ?? 0;
  }

  el.eraList.innerHTML = ERA_ORDER.map((key) => {
    const era = ERAS[key];
    const active = state.filters.eras.has(key);
    return `<button class="filter-row" type="button" data-era="${key}" aria-pressed="${active}" title="${escapeHtml(era.range)}">
      <span class="era-dot" style="--era:${era.color}"></span>
      <span class="filter-label">${era.label}</span>
      <span class="filter-count">${eraCounts.get(key)}</span>
    </button>`;
  }).join("");

  el.catList.innerHTML = CATEGORY_ORDER.map((key) => {
    const category = CATEGORIES[key];
    const active = state.filters.categories.has(key);
    return `<button class="cat-chip" type="button" data-cat="${key}" aria-pressed="${active}">
      <span class="cat-dot" style="--cat:${category.color}"></span>
      <span>${category.label}</span>
      <em>${categoryCounts.get(key)}</em>
    </button>`;
  }).join("");

  const minYear = Math.min(...nodes.map((node) => node.year));
  const span = Math.max(1, Math.round((new Date().getFullYear() - minYear) / 10000));
  el.statNodes.textContent = String(nodes.length);
  el.statEdges.textContent = String(edges);
  el.statSpan.textContent = String(span);
  el.stats.title = `约 ${span} 万年的技术史`;

  const updated = state.base?.updated ? `数据更新于 ${state.base.updated}` : "数据已载入";
  el.dataMeta.textContent = `${updated} · ${nodes.length} 项科技 · ${edges} 条依赖`;
  updateFilterStates();
}

function updateFilterStates() {
  for (const button of el.eraList.querySelectorAll("[data-era]")) {
    button.setAttribute("aria-pressed", String(state.filters.eras.has(button.dataset.era)));
  }
  for (const button of el.catList.querySelectorAll("[data-cat]")) {
    button.setAttribute("aria-pressed", String(state.filters.categories.has(button.dataset.cat)));
  }
}

function applyFilters({ fit = true } = {}) {
  if (!graph) return;
  graph.setFilters(state.filters, { fit, animate: true });
  updateFilterStates();
  const total = state.data?.nodes.length ?? 0;
  const visible = graph.visibleIds.size;
  const filtered =
    state.filters.eras.size !== ERA_ORDER.length ||
    state.filters.categories.size !== CATEGORY_ORDER.length;
  el.stageFilter.hidden = !filtered;
  if (filtered) {
    el.filterSummary.textContent = `筛选中 · ${visible} / ${total} 项可见`;
  }
}

function resetFilters() {
  state.filters.eras = new Set(ERA_ORDER);
  state.filters.categories = new Set(CATEGORY_ORDER);
  applyFilters();
}

function soloEra(key) {
  const onlyThis = state.filters.eras.size === 1 && state.filters.eras.has(key);
  state.filters.eras = onlyThis ? new Set(ERA_ORDER) : new Set([key]);
  applyFilters();
}

function toggleCategory(key) {
  if (state.filters.categories.has(key)) state.filters.categories.delete(key);
  else state.filters.categories.add(key);
  applyFilters();
}

function handleVisibleChange({ visible, total }) {
  el.visibleHint.textContent = visible === total ? "" : `显示 ${visible}/${total}`;
  el.emptyState.hidden = visible !== 0;
  if (!visible) {
    el.stageFilter.hidden = true;
  }
  document.body.classList.toggle("is-filtered", visible !== total);
}

/* -------------------------------------------------------------------------- */
/* 实时协作                                                                   */
/* -------------------------------------------------------------------------- */

function updateLiveUI() {
  document.body.classList.toggle("is-live", state.live);
  el.btnAccount.hidden = !state.live;
  el.liveStatus.hidden = !state.live;
  if (!state.live) return;

  el.accountLabel.textContent = state.user ? `@${state.user.username}` : "登录 / 注册";
  el.btnAccount.title = state.user
    ? `已登录：${roleLabel(state.user.role)} · 点击账户与历史`
    : "登录或注册后即可编辑";
  el.btnAccount.classList.toggle("is-signed-in", Boolean(state.user));
  el.liveStatus.classList.toggle("is-offline", !state.liveConnected);
  el.liveStatusText.textContent = state.liveConnected
    ? `实时协作 · ${state.online} 人在看`
    : "实时连接中断，正在重连…";
  el.btnEdit.title = state.user ? "进入编辑模式" : "登录后可编辑";
  if (state.editing) {
    el.editHint.textContent = "实时协作 · 保存后立即广播";
  }
}

function handlePresence(online) {
  state.online = Number(online) || 0;
  updateLiveUI();
}

function handleUserChange(user) {
  state.user = user;
  if (!user && state.editing) setEditing(false);
  updateLiveUI();
}

function handleLiveConnection(connected) {
  const was = state.liveConnected;
  state.liveConnected = Boolean(connected);
  updateLiveUI();
  if (!connected && was) {
    showToast("实时连接中断，正在自动重连…", { tone: "warn", duration: 3200 });
  }
}

function handleRemoteData(payload) {
  if (!state.live || !payload?.data || !state.data) return;
  const previousSelected = state.selectedId;
  state.data = payload.data;
  state.base = clone(payload.data);
  state.validation = validateData(payload.data);

  graph.setData(payload.data, { keepView: true });
  if (previousSelected) {
    const node = payload.data.nodes.find((candidate) => candidate.id === previousSelected);
    if (node) {
      graph.select(previousSelected, { silent: true });
      if (el.detail.classList.contains("is-open")) renderDetail(node);
    }
  }

  renderSidebar();
  updateDraftUI();

  const actor = payload.actor;
  const revision = payload.revision;
  if (
    actor &&
    state.user &&
    actor.id !== state.user.id &&
    Date.now() - state.lastRemoteToast > 3200
  ) {
    state.lastRemoteToast = Date.now();
    showToast(
      `${actor.username} ${actionLabel(revision?.action)}了「${revision?.targetName ?? "科技树"}」`,
      { tone: "info", duration: 2600 },
    );
  }
}

function actionLabel(action) {
  return (
    {
      create: "新增",
      update: "修改",
      delete: "删除",
      restore: "恢复",
      import: "导入",
    }[action] ?? "更新"
  );
}

function roleLabel(role) {
  return role === "admin" ? "管理员" : "贡献者";
}

function openAuthModal(mode = "login") {
  if (!state.live) return;
  let activeMode = mode === "register" && state.registration ? "register" : "login";

  const body = `
    <div class="auth">
      <div class="auth-tabs" role="tablist" aria-label="登录或注册">
        <button class="auth-tab" type="button" role="tab" data-auth-tab="login">登录</button>
        <button class="auth-tab" type="button" role="tab" data-auth-tab="register" ${state.registration ? "" : "disabled"}>注册</button>
      </div>
      <form class="auth-form" id="auth-form" novalidate>
        <div class="form-message" id="auth-message" hidden></div>
        <label class="field">
          <span class="field-label">用户名</span>
          <input name="username" maxlength="24" autocomplete="username" required data-autofocus placeholder="2–24 个字符" />
        </label>
        <label class="field">
          <span class="field-label">密码</span>
          <input name="password" type="password" maxlength="200" autocomplete="current-password" required placeholder="至少 8 位" />
        </label>
        <label class="field" data-register-only hidden>
          <span class="field-label">确认密码</span>
          <input name="password2" type="password" maxlength="200" autocomplete="new-password" />
        </label>
        <p class="auth-note" data-register-only hidden>注册后立刻可以编辑；用户名会出现在版本历史里。</p>
        <p class="auth-note auth-closed" ${state.registration ? "hidden" : ""}>当前服务器关闭了开放注册，请联系管理员创建账号。</p>
        <button class="btn btn-primary auth-submit" type="submit">登录</button>
      </form>
      <p class="auth-foot">密码使用 scrypt 哈希保存；会话有效期 7 天。公开部署建议设置 <code>REGISTRATION=closed</code> 并使用邀请账号。</p>
    </div>`;

  const modal = openModal({
    title: "实时协作账户",
    subtitle: "登录后，改动会立即写入服务器并广播给所有在线的人",
    body,
  });

  const tabs = [...modal.element.querySelectorAll("[data-auth-tab]")];
  const form = modal.element.querySelector("#auth-form");
  const message = modal.element.querySelector("#auth-message");
  const submit = modal.element.querySelector(".auth-submit");
  const registerOnly = [...modal.element.querySelectorAll("[data-register-only]")];
  const password = form.elements.password;

  function setMode(next) {
    activeMode = next;
    tabs.forEach((tab) => {
      const selected = tab.dataset.authTab === next;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    registerOnly.forEach((element) => {
      element.hidden = next !== "register";
    });
    submit.textContent = next === "register" ? "注册并开始编辑" : "登录";
    password.autocomplete = next === "register" ? "new-password" : "current-password";
    message.hidden = true;
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      if (!tab.disabled) setMode(tab.dataset.authTab);
    });
  });
  setMode(activeMode);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = form.elements.username.value.trim();
    const pass = form.elements.password.value;
    const pass2 = form.elements.password2.value;
    if (activeMode === "register" && pass !== pass2) {
      message.hidden = false;
      message.innerHTML = '<p class="form-error-line">两次输入的密码不一致。</p>';
      return;
    }
    submit.disabled = true;
    submit.textContent = "请稍候…";
    try {
      if (activeMode === "register") await state.liveClient.register(username, pass);
      else await state.liveClient.login(username, pass);
      state.user = state.liveClient.user;
      updateLiveUI();
      modal.forceClose();
      showToast(`已登录：@${state.user.username}`, { tone: "success" });
    } catch (error) {
      message.hidden = false;
      message.innerHTML = `<p class="form-error-line">${escapeHtml(error.message)}</p>`;
    } finally {
      submit.disabled = false;
      submit.textContent = activeMode === "register" ? "注册并开始编辑" : "登录";
    }
  });
}

function openAccountModal() {
  if (!state.live) return;
  if (!state.user) {
    openAuthModal("login");
    return;
  }

  const modal = openModal({
    title: "账户",
    subtitle: state.liveConnected ? `实时连接正常 · ${state.online} 人在看` : "实时连接中断，正在重连",
    body: `
      <div class="account-card">
        <div class="account-avatar" aria-hidden="true">@</div>
        <div class="account-main">
          <h3>@${escapeHtml(state.user.username)}</h3>
          <p><span class="role-chip ${state.user.role === "admin" ? "is-admin" : ""}">${roleLabel(state.user.role)}</span><span class="account-online">${state.online} 人在看</span></p>
        </div>
      </div>
      <div class="account-actions">
        <button class="btn" type="button" data-history>版本历史</button>
        <button class="btn btn-ghost" type="button" data-logout>退出登录</button>
      </div>
      <details class="account-password">
        <summary>修改密码</summary>
        <form class="auth-form" id="password-form">
          <div class="form-message" id="password-message" hidden></div>
          <label class="field"><span class="field-label">当前密码</span><input name="current" type="password" autocomplete="current-password" required /></label>
          <label class="field"><span class="field-label">新密码</span><input name="next" type="password" autocomplete="new-password" required placeholder="至少 8 位" /></label>
          <button class="btn btn-small" type="submit">更新密码</button>
        </form>
      </details>`,
    footer: `<span class="modal-foot-note">登录状态仅保存在 HttpOnly Cookie 中</span><div class="modal-foot-spacer"></div><button class="btn btn-ghost" type="button" data-close>关闭</button>`,
  });

  modal.element.querySelector("[data-close]").addEventListener("click", () => modal.close());
  modal.element.querySelector("[data-history]").addEventListener("click", () => {
    modal.forceClose();
    openHistoryModal();
  });
  modal.element.querySelector("[data-logout]").addEventListener("click", async () => {
    try {
      await state.liveClient.logout();
      state.user = null;
      updateLiveUI();
      setEditing(false);
      modal.forceClose();
      showToast("已退出登录。", { tone: "info" });
    } catch (error) {
      showToast(error.message, { tone: "error" });
    }
  });

  const passwordForm = modal.element.querySelector("#password-form");
  const passwordMessage = modal.element.querySelector("#password-message");
  passwordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = passwordForm.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await state.liveClient.changePassword(
        passwordForm.elements.current.value,
        passwordForm.elements.next.value,
      );
      passwordMessage.hidden = false;
      passwordMessage.innerHTML = '<p class="form-success-line">密码已更新。</p>';
      passwordForm.reset();
    } catch (error) {
      passwordMessage.hidden = false;
      passwordMessage.innerHTML = `<p class="form-error-line">${escapeHtml(error.message)}</p>`;
    } finally {
      button.disabled = false;
    }
  });
}

async function openHistoryModal() {
  if (!state.live) return;
  let payload;
  try {
    payload = await state.liveClient.listRevisions();
  } catch (error) {
    showToast(`读取版本历史失败：${error.message}`, { tone: "error" });
    return;
  }

  const revisions = payload.revisions ?? [];
  const admin = state.user?.role === "admin";
  const rows = revisions
    .map((revision) => {
      const user = revision.user?.username ?? "系统";
      return `<li class="history-row">
        <span class="history-rev">#${revision.revision}</span>
        <span class="history-main">
          <span class="history-title">${actionLabel(revision.action)} ${escapeHtml(revision.targetName ?? "科技树")}</span>
          <span class="history-meta">${formatDateTime(revision.at)} · @${escapeHtml(user)}</span>
        </span>
        ${
          admin
            ? `<button class="btn btn-small btn-ghost" type="button" data-restore="${escapeHtml(revision.id)}" data-revision="${revision.revision}">恢复</button>`
            : ""
        }
      </li>`;
    })
    .join("");

  const modal = openModal({
    title: "版本历史",
    subtitle: `当前版本 #${payload.current ?? "—"} · 仅保留最近 200 个快照`,
    body: `<ul class="history-list">${rows || '<li class="history-empty">还没有版本记录。</li>'}</ul>`,
    wide: true,
    footer: `<span class="modal-foot-note">${admin ? "管理员可以恢复到任意快照；恢复本身也会写入历史。" : "只有管理员可以恢复版本。"}</span><div class="modal-foot-spacer"></div><button class="btn btn-ghost" type="button" data-close>关闭</button>`,
  });

  modal.element.querySelector("[data-close]").addEventListener("click", () => modal.close());
  modal.element.querySelectorAll("[data-restore]").forEach((button) => {
    button.addEventListener("click", async () => {
      const revision = button.dataset.revision;
      if (!window.confirm(`恢复到版本 #${revision}？当前数据会保留在历史中。`)) return;
      button.disabled = true;
      button.textContent = "恢复中…";
      try {
        const result = await state.liveClient.restoreRevision(button.dataset.restore);
        handleRemoteData(result);
        modal.forceClose();
        showToast(`已恢复到版本 #${revision}。`, { tone: "success" });
      } catch (error) {
        button.disabled = false;
        button.textContent = "恢复";
        showToast(`恢复失败：${error.message}`, { tone: "error" });
      }
    });
  });
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

/* -------------------------------------------------------------------------- */
/* 选择、详情面板                                                             */
/* -------------------------------------------------------------------------- */

function handleSelect(node) {
  state.selectedId = node?.id ?? null;
  if (!node) {
    hideDetail();
    writeHash("");
    return;
  }
  renderDetail(node);
  showDetail();
  writeHash(node.id);
  if (window.innerWidth <= 900) closeSidebar();
}

function showDetail() {
  window.clearTimeout(state.detailHideTimer);
  el.detail.hidden = false;
  requestAnimationFrame(() => el.detail.classList.add("is-open"));
  el.stage.classList.add("has-detail");
  el.detailScrim.hidden = window.innerWidth > 900;
  el.detail.scrollTop = 0;
  document.body.classList.add("detail-open");
  graph?.setRightInset(window.innerWidth > 900 ? el.detail.offsetWidth : 0);
}

function hideDetail() {
  el.detail.classList.remove("is-open");
  el.stage.classList.remove("has-detail");
  el.detailScrim.hidden = true;
  document.body.classList.remove("detail-open");
  graph?.setRightInset(0);
  window.clearTimeout(state.detailHideTimer);
  state.detailHideTimer = window.setTimeout(() => {
    if (!el.detail.classList.contains("is-open")) el.detail.hidden = true;
  }, 260);
}

function renderDetail(node) {
  const era = ERAS[node.era] ?? { label: node.era, color: "#8fa3bf", range: "" };
  const category = CATEGORIES[node.category] ?? { label: node.category, color: "#8fa3bf" };
  const status = node.status && node.status !== "established" ? STATUSES[node.status] : null;
  const prereqs = (node.prereqs ?? [])
    .map((id) => graph.nodeMap.get(id))
    .filter(Boolean)
    .sort((a, b) => a.year - b.year);
  const unlocks = state.data.nodes
    .filter((candidate) => (candidate.prereqs ?? []).includes(node.id))
    .sort((a, b) => a.year - b.year);
  const wikiUrl = `https://zh.wikipedia.org/w/index.php?search=${encodeURIComponent(node.name)}&ns0=1`;

  el.detail.innerHTML = `
    <div class="detail-inner">
      <button class="icon-btn detail-close" type="button" data-close aria-label="关闭详情">
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
      </button>

      <div class="detail-kicker">
        <span class="era-chip" style="--era:${era.color}"><i></i>${escapeHtml(era.label)}</span>
        <span class="cat-chip-static" style="--cat:${category.color}"><i></i>${escapeHtml(category.label)}</span>
        ${status ? `<span class="status-chip" style="--status:${status.color}">${escapeHtml(status.label)}</span>` : ""}
      </div>

      <h2>${escapeHtml(node.name)}</h2>
      ${node.nameEn ? `<p class="detail-en">${escapeHtml(node.nameEn)}</p>` : ""}
      <div class="detail-meta">
        <span class="detail-year">${formatYear(node.year, node.approx)}</span>
        <span class="meta-sep">·</span>
        <span>${escapeHtml(era.range)}</span>
      </div>

      <p class="detail-summary">${escapeHtml(node.summary)}</p>
      ${node.description ? `<p class="detail-desc">${escapeHtml(node.description).replaceAll("\n", "<br />")}</p>` : ""}

      <section class="detail-section">
        <h3>前置科技 <span>${prereqs.length}</span></h3>
        ${
          prereqs.length
            ? `<div class="dep-list">${prereqs.map(depRow).join("")}</div>`
            : '<p class="dep-empty">无已知前置 · 这是这棵树的根节点。</p>'
        }
      </section>

      <section class="detail-section">
        <h3>解锁 <span>${unlocks.length}</span></h3>
        ${
          unlocks.length
            ? `<div class="dep-list">${unlocks.map(depRow).join("")}</div>`
            : '<p class="dep-empty">还没有记录由它直接解锁的后续技术。</p>'
        }
      </section>

      ${node.tags?.length ? `<div class="detail-tags">${node.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}

      ${
        node.sources?.length
          ? `<section class="detail-section"><h3>来源</h3><div class="source-list">${node.sources
              .map(
                (source) =>
                  `<a class="source-link" href="${escapeHtml(source.url)}" target="_blank" rel="noopener">${escapeHtml(source.label || source.url)}<span>↗</span></a>`,
              )
              .join("")}</div></section>`
          : ""
      }

      <div class="detail-actions">
        <button class="btn btn-outline" type="button" data-edit>编辑此节点</button>
        <a class="btn btn-ghost" href="${wikiUrl}" target="_blank" rel="noopener">维基百科查证 ↗</a>
      </div>
      <p class="detail-foot">年代为学界常用近似值；前置关系表示“缺少它，这项技术难以出现”，不表示唯一原因。</p>
    </div>`;
}

function depRow(item) {
  const era = ERAS[item.era] ?? { color: "#8fa3bf" };
  return `<button class="dep-row" type="button" data-goto="${escapeHtml(item.id)}">
    <span class="era-dot" style="--era:${era.color}"></span>
    <span class="dep-name">${escapeHtml(item.name)}</span>
    <span class="dep-year">${formatYear(item.year, item.approx)}</span>
    <span class="dep-arrow" aria-hidden="true">›</span>
  </button>`;
}

/* -------------------------------------------------------------------------- */
/* 编辑、草稿与导出                                                           */
/* -------------------------------------------------------------------------- */

function setEditing(on) {
  if (on && state.live && !state.user) {
    openAuthModal("login");
    return;
  }
  state.editing = Boolean(on);
  document.body.classList.toggle("editing", state.editing);
  el.btnEdit.setAttribute("aria-pressed", String(state.editing));
  el.btnEdit.classList.toggle("is-active", state.editing);
  el.editBar.hidden = !state.editing;
  if (state.editing) {
    el.stageTip.classList.add("is-hidden");
    el.editHint.textContent = state.live
      ? "实时协作 · 保存后立即广播"
      : "点击节点修改，双击直接打开";
  }
}

function openEditorFor(node) {
  if (state.live && !state.user) {
    openAuthModal("login");
    return;
  }
  openNodeEditor({
    node,
    nodes: state.data.nodes,
    onSave: handleSave,
    onDelete: handleDelete,
    canDelete: !state.live || state.user?.role === "admin",
    live: state.live,
  });
}

async function handleSave(next, { isNew }) {
  if (!state.data) return;

  if (state.live) {
    const eraWasVisible = state.filters.eras.has(next.era);
    const categoryWasVisible = state.filters.categories.has(next.category);
    state.filters.eras.add(next.era);
    state.filters.categories.add(next.category);
    if (!eraWasVisible || !categoryWasVisible) {
      graph.setFilters(state.filters, { fit: false, animate: false });
    }

    const payload = await state.liveClient.saveNode(next);
    handleRemoteData(payload);
    graph.select(next.id, { center: true, animate: true });
    updateFilterStates();
    showToast(isNew ? `已发布“${next.name}”。` : `已保存“${next.name}”的修改。`, {
      tone: "success",
      duration: 3200,
    });
    return;
  }

  if (isNew) {
    state.data.nodes.push(next);
  } else {
    state.data.nodes = state.data.nodes.map((node) => (node.id === next.id ? next : node));
  }

  const eraWasVisible = state.filters.eras.has(next.era);
  const categoryWasVisible = state.filters.categories.has(next.category);
  state.filters.eras.add(next.era);
  state.filters.categories.add(next.category);
  if (!eraWasVisible || !categoryWasVisible) {
    // graph 持有自己的筛选副本；新增/改分类后先同步，否则 focusId 可能不可见。
    graph.setFilters(state.filters, { fit: false, animate: false });
  }
  state.validation = validateData(state.data);

  graph.setData(state.data, { focusId: next.id, keepView: true });
  graph.select(next.id, { center: false });
  graph.setMatches(state.searchQuery ? searchNodes(state.searchQuery).map((item) => item.node.id) : []);
  renderSidebar();
  updateFilterStates();
  persistDraft();
  updateDraftUI();

  showToast(isNew ? `已把“${next.name}”加入草稿。` : `已保存“${next.name}”的修改。`, {
    tone: "success",
    duration: 3200,
  });
}

async function handleDelete(node) {
  if (!state.data) return;

  if (state.live) {
    const payload = await state.liveClient.deleteNode(node.id);
    graph.clearSelection();
    handleRemoteData(payload);
    showToast(`已删除“${node.name}”。`, { tone: "warn", duration: 3200 });
    return;
  }

  graph.clearSelection();
  state.data.nodes = state.data.nodes
    .filter((candidate) => candidate.id !== node.id)
    .map((candidate) => ({
      ...candidate,
      prereqs: (candidate.prereqs ?? []).filter((prereq) => prereq !== node.id),
    }));
  state.validation = validateData(state.data);
  graph.setData(state.data, { keepView: true });
  renderSidebar();
  persistDraft();
  updateDraftUI();
  showToast(`已从草稿中删除“${node.name}”。`, { tone: "warn", duration: 3200 });
}

function persistDraft() {
  if (state.live) return;
  if (!state.data || !state.base) return;
  const diff = diffData(state.base, state.data);
  state.diff = diff;
  if (!diff.dirty) {
    clearDraft();
    state.draftSavedAt = null;
    return;
  }
  const ok = writeDraft(state.data, state.base);
  state.draftSavedAt = new Date().toISOString();
  if (!ok) {
    showToast("浏览器无法保存本地草稿（可能是隐私模式）。请及时导出 JSON。", {
      tone: "error",
      duration: 6000,
    });
  }
}

function updateDraftUI() {
  if (state.live) {
    el.draftChip.hidden = true;
    document.title = "人类科技树 · Tech Tree of Humanity";
    return;
  }
  if (!state.data || !state.base) return;
  const diff = diffData(state.base, state.data);
  state.diff = diff;
  el.draftChip.hidden = !diff.dirty;
  el.draftText.textContent = `草稿 · ${diff.count} 处未提交`;
  document.title = diff.dirty ? "● 人类科技树 · Tech Tree of Humanity" : "人类科技树 · Tech Tree of Humanity";
  if (!diff.dirty) clearDraft();
}

function openDraftModal() {
  if (state.live) {
    openHistoryModal();
    return;
  }
  if (!state.data || !state.base) return;
  const diff = diffData(state.base, state.data);
  const validation = validateData(state.data);
  openDiff({
    base: state.base,
    data: state.data,
    diff,
    validation,
    stale: state.staleDraft,
    onExport: () => exportData(),
    onDiscard: () => resetDraft({ ask: false }),
    onCopy: () => copyExportJson(),
  });
}

function exportPayload() {
  const payload = clone(state.data);
  payload.updated = new Date().toISOString().slice(0, 10);
  payload.title = payload.title || CONFIG.siteName;
  payload.license = payload.license || CONFIG.license;
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function exportData({ force = false } = {}) {
  if (!state.data) return;
  const validation = validateData(state.data);
  state.validation = validation;
  if (!validation.ok && !force) {
    openValidationModal(validation, () => exportData({ force: true }));
    return;
  }

  const json = exportPayload();
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "tech.json";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);

  const warnings = validation.warnings.length;
  showToast(
    warnings ? `已导出 tech.json，含 ${warnings} 条提示，提交前请再看一眼。` : "已导出 tech.json，可以提交 PR 了。",
    { tone: "success", duration: 5400 },
  );
}

async function copyExportJson() {
  const json = exportPayload();
  try {
    await navigator.clipboard.writeText(json);
    showToast("已复制完整 JSON 到剪贴板。", { tone: "success" });
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = json;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
      showToast("已复制完整 JSON 到剪贴板。", { tone: "success" });
    } catch {
      showToast("复制失败，请使用“导出 tech.json”。", { tone: "error" });
    }
    textarea.remove();
  }
}

function openValidationModal(validation, onForce) {
  const errors = validation.errors
    .map((error) => `<li>${escapeHtml(error.message)}</li>`)
    .join("");
  const warnings = validation.warnings
    .slice(0, 8)
    .map((warning) => `<li>${escapeHtml(warning.message)}</li>`)
    .join("");
  const modal = openModal({
    title: `还有 ${validation.errors.length} 个校验错误`,
    subtitle: "这些问题会让 CI 拒绝合并，建议先修复",
    body: `
      <div class="problems">
        <ul class="problem-list">${errors}</ul>
        ${warnings ? `<p class="problems-sub">另外还有 ${validation.warnings.length} 条提示：</p><ul class="warning-list">${warnings}</ul>` : ""}
      </div>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-cancel>返回修改</button>
      <div class="modal-foot-spacer"></div>
      <button class="btn btn-danger" type="button" data-force>仍然导出</button>`,
  });
  modal.element.querySelector("[data-cancel]").addEventListener("click", () => modal.close());
  modal.element.querySelector("[data-force]").addEventListener("click", () => {
    modal.forceClose();
    onForce();
  });
}

async function resetDraft({ ask = true } = {}) {
  if (state.live) return;
  if (!state.base) return;
  if (ask) {
    const confirmed = await confirmModal({
      title: "恢复线上版本？",
      message: "所有本地新增、修改和删除都会丢失。",
      confirmText: "恢复",
      danger: true,
    });
    if (!confirmed) return;
  }
  state.data = clone(state.base);
  state.staleDraft = false;
  state.validation = validateData(state.data);
  clearDraft();
  graph.clearSelection();
  graph.setData(state.data, { keepView: true });
  renderSidebar();
  updateDraftUI();
  showToast("已恢复到线上版本。", { tone: "success" });
}

function openGuideModal() {
  openGuide({
    onEdit: () => setEditing(true),
    onExport: () => exportData(),
    onLogin: () => openAuthModal("login"),
    onHistory: () => openHistoryModal(),
    live: state.live,
    user: state.user,
  });
}

/* -------------------------------------------------------------------------- */
/* 搜索                                                                       */
/* -------------------------------------------------------------------------- */

function normalizeSearch(text) {
  return String(text ?? "").toLowerCase().replace(/\s+/g, "");
}

function searchNodes(query) {
  const q = normalizeSearch(query);
  if (!q || !state.data) return [];
  const results = [];
  for (const node of state.data.nodes) {
    const name = normalizeSearch(node.name);
    const nameEn = normalizeSearch(node.nameEn);
    const tags = normalizeSearch((node.tags ?? []).join(" "));
    const summary = normalizeSearch(node.summary);
    const years = `${normalizeSearch(formatYear(node.year, node.approx))}${node.year}`;
    let score = 0;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 82;
    else if (name.includes(q)) score = 64;
    else if (nameEn.includes(q)) score = 54;
    else if (tags.includes(q)) score = 42;
    else if (summary.includes(q)) score = 24;
    else if (years.includes(q)) score = 18;
    if (score) results.push({ node, score });
  }
  results.sort((a, b) => b.score - a.score || b.node.year - a.node.year);
  return results;
}

function openSearchPanel() {
  el.searchPanel.hidden = false;
  el.searchInput.setAttribute("aria-expanded", "true");
}

function closeSearchPanel({ clear = false } = {}) {
  el.searchPanel.hidden = true;
  el.searchInput.setAttribute("aria-expanded", "false");
  state.activeSearchIndex = -1;
  if (clear) {
    el.searchInput.value = "";
    state.searchQuery = "";
    state.searchResults = [];
    state.searchMatchCount = 0;
    graph.setMatches([]);
  }
}

function updateSearch() {
  const query = el.searchInput.value.trim();
  state.searchQuery = query;
  if (!query) {
    state.searchResults = [];
    state.searchMatchCount = 0;
    state.activeSearchIndex = -1;
    graph.setMatches([]);
    renderSearchQuick();
    openSearchPanel();
    return;
  }
  const all = searchNodes(query);
  state.searchMatchCount = all.length;
  state.searchResults = all.slice(0, 9).map((item) => item.node);
  state.activeSearchIndex = state.searchResults.length ? 0 : -1;
  graph.setMatches(all.map((item) => item.node.id));
  renderSearchResults();
  openSearchPanel();
}

function renderSearchQuick() {
  const quickIds = ["fire", "printing-press", "steam-engine", "transistor", "llm"];
  const quick = quickIds
    .map((id) => graph.nodeMap.get(id))
    .filter(Boolean)
    .map(
      (node) =>
        `<button class="search-quick" type="button" data-quick="${escapeHtml(node.id)}">${escapeHtml(node.name)}</button>`,
    )
    .join("");
  el.searchPanel.innerHTML = `
    <div class="search-empty">
      <p class="search-title">搜索 ${state.data?.nodes.length ?? 0} 项科技</p>
      <p class="search-sub">支持名称、英文名、标签、简介和年份。</p>
      <div class="search-quick-list">${quick}</div>
    </div>`;
}

function renderSearchResults() {
  if (!state.searchResults.length) {
    el.searchPanel.innerHTML = `
      <div class="search-empty">
        <p class="search-title">没有匹配“${escapeHtml(state.searchQuery)}”的科技</p>
        <p class="search-sub">试试更短的关键词，或检查时代筛选是否遮住了它。</p>
      </div>`;
    return;
  }
  const rows = state.searchResults
    .map((node, index) => {
      const era = ERAS[node.era] ?? { color: "#8fa3bf" };
      const category = CATEGORIES[node.category] ?? { label: "" };
      return `<button class="search-result ${index === state.activeSearchIndex ? "is-active" : ""}" type="button"
        role="option" aria-selected="${index === state.activeSearchIndex}" data-result="${escapeHtml(node.id)}">
        <span class="era-dot" style="--era:${era.color}"></span>
        <span class="search-result-main">
          <span class="search-result-name">${escapeHtml(node.name)}</span>
          <span class="search-result-meta">${formatYear(node.year, node.approx)} · ${escapeHtml(category.label)}</span>
        </span>
        <span class="search-result-era">${escapeHtml(era.label)}</span>
      </button>`;
    })
    .join("");
  el.searchPanel.innerHTML = `
    <div class="search-head"><span>${state.searchMatchCount} 项匹配</span><span class="search-head-note">已在树中高亮</span></div>
    <div class="search-results" role="listbox">${rows}</div>
    <div class="search-foot">↑↓ 选择 · Enter 定位 · Esc 关闭</div>`;
}

function selectSearchResult(id) {
  const node = graph.nodeMap.get(id);
  if (!node) return;
  let changed = false;
  if (!state.filters.eras.has(node.era)) {
    state.filters.eras.add(node.era);
    changed = true;
  }
  if (!state.filters.categories.has(node.category)) {
    state.filters.categories.add(node.category);
    changed = true;
  }
  if (changed) {
    graph.setFilters(state.filters, { fit: false, animate: false });
    updateFilterStates();
  }
  closeSearchPanel();
  el.searchInput.blur();
  graph.select(id, { center: true, animate: true });
}

function moveSearchSelection(delta) {
  if (!state.searchResults.length) return;
  const count = state.searchResults.length;
  state.activeSearchIndex = (state.activeSearchIndex + delta + count) % count;
  const rows = el.searchPanel.querySelectorAll(".search-result");
  rows.forEach((row, index) => {
    row.classList.toggle("is-active", index === state.activeSearchIndex);
    row.setAttribute("aria-selected", String(index === state.activeSearchIndex));
  });
  rows[state.activeSearchIndex]?.scrollIntoView({ block: "nearest" });
}

/* -------------------------------------------------------------------------- */
/* 事件绑定                                                                   */
/* -------------------------------------------------------------------------- */

function bindUI() {
  el.btnFit.addEventListener("click", () => graph.fit({ animate: true }));
  el.btnEdit.addEventListener("click", () => setEditing(!state.editing));
  el.btnAccount.addEventListener("click", () => {
    if (!state.live) return;
    if (state.user) openAccountModal();
    else openAuthModal("login");
  });
  el.btnGuide.addEventListener("click", openGuideModal);
  el.btnNew.addEventListener("click", () => openEditorFor(null));
  el.btnDone.addEventListener("click", () => setEditing(false));
  el.btnMenu.addEventListener("click", toggleSidebar);
  el.sidebarScrim.addEventListener("click", closeSidebar);
  el.detailScrim.addEventListener("click", () => graph.clearSelection());
  $("#btn-reset-filters").addEventListener("click", resetFilters);
  $("#btn-clear-filter").addEventListener("click", resetFilters);
  $("#btn-empty-reset").addEventListener("click", resetFilters);
  el.draftChip.addEventListener("click", openDraftModal);
  $("#btn-reload").addEventListener("click", () => window.location.reload());
  $("#btn-copy-serve").addEventListener("click", () => copyText("python -m http.server 4173", "启动命令已复制。"));

  for (const button of document.querySelectorAll("[data-zoom]")) {
    button.addEventListener("click", () => {
      const action = button.dataset.zoom;
      if (action === "in") graph.zoomBy(1.22);
      else if (action === "out") graph.zoomBy(1 / 1.22);
      else graph.fit({ animate: true });
    });
  }

  el.eraList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-era]");
    if (!button) return;
    const key = button.dataset.era;
    if (state.filters.eras.has(key)) state.filters.eras.delete(key);
    else state.filters.eras.add(key);
    applyFilters();
  });
  el.eraList.addEventListener("dblclick", (event) => {
    const button = event.target.closest("[data-era]");
    if (button) soloEra(button.dataset.era);
  });
  el.catList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-cat]");
    if (button) toggleCategory(button.dataset.cat);
  });

  el.searchInput.addEventListener("input", updateSearch);
  el.searchInput.addEventListener("focus", () => {
    if (window.innerWidth <= 900) closeSidebar();
    if (el.searchInput.value.trim()) updateSearch();
    else {
      renderSearchQuick();
      openSearchPanel();
    }
  });
  el.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSearchSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSearchSelection(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const id = state.searchResults[state.activeSearchIndex]?.id ?? state.searchResults[0]?.id;
      if (id) selectSearchResult(id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSearchPanel({ clear: true });
      el.searchInput.blur();
    }
  });

  el.searchPanel.addEventListener("click", (event) => {
    const result = event.target.closest("[data-result]");
    if (result) {
      selectSearchResult(result.dataset.result);
      return;
    }
    const quick = event.target.closest("[data-quick]");
    if (quick) selectSearchResult(quick.dataset.quick);
  });

  document.addEventListener("pointerdown", (event) => {
    if (!el.searchBox.contains(event.target)) closeSearchPanel();
  });

  el.detail.addEventListener("click", (event) => {
    if (event.target.closest("[data-close]")) {
      graph.clearSelection();
      return;
    }
    const goto = event.target.closest("[data-goto]");
    if (goto) {
      graph.select(goto.dataset.goto, { center: true });
      return;
    }
    if (event.target.closest("[data-edit]")) {
      const node = graph.nodeMap.get(state.selectedId);
      if (!node) return;
      setEditing(true);
      if (state.editing) openEditorFor(node);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (document.querySelector(".modal-backdrop")) return;
    const target = event.target;
    if (target === el.searchInput) return;
    const typing =
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable);

    if (event.key === "Escape") {
      if (!el.searchPanel.hidden) {
        closeSearchPanel({ clear: true });
        el.searchInput.blur();
      } else if (graph.selected) {
        graph.clearSelection();
      } else if (state.editing) {
        setEditing(false);
      } else if (document.body.classList.contains("sidebar-open")) {
        closeSidebar();
      }
      return;
    }

    if (typing) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === "/") {
      event.preventDefault();
      el.searchInput.focus();
      el.searchInput.select();
    } else if (event.key === "e" || event.key === "E") {
      event.preventDefault();
      setEditing(!state.editing);
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      graph.zoomBy(1.2);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      graph.zoomBy(1 / 1.2);
    } else if (event.key === "0") {
      event.preventDefault();
      graph.fit({ animate: true });
    }
  });

  window.addEventListener("hashchange", () => {
    const id = readHash();
    if (id && graph.nodeMap.has(id)) graph.select(id, { center: true });
    else if (!id && graph.selected) graph.clearSelection();
  });

  window.addEventListener("resize", () => {
    updateSearchPlaceholder();
    if (window.innerWidth > 900) {
      closeSidebar();
      if (el.detail.classList.contains("is-open")) {
        el.detailScrim.hidden = true;
        graph.setRightInset(el.detail.offsetWidth);
      }
    } else if (el.detail.classList.contains("is-open")) {
      graph.setRightInset(0);
    }
  });

  el.stageTip.addEventListener("click", () => el.stageTip.classList.add("is-hidden"));
  window.setTimeout(() => el.stageTip.classList.add("is-dim"), 6500);
}

function toggleSidebar() {
  const open = !document.body.classList.contains("sidebar-open");
  if (open) {
    closeSearchPanel();
    if (graph.selected) graph.clearSelection();
  }
  document.body.classList.toggle("sidebar-open", open);
  el.sidebarScrim.hidden = !open;
  el.btnMenu.setAttribute("aria-expanded", String(open));
}

function closeSidebar() {
  document.body.classList.remove("sidebar-open");
  el.sidebarScrim.hidden = true;
  el.btnMenu.setAttribute("aria-expanded", "false");
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(message, { tone: "success" });
  } catch {
    showToast("复制失败，请手动输入命令。", { tone: "error" });
  }
}
