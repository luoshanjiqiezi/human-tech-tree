/** 比较两份数据，用于草稿提示、提交说明和导出前检查。 */

function equal(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => equal(value, b[index]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]));
  }
  return false;
}

function changedFields(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => !equal(before[key], after[key]));
}

export function diffData(base, current) {
  const baseNodes = new Map((base?.nodes ?? []).map((node) => [node.id, node]));
  const currentNodes = new Map((current?.nodes ?? []).map((node) => [node.id, node]));

  const added = [];
  const removed = [];
  const changed = [];

  for (const [id, node] of currentNodes) {
    if (!baseNodes.has(id)) added.push(node);
  }
  for (const [id, node] of baseNodes) {
    if (!currentNodes.has(id)) removed.push(node);
  }
  for (const [id, node] of currentNodes) {
    const before = baseNodes.get(id);
    if (!before) continue;
    const fields = changedFields(before, node);
    if (fields.length) changed.push({ id, before, after: node, fields });
  }

  return {
    added,
    removed,
    changed,
    count: added.length + removed.length + changed.length,
    dirty: added.length + removed.length + changed.length > 0,
  };
}
