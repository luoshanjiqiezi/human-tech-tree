import {
  CATEGORIES,
  CATEGORY_ORDER,
  ERAS,
  ERA_ORDER,
  STATUSES,
  YEAR_MAX,
  YEAR_MIN,
  escapeHtml,
  formatYear,
  makeId,
} from "./constants.js";
import { openModal } from "./modal.js";
import { wouldCreateCycle } from "./validate.js";
import { getIssueUrl, getRepoUrl } from "./config.js";

const FIELD_LABELS = {
  name: "名称",
  nameEn: "英文名",
  year: "年份",
  approx: "约数标记",
  era: "时代",
  category: "分类",
  summary: "简介",
  description: "详细说明",
  prereqs: "前置科技",
  tags: "标签",
  sources: "来源",
  status: "状态",
};

function yearHint(year) {
  return formatYear(Number(year) || 0, false);
}

function sourceLines(sources = []) {
  return sources.map((source) => `${source.label || "来源"} | ${source.url}`).join("\n");
}

function parseSources(text) {
  const sources = [];
  const errors = [];
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split("|");
    let label = "来源";
    let url = line;
    if (parts.length >= 2) {
      label = parts[0].trim() || "来源";
      url = parts.slice(1).join("|").trim();
    }
    if (!/^https?:\/\/\S+$/i.test(url)) {
      errors.push(`来源链接格式不正确：${url}（应以 http:// 或 https:// 开头）`);
      continue;
    }
    sources.push({ label, url });
  }
  return { sources, errors };
}

