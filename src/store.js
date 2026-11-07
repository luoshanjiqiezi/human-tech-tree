/**
 * 本地草稿存储。没有后端时，所有编辑先落在 localStorage，
 * 导出 JSON 后再通过 Git / Issue 提交。
 */

import { CONFIG } from "./config.js";

const DRAFT_VERSION = 1;

export async function fetchTechData(path = CONFIG.dataPath) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`读取数据失败（HTTP ${response.status}）`);
  }
  const data = await response.json();
  if (!data || !Array.isArray(data.nodes)) {
    throw new Error("数据格式不正确：缺少 nodes 数组");
  }
  return data;
}

export function readDraft() {
  try {
    const raw = localStorage.getItem(CONFIG.storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== DRAFT_VERSION || !parsed.data) return null;
    if (!Array.isArray(parsed.data.nodes)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeDraft(data, base) {
  try {
    const payload = {
      version: DRAFT_VERSION,
      savedAt: new Date().toISOString(),
      baseUpdated: base?.updated ?? null,
      data,
    };
    localStorage.setItem(CONFIG.storageKey, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(CONFIG.storageKey);
  } catch {
    /* 忽略隐私模式下的写入失败 */
  }
}

export function draftIsEmpty(base, data) {
  return JSON.stringify(base?.nodes ?? []) === JSON.stringify(data?.nodes ?? []);
}
