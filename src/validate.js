/**
 * 数据校验：浏览器编辑器和 CI 共用同一套规则。
 * 不依赖 DOM，可直接被 Node 脚本 import。
 */

import {
  CATEGORIES,
  ERAS,
  STATUSES,
  YEAR_MAX,
  YEAR_MIN,
  formatYear,
} from "./constants.js";

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_TEXT = 4000;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function findCycle(nodes) {
  const map = new Map();
  for (const node of nodes) {
    if (node && typeof node.id === "string") map.set(node.id, node);
  }
  const state = new Map();
  const stack = [];

  function visit(id) {
    const status = state.get(id) ?? 0;
    if (status === 1) {
      const start = stack.indexOf(id);
      return [...stack.slice(start), id];
    }
    if (status === 2) return null;
    state.set(id, 1);
    stack.push(id);
    const node = map.get(id);
    const prereqs = Array.isArray(node?.prereqs) ? node.prereqs : [];
    for (const prereq of prereqs) {
      if (!map.has(prereq)) continue;
      const cycle = visit(prereq);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, 2);
    return null;
  }

  for (const node of nodes) {
    if (!node || typeof node.id !== "string" || state.has(node.id)) continue;
    const cycle = visit(node.id);
    if (cycle) return cycle;
  }
  return null;
}

/** 检查“给某个节点设置这些前置”会不会形成环。 */
export function wouldCreateCycle(nodes, id, prereqs) {
  const next = nodes
    .filter((node) => node.id !== id)
    .concat([{ id, prereqs: [...prereqs] }]);
  return findCycle(next);
}

export function getDependents(nodes) {
  const dependents = new Map(nodes.map((node) => [node.id, []]));
  for (const node of nodes) {
    for (const prereq of node.prereqs ?? []) {
      if (dependents.has(prereq)) dependents.get(prereq).push(node.id);
    }
  }
  return dependents;
}