export function openNodeEditor({ node, nodes, onSave, onDelete, canDelete = true, live = false }) {
  const editing = Boolean(node);
  const initial = node ?? {
    id: "",
    name: "",
    nameEn: "",
    year: new Date().getFullYear(),
    approx: false,
    era: "future",
    category: "computing",
    summary: "",
    description: "",
    prereqs: [],
    tags: [],
    sources: [],
    status: "established",
  };

  const selectedPrereqs = new Set(initial.prereqs ?? []);
  let dirty = false;
  let deleteArmed = false;

  const eraOptions = ERA_ORDER.map(
    (key) => `<option value="${key}" ${key === initial.era ? "selected" : ""}>${ERAS[key].label}</option>`,
  ).join("");
  const categoryOptions = CATEGORY_ORDER.map(
    (key) => `<option value="${key}" ${key === initial.category ? "selected" : ""}>${CATEGORIES[key].label}</option>`,
  ).join("");
  const statusOptions = Object.entries(STATUSES)
    .map(([key, value]) => `<option value="${key}" ${key === (initial.status ?? "established") ? "selected" : ""}>${value.label}</option>`)
    .join("");

  const body = `
    <form id="node-form" class="node-form" novalidate>
      <div class="form-message" id="form-message" hidden></div>
      <div class="form-grid">
        <label class="field field-span-2">
          <span class="field-label">名称 <em>*</em></span>
          <input name="name" maxlength="50" required autocomplete="off" data-autofocus value="${escapeHtml(initial.name)}" placeholder="例如：晶体管" />
        </label>
        <label class="field">
          <span class="field-label">英文名 <small>可选，用于生成 id</small></span>
          <input name="nameEn" maxlength="80" autocomplete="off" value="${escapeHtml(initial.nameEn ?? "")}" placeholder="Transistor" />
        </label>
        <label class="field">
          <span class="field-label">年份 <em>*</em> <small>公元前用负数</small></span>
          <input name="year" type="number" required min="${YEAR_MIN}" max="${YEAR_MAX}" step="1" value="${initial.year}" />
        </label>
        <label class="field">
          <span class="field-label">时代</span>
          <select name="era">${eraOptions}</select>
        </label>
        <label class="field">
          <span class="field-label">分类</span>
          <select name="category">${categoryOptions}</select>
        </label>
        <label class="field">
          <span class="field-label">状态</span>
          <select name="status">${statusOptions}</select>
        </label>
        <label class="checkbox field-check">
          <input type="checkbox" name="approx" ${initial.approx ? "checked" : ""} />
          <span>年代为约数（显示为“约”）</span>
        </label>
        <label class="field field-span-2">
          <span class="field-label">一句话简介 <em>*</em> <small id="summary-count">${(initial.summary ?? "").length}/180</small></span>
          <textarea name="summary" maxlength="180" rows="2" required placeholder="它解决了什么问题？为什么重要？">${escapeHtml(initial.summary ?? "")}</textarea>
        </label>
        <label class="field field-span-2">
          <span class="field-label">详细说明 <small>可选</small></span>
          <textarea name="description" rows="4" maxlength="4000" placeholder="背景、原理、影响，以及常见的误解。">${escapeHtml(initial.description ?? "")}</textarea>
        </label>
        <div class="field field-span-2">
          <span class="field-label">前置科技 <small>可多选；没有前置就留空，表示树根</small></span>
          <div class="prereq-picker">
            <div class="prereq-chips" id="prereq-chips"></div>
            <div class="prereq-tools">
              <input type="search" id="prereq-search" placeholder="搜索已有科技…" autocomplete="off" />
              <span class="prereq-count" id="prereq-count"></span>
            </div>
            <div class="prereq-list" id="prereq-list"></div>
          </div>
        </div>
        <label class="field field-span-2">
          <span class="field-label">标签 <small>用逗号分隔，便于搜索</small></span>
          <input name="tags" autocomplete="off" value="${escapeHtml((initial.tags ?? []).join("，"))}" placeholder="例如：能源，工业革命" />
        </label>
        <label class="field field-span-2">
          <span class="field-label">来源 <small>每行一个，格式：标题 | https://…</small></span>
          <textarea name="sources" rows="2" placeholder="Wikipedia: Transistor | https://en.wikipedia.org/wiki/Transistor">${escapeHtml(sourceLines(initial.sources))}</textarea>
        </label>
      </div>
      <p class="form-note">${live ? "保存后会立即写入服务器并广播给所有在线的人；管理员可以从版本历史回滚。" : "改动会先保存到浏览器草稿；确认后再导出 JSON 提交。年份、依赖方向和来源是审核重点。"}</p>
    </form>`;

  const footer = `
    ${editing && canDelete ? '<button class="btn btn-danger-ghost" type="button" data-delete>删除</button>' : "<span></span>"}
    <div class="modal-foot-spacer"></div>
    <button class="btn btn-ghost" type="button" data-cancel>取消</button>
    <button class="btn btn-primary" type="submit" form="node-form">${live ? (editing ? "发布修改" : "发布新科技") : editing ? "保存修改" : "加入科技树"}</button>`;

  const modal = openModal({
    title: editing ? "编辑科技" : "新增科技",
    subtitle: editing ? `id: ${escapeHtml(node.id)}` : live ? "保存后会立即发布到实时科技树" : "为这棵树补上一根枝条",
    body,
    footer,
    wide: true,
    onBeforeClose: () => {
      if (!dirty) return true;
      return window.confirm("还有未保存的修改，确定放弃吗？");
    },
  });

  const form = modal.element.querySelector("#node-form");
  const message = form.querySelector("#form-message");
  const summary = form.elements.summary;
  const summaryCount = form.querySelector("#summary-count");
  const search = form.querySelector("#prereq-search");
  const list = form.querySelector("#prereq-list");
  const chips = form.querySelector("#prereq-chips");
  const count = form.querySelector("#prereq-count");
  const deleteButton = modal.element.querySelector("[data-delete]");

  const candidates = [...nodes]
    .filter((candidate) => candidate.id !== initial.id)
    .sort((a, b) => a.year - b.year || a.name.localeCompare(b.name, "zh-CN"));

  function renderChips() {
    if (!selectedPrereqs.size) {
      chips.innerHTML = '<span class="picker-empty">无前置 · 这会成为一个根节点</span>';
    } else {
      chips.innerHTML = [...selectedPrereqs]
        .map((id) => {
          const found = nodes.find((candidate) => candidate.id === id);
          return `<button type="button" class="chip chip-removable" data-remove="${escapeHtml(id)}" title="移除">
            ${escapeHtml(found?.name ?? id)}<span aria-hidden="true">×</span>
          </button>`;
        })
        .join("");
    }
    count.textContent = `已选 ${selectedPrereqs.size} 项`;
  }

  function renderList() {
    const query = search.value.trim().toLowerCase();
    const filtered = candidates.filter((candidate) => {
      if (!query) return true;
      return (
        candidate.name.toLowerCase().includes(query) ||
        String(candidate.nameEn ?? "").toLowerCase().includes(query) ||
        String(candidate.year).includes(query)
      );
    });
    if (!filtered.length) {
      list.innerHTML = '<p class="picker-empty">没有匹配的科技</p>';
      return;
    }
    list.innerHTML = filtered
      .map((candidate) => {
        const era = ERAS[candidate.era] ?? { color: "#8fa3bf" };
        return `<label class="prereq-item ${selectedPrereqs.has(candidate.id) ? "is-checked" : ""}">
          <input type="checkbox" value="${escapeHtml(candidate.id)}" ${selectedPrereqs.has(candidate.id) ? "checked" : ""} />
          <span class="era-dot" style="--era:${era.color}"></span>
          <span class="prereq-name">${escapeHtml(candidate.name)}</span>
          <span class="prereq-year">${formatYear(candidate.year, candidate.approx)}</span>
        </label>`;
      })
      .join("");
  }

  renderChips();
  renderList();

  function markDirty() {
    dirty = true;
    deleteArmed = false;
    if (deleteButton) {
      deleteButton.textContent = "删除";
      deleteButton.classList.remove("is-armed");
    }
  }

  form.addEventListener("input", (event) => {
    if (event.target === search) return;
    if (event.target === summary) {
      summaryCount.textContent = `${summary.value.length}/180`;
    }
    markDirty();
  });

  form.addEventListener("change", (event) => {
    if (event.target.matches("#prereq-list input[type=checkbox]")) {
      const id = event.target.value;
      if (event.target.checked) selectedPrereqs.add(id);
      else selectedPrereqs.delete(id);
      renderChips();
      renderList();
    }
    markDirty();
  });

  chips.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove]");
    if (!button) return;
    selectedPrereqs.delete(button.dataset.remove);
    renderChips();
    renderList();
    markDirty();
  });

  search.addEventListener("input", renderList);

  function showMessage(errors = [], warnings = []) {
    if (!errors.length && !warnings.length) {
      message.hidden = true;
      message.innerHTML = "";
      return;
    }
    message.hidden = false;
    message.innerHTML = `
      ${errors.map((text) => `<p class="form-error-line">${escapeHtml(text)}</p>`).join("")}
      ${warnings.map((text) => `<p class="form-warning-line">${escapeHtml(text)}</p>`).join("")}
    `;
    message.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function validateForm() {
    const errors = [];
    const warnings = [];
    const name = form.elements.name.value.trim();
    const nameEn = form.elements.nameEn.value.trim();
    const yearValue = Number(form.elements.year.value);
    const summaryValue = form.elements.summary.value.trim();
    const tags = form.elements.tags.value
      .split(/[,，、]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
    const parsedSources = parseSources(form.elements.sources.value);
    errors.push(...parsedSources.errors);

    if (!name) errors.push("请填写名称。");
    if (!summaryValue) errors.push("请填写一句话简介，说明它解决了什么问题。");
    if (!Number.isInteger(yearValue)) {
      errors.push("年份必须是整数。");
    } else if (yearValue < YEAR_MIN || yearValue > YEAR_MAX) {
      errors.push(`年份需在 ${formatYear(YEAR_MIN)} 到 ${formatYear(YEAR_MAX)} 之间。`);
    }

    let id = initial.id;
    if (!id) {
      id = makeId(nameEn || name, Date.now());
      let candidate = id;
      let suffix = 2;
      while (nodes.some((existing) => existing.id === candidate)) {
        candidate = `${id}-${suffix}`;
        suffix += 1;
      }
      id = candidate;
    }

    const prereqs = [...selectedPrereqs].filter((prereq) => nodes.some((candidate) => candidate.id === prereq));
    const cycle = wouldCreateCycle(nodes, id, prereqs);
    if (cycle) {
      const names = cycle.map((cycleId) => nodes.find((candidate) => candidate.id === cycleId)?.name ?? cycleId);
      errors.push(`会形成循环依赖：${names.join(" → ")}`);
    }

    for (const prereqId of prereqs) {
      const prereq = nodes.find((candidate) => candidate.id === prereqId);
      if (prereq && Number.isInteger(yearValue) && prereq.year > yearValue) {
        warnings.push(
          `前置“${prereq.name}”（${formatYear(prereq.year, prereq.approx)}）晚于本科技（${formatYear(yearValue)}）。如果这是历史事实，请在说明里解释；否则请检查年代。`,
        );
      }
    }

    return {
      errors,
      warnings,
      node: {
        id,
        name,
        nameEn: nameEn || undefined,
        year: yearValue,
        approx: form.elements.approx.checked || undefined,
        era: form.elements.era.value,
        category: form.elements.category.value,
        summary: summaryValue,
        description: form.elements.description.value.trim() || undefined,
        prereqs,
        tags: tags.length ? tags : undefined,
        sources: parsedSources.sources.length ? parsedSources.sources : undefined,
        status: form.elements.status.value !== "established" ? form.elements.status.value : undefined,
      },
    };
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = validateForm();
    showMessage(result.errors, result.warnings);
    if (result.errors.length) return;

    const submitButton = modal.element.querySelector('button[type="submit"][form="node-form"]');
    const originalLabel = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = "保存中…";
    try {
      await onSave(result.node, { isNew: !editing });
      dirty = false;
      modal.forceClose();
    } catch (error) {
      showMessage([error?.message ?? "保存失败，请稍后再试。"], []);
      submitButton.disabled = false;
      submitButton.textContent = originalLabel;
    }
  });

  modal.element.querySelector("[data-cancel]").addEventListener("click", () => modal.close());

  if (deleteButton) {
    deleteButton.addEventListener("click", async () => {
      if (!deleteArmed) {
        const dependents = nodes.filter(
          (candidate) => candidate.id !== node.id && (candidate.prereqs ?? []).includes(node.id),
        );
        deleteArmed = true;
        deleteButton.textContent = "再次点击确认删除";
        deleteButton.classList.add("is-armed");
        const lines = [`删除“${node.name}”后无法撤销。`];
        if (dependents.length) {
          lines.push(`以下 ${dependents.length} 项科技以它为前置，删除后会自动移除这条依赖：`);
          lines.push(dependents.map((item) => item.name).join("、"));
        }
        showMessage(lines, []);
        return;
      }
      deleteButton.disabled = true;
      deleteButton.textContent = "删除中…";
      try {
        await onDelete(node);
        dirty = false;
        modal.forceClose();
      } catch (error) {
        showMessage([error?.message ?? "删除失败，请稍后再试。"], []);
        deleteButton.disabled = false;
        deleteButton.textContent = "再次点击确认删除";
      }
    });
  }

  window.setTimeout(() => {
    form.elements.name.focus();
    form.elements.name.select();
  }, 80);
}

export function openGuide({ onEdit, onExport, onLogin, onHistory, live = false, user = null }) {
  const repo = getRepoUrl();
  const issue = getIssueUrl();
  const repoLabel = repo.replace(/^https?:\/\/github\.com\//, "");

  const steps = live
    ? `<ol class="guide-steps">
        <li>
          <span class="guide-num">01</span>
          <div>
            <h4>${user ? `已登录 @${escapeHtml(user.username)}` : "登录 / 注册"}</h4>
            <p>账号用于署名、限流和版本历史。密码使用 scrypt 哈希保存在服务器，浏览器只拿到 7 天有效的 HttpOnly 会话。</p>
            ${user ? "" : '<button class="btn btn-small" type="button" data-guide-login>登录 / 注册</button>'}
          </div>
        </li>
        <li>
          <span class="guide-num">02</span>
          <div>
            <h4>直接改</h4>
            <p>进入编辑模式，保存后会立即写入服务器并广播给所有在线的人。每次写入都会先跑与 CI 相同的数据校验。</p>
            <button class="btn btn-small" type="button" data-guide-edit>进入编辑模式</button>
          </div>
        </li>
        <li>
          <span class="guide-num">03</span>
          <div>
            <h4>随时回滚</h4>
            <p>每次新增、修改、删除都会进入版本历史。管理员可以恢复到任意快照，恢复本身也会写一条新历史。</p>
            <button class="btn btn-small" type="button" data-guide-history>查看版本历史</button>
          </div>
        </li>
      </ol>`
    : `<ol class="guide-steps">
        <li>
          <span class="guide-num">01</span>
          <div>
            <h4>直接改</h4>
            <p>进入编辑模式，点击任意节点修改，或新增一项科技。系统会自动检查缺失字段、断开的依赖和循环引用。</p>
            <button class="btn btn-small" type="button" data-guide-edit>进入编辑模式</button>
          </div>
        </li>
        <li>
          <span class="guide-num">02</span>
          <div>
            <h4>导出</h4>
            <p>点击下方“导出 tech.json”，得到完整数据文件。草稿只存在你的浏览器里，换设备不会同步。</p>
            <button class="btn btn-small" type="button" data-guide-export>导出当前数据</button>
          </div>
        </li>
        <li>
          <span class="guide-num">03</span>
          <div>
            <h4>提交审核</h4>
            <p>把 <code>data/tech.json</code> 替换到仓库里，提一个 Pull Request；不会用 Git 的人可以把 JSON 贴进 Issue。CI 会自动运行同款校验。</p>
            ${
              repo
                ? `<div class="guide-links">
                    <a class="btn btn-small" href="${escapeHtml(repo)}" target="_blank" rel="noopener">打开 GitHub 仓库</a>
                    <a class="btn btn-small btn-ghost" href="${escapeHtml(issue)}" target="_blank" rel="noopener">用 Issue 提交</a>
                  </div>`
                : `<p class="guide-note">维护者尚未配置公开仓库地址。导出 JSON 后交给项目维护者，或在部署时把仓库地址填入 <code>src/config.js</code>。</p>`
            }
          </div>
        </li>
      </ol>`;

  const body = `
    <div class="guide">
      <div class="guide-hero">
        <span class="guide-kicker">${live ? "LIVE · SSE · REVISIONS" : "OPEN DATA · GIT WORKFLOW"}</span>
        <h3>${live ? "这棵树正在实时生长。" : "这棵树属于所有人，但每一次改动都可追溯。"}</h3>
        <p>${
          live
            ? `你连接的是一个实时协作服务器。${user ? `已作为 <strong>@${escapeHtml(user.username)}</strong> 登录。` : "登录后即可编辑。"}保存的修改会立即广播给所有在线的人，并写入版本历史；管理员可以回滚。`
            : "当前版本不需要注册账号：你在浏览器里编辑，改动保存在本地；导出 JSON 后，通过 Pull Request 或 Issue 提交给维护者审核合并。"
        }</p>
      </div>
      ${steps}
      <section class="guide-section">
        <h4>数据长什么样</h4>
        <pre class="code-block"><code>{
  "id": "transistor",
  "name": "晶体管",
  "year": 1947,
  "era": "atomic",
  "category": "information",
  "summary": "用半导体材料制造可放大和开关电信号的固态器件。",
  "prereqs": ["semiconductor-physics", "quantum-mechanics"]
}</code></pre>
        <p class="guide-note">完整字段见 <code>data/schema.json</code>；新节点至少需要名称、年份、时代、分类和一句话简介。</p>
      </section>
      <section class="guide-section">
        <h4>审核标准</h4>
        <ul class="guide-rules">
          <li><strong>可查证</strong>：有争议的年代或因果关系，请附来源链接。</li>
          <li><strong>讲依赖</strong>：前置应是“没有它，这项技术难以出现”的必要条件，而不是泛泛的相关项。</li>
          <li><strong>粒度一致</strong>：一项技术应是一类可辨认的方法或器物，不要把一个产品型号写成节点。</li>
          <li><strong>无环</strong>：依赖关系必须是有向无环图；年代倒挂会触发提示，需要解释。</li>
          <li><strong>去重</strong>：先搜索是否已有同义节点，再新增。</li>
        </ul>
      </section>
      <section class="guide-section">
        <h4>${live ? "这个实时服务器怎么工作？" : "为什么不用“点开就能改”的数据库？"}</h4>
        <p>${
          live
            ? "服务器用 JSON 快照 + SSE 推送 + HttpOnly 会话：写入前跑同一套 DAG 校验，每次修改保留最多 200 个版本，管理员可回滚。数据写在 <code>server/data/tech.json</code>，可用 <code>npm run promote</code> 同步回 Git。公开部署时建议设置 <code>REGISTRATION=closed</code>，由管理员邀请贡献者。"
            : "公开可写数据库需要账号、反滥用、审核队列、历史版本和回滚，否则几天内就会被广告和错误信息淹没。静态站 + Git 是零成本、可审计的起点；需要实时协作时，可以启动本项目的实时服务器。"
        }</p>
      </section>
    </div>`;

  const modal = openModal({
    title: "如何参与",
    subtitle: live
      ? user
        ? `实时服务器 · @${escapeHtml(user.username)}`
        : "实时服务器 · 登录后可编辑"
      : repo
        ? `当前仓库：${escapeHtml(repoLabel)}`
        : "一份开放、可审计的科技史数据集",
    body,
    wide: true,
    footer: `
      <span class="modal-foot-note">代码 MIT · 数据 CC BY-SA 4.0</span>
      <div class="modal-foot-spacer"></div>
      <button class="btn btn-ghost" type="button" data-guide-close>先看看</button>
      <button class="btn btn-primary" type="button" data-guide-export>导出 tech.json</button>`,
  });

  modal.element.querySelectorAll("[data-guide-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      modal.forceClose();
      onEdit();
    });
  });
  modal.element.querySelectorAll("[data-guide-export]").forEach((button) => {
    button.addEventListener("click", () => onExport());
  });
  modal.element.querySelectorAll("[data-guide-login]").forEach((button) => {
    button.addEventListener("click", () => {
      modal.forceClose();
      onLogin?.();
    });
  });
  modal.element.querySelectorAll("[data-guide-history]").forEach((button) => {
    button.addEventListener("click", () => {
      modal.forceClose();
      onHistory?.();
    });
  });
  modal.element.querySelector("[data-guide-close]")?.addEventListener("click", () => modal.close());
}