export function validateData(data) {
  const errors = [];
  const warnings = [];
  const err = (message, nodeId = null) => errors.push({ message, nodeId });
  const warn = (message, nodeId = null) => warnings.push({ message, nodeId });

  if (!isPlainObject(data)) {
    return {
      ok: false,
      errors: [{ message: "数据必须是一个 JSON 对象。", nodeId: null }],
      warnings,
      stats: { nodes: 0, edges: 0, roots: 0 },
    };
  }

  if (!Array.isArray(data.nodes)) {
    err("缺少 nodes 数组。");
    return { ok: false, errors, warnings, stats: { nodes: 0, edges: 0, roots: 0 } };
  }

  if (data.title && typeof data.title !== "string") {
    err("title 必须是字符串。");
  }
  if (data.updated && !/^\d{4}-\d{2}-\d{2}$/.test(String(data.updated))) {
    warn("updated 建议使用 YYYY-MM-DD 格式。");
  }

  const byId = new Map();
  const nameCount = new Map();
  let edgeCount = 0;
  let rootCount = 0;

  for (const [index, node] of data.nodes.entries()) {
    const where = `第 ${index + 1} 个节点`;
    if (!isPlainObject(node)) {
      err(`${where}不是对象。`);
      continue;
    }

    const id = node.id;
    if (typeof id !== "string" || !ID_RE.test(id)) {
      err(`${where}的 id 不合法：只能使用小写字母、数字和连字符（2–64 位）。`, id ?? null);
    } else if (byId.has(id)) {
      err(`id 重复：${id}`, id);
    } else {
      byId.set(id, node);
    }

    const label = typeof id === "string" ? id : where;

    if (typeof node.name !== "string" || !node.name.trim()) {
      err(`${label} 缺少名称。`, node.id ?? null);
    } else if (node.name.length > 50) {
      warn(`${label} 的名称偏长（${node.name.length} 字），建议不超过 50 字。`, node.id ?? null);
    } else {
      const count = (nameCount.get(node.name.trim()) ?? 0) + 1;
      nameCount.set(node.name.trim(), count);
    }

    if (node.nameEn != null && typeof node.nameEn !== "string") {
      err(`${label} 的 nameEn 必须是字符串。`, node.id ?? null);
    }

    if (!Number.isInteger(node.year)) {
      err(`${label} 的 year 必须是整数（公元前用负数）。`, node.id ?? null);
    } else if (node.year < YEAR_MIN || node.year > YEAR_MAX) {
      err(
        `${label} 的年份 ${node.year} 超出允许范围（${formatYear(YEAR_MIN)} – ${formatYear(YEAR_MAX)}）。`,
        node.id ?? null,
      );
    }

    if (!Object.hasOwn(ERAS, node.era)) {
      err(`${label} 的 era 不在登记的时代列表中：${node.era}`, node.id ?? null);
    }
    if (!Object.hasOwn(CATEGORIES, node.category)) {
      err(`${label} 的 category 不在登记的分类列表中：${node.category}`, node.id ?? null);
    }
    if (node.status != null && !Object.hasOwn(STATUSES, node.status)) {
      err(`${label} 的 status 不合法：${node.status}`, node.id ?? null);
    }

    if (typeof node.summary !== "string" || !node.summary.trim()) {
      err(`${label} 缺少一句话简介 summary。`, node.id ?? null);
    } else if (node.summary.length > 180) {
      warn(`${label} 的 summary 偏长（${node.summary.length} 字），建议不超过 180 字。`, node.id ?? null);
    }

    if (node.description != null) {
      if (typeof node.description !== "string") {
        err(`${label} 的 description 必须是字符串。`, node.id ?? null);
      } else if (node.description.length > MAX_TEXT) {
        warn(`${label} 的 description 超过 ${MAX_TEXT} 字，建议拆分为来源或缩短。`, node.id ?? null);
      }
    }

    if (!Array.isArray(node.prereqs)) {
      err(`${label} 的 prereqs 必须是数组（没有前置就写 []）。`, node.id ?? null);
    } else {
      const seen = new Set();
      for (const prereq of node.prereqs) {
        if (typeof prereq !== "string") {
          err(`${label} 的前置项必须是 id 字符串。`, node.id ?? null);
          continue;
        }
        if (seen.has(prereq)) {
          err(`${label} 的前置重复：${prereq}`, node.id ?? null);
        }
        seen.add(prereq);
        if (prereq === node.id) {
          err(`${label} 不能依赖自身。`, node.id ?? null);
        }
        edgeCount += 1;
      }
      if (node.prereqs.length === 0) rootCount += 1;
    }

    if (node.tags != null) {
      if (!Array.isArray(node.tags) || node.tags.some((tag) => typeof tag !== "string")) {
        err(`${label} 的 tags 必须是字符串数组。`, node.id ?? null);
      }
    }

    if (node.sources != null) {
      if (!Array.isArray(node.sources)) {
        err(`${label} 的 sources 必须是数组。`, node.id ?? null);
      } else {
        for (const source of node.sources) {
          if (!isPlainObject(source) || typeof source.url !== "string") {
            err(`${label} 的来源格式应为 { label, url }。`, node.id ?? null);
            continue;
          }
          if (!/^https?:\/\//i.test(source.url)) {
            err(`${label} 的来源 URL 必须以 http(s):// 开头：${source.url}`, node.id ?? null);
          }
        }
      }
    }
  }

  // 前置引用必须存在。
  for (const node of data.nodes) {
    if (!isPlainObject(node) || !Array.isArray(node.prereqs)) continue;
    for (const prereq of node.prereqs) {
      if (typeof prereq !== "string") continue;
      if (!byId.has(prereq)) {
        err(`${node.id} 引用了不存在的前置科技：${prereq}`, node.id);
      }
    }
  }

  // 环检测。
  const cycle = findCycle(data.nodes);
  if (cycle) {
    const names = cycle
      .map((id) => byId.get(id)?.name ?? id)
      .join(" → ");
    err(`检测到循环依赖：${names}`);
  }

  // 时间方向：不强制，但给出提示，避免“后代早于祖先”的笔误。
  for (const node of data.nodes) {
    if (!isPlainObject(node) || !Array.isArray(node.prereqs)) continue;
    for (const prereqId of node.prereqs) {
      const prereq = byId.get(prereqId);
      if (!prereq || !Number.isInteger(prereq.year) || !Number.isInteger(node.year)) continue;
      if (prereq.year > node.year) {
        warn(
          `${node.name}（${formatYear(node.year)}）的前置“${prereq.name}”更晚（${formatYear(prereq.year)}），请确认年代或依赖方向。`,
          node.id,
        );
      }
    }
  }

  for (const [name, count] of nameCount) {
    if (count > 1) warn(`名称重复：${name}（${count} 次），建议合并或区分。`);
  }

  if (data.nodes.length > 0 && rootCount === 0) {
    warn("没有根节点（无前置的科技），可能形成了闭环或所有节点都依赖其他节点。");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      nodes: data.nodes.length,
      edges: edgeCount,
      roots: rootCount,
    },
  };
}