export function openDiff({ base, data, diff, validation, stale = false, onExport, onDiscard, onCopy }) {
  const section = (title, items, render) => {
    if (!items.length) return "";
    return `<section class="diff-section">
      <h4>${title} <span class="diff-count">${items.length}</span></h4>
      <ul class="diff-list">${items.map(render).join("")}</ul>
    </section>`;
  };

  const changedRows = diff.changed
    .map(
      (item) => `<li>
        <span class="diff-dot diff-dot-change"></span>
        <span class="diff-name">${escapeHtml(item.after.name)}</span>
        <span class="diff-meta">${item.fields.map((field) => FIELD_LABELS[field] ?? field).join("、")}</span>
      </li>`,
    )
    .join("");
  const addedRows = diff.added
    .map(
      (node) => `<li><span class="diff-dot diff-dot-add"></span><span class="diff-name">${escapeHtml(node.name)}</span><span class="diff-meta">${formatYear(node.year, node.approx)}</span></li>`,
    )
    .join("");
  const removedRows = diff.removed
    .map(
      (node) => `<li><span class="diff-dot diff-dot-remove"></span><span class="diff-name">${escapeHtml(node.name)}</span><span class="diff-meta">${formatYear(node.year, node.approx)}</span></li>`,
    )
    .join("");

  const errors = validation.errors
    .map((error) => `<li>${escapeHtml(error.message)}</li>`)
    .join("");
  const warnings = validation.warnings
    .map((warning) => `<li>${escapeHtml(warning.message)}</li>`)
    .join("");

  const body = `
    <div class="diff">
      ${stale ? `<div class="notice notice-warn">这份草稿基于旧版本的线上数据。提交前建议先备份导出，再刷新页面确认没有冲突。</div>` : ""}
      <div class="diff-summary">
        <span class="diff-pill diff-pill-add">新增 ${diff.added.length}</span>
        <span class="diff-pill diff-pill-change">修改 ${diff.changed.length}</span>
        <span class="diff-pill diff-pill-remove">删除 ${diff.removed.length}</span>
        <span class="diff-pill">${data.nodes.length} 项科技</span>
        <span class="diff-pill">${data.nodes.reduce((sum, node) => sum + (node.prereqs?.length ?? 0), 0)} 条依赖</span>
      </div>
      ${changedRows ? `<section class="diff-section"><h4>修改 <span class="diff-count">${diff.changed.length}</span></h4><ul class="diff-list">${changedRows}</ul></section>` : ""}
      ${addedRows ? `<section class="diff-section"><h4>新增 <span class="diff-count">${diff.added.length}</span></h4><ul class="diff-list">${addedRows}</ul></section>` : ""}
      ${removedRows ? `<section class="diff-section"><h4>删除 <span class="diff-count">${diff.removed.length}</span></h4><ul class="diff-list">${removedRows}</ul></section>` : ""}
      ${
        validation.errors.length
          ? `<section class="diff-section diff-problems"><h4>校验错误 <span class="diff-count">${validation.errors.length}</span></h4><ul>${errors}</ul></section>`
          : ""
      }
      ${
        validation.warnings.length
          ? `<section class="diff-section diff-warnings"><h4>提示 <span class="diff-count">${validation.warnings.length}</span></h4><ul>${warnings}</ul></section>`
          : ""
      }
      ${!diff.dirty ? '<p class="diff-empty">当前没有未提交的修改。</p>' : ""}
      <p class="diff-hint">提交前请确认：年代、前置方向、来源。导出后可在 GitHub 上替换 <code>data/tech.json</code> 并提 PR。</p>
    </div>`;

  const modal = openModal({
    title: "本地草稿",
    subtitle: `基线版本：${escapeHtml(base.updated ?? "未知")}`,
    body,
    wide: true,
    footer: `
      <a class="btn btn-ghost" href="${escapeHtml(getRepoUrl() || "#")}" target="_blank" rel="noopener" ${getRepoUrl() ? "" : "hidden"}>GitHub</a>
      <button class="btn btn-danger-ghost" type="button" data-discard ${diff.dirty ? "" : "disabled"}>放弃草稿</button>
      <div class="modal-foot-spacer"></div>
      <button class="btn btn-ghost" type="button" data-copy>复制 JSON</button>
      <button class="btn btn-primary" type="button" data-export>导出 tech.json</button>`,
  });

  modal.element.querySelector("[data-export]")?.addEventListener("click", () => onExport());
  modal.element.querySelector("[data-copy]")?.addEventListener("click", () => onCopy());
  const discardButton = modal.element.querySelector("[data-discard]");
  let discardArmed = false;
  discardButton?.addEventListener("click", () => {
    if (!discardArmed) {
      discardArmed = true;
      discardButton.textContent = "再次点击确认放弃";
      discardButton.classList.add("is-armed");
      return;
    }
    modal.forceClose();
    onDiscard();
  });
}
