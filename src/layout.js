/**
 * 依赖层级布局。
 *
 * x 轴 = 依赖深度（从根节点到该节点的最长路径），保证所有箭头都向右。
 * y 轴 = 同层内按父子重心排序后均匀铺开，减少交叉。
 * 这样得到的是一张真正的“科技树”，而不是按年份强行排列的时间轴。
 */

export const NODE_W = 200;
export const NODE_H = 68;
const X_GAP = 272;
const Y_GAP = 94;
const PAD = 120;
const BARYCENTER_PASSES = 4;

function byYearThenName(a, b) {
  return a.year - b.year || a.name.localeCompare(b.name, "zh-CN");
}

export function computeLayout(nodes) {
  const map = new Map();
  for (const node of nodes) map.set(node.id, node);

  const parents = new Map();
  const children = new Map();
  for (const node of nodes) {
    parents.set(node.id, []);
    children.set(node.id, []);
  }
  for (const node of nodes) {
    for (const prereq of node.prereqs ?? []) {
      if (!map.has(prereq)) continue;
      parents.get(node.id).push(prereq);
      children.get(prereq).push(node.id);
    }
  }

  // 最长路径深度；带 visiting 保护，即使数据暂时有环也不会栈溢出。
  const depth = new Map();
  const visiting = new Set();
  function depthOf(id) {
    if (depth.has(id)) return depth.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let value = 0;
    for (const parent of parents.get(id) ?? []) {
      value = Math.max(value, depthOf(parent) + 1);
    }
    visiting.delete(id);
    depth.set(id, value);
    return value;
  }
  for (const node of nodes) depthOf(node.id);

  const maxDepth = Math.max(0, ...depth.values());
  const levels = Array.from({ length: maxDepth + 1 }, () => []);
  for (const node of nodes) levels[depth.get(node.id)].push(node);
  for (const level of levels) level.sort(byYearThenName);

  const indexInLevel = new Map();
  function reindexAll() {
    levels.forEach((level) => {
      level.forEach((node, index) => indexInLevel.set(node.id, index));
    });
  }
  reindexAll();

  const positionIndex = (id) => indexInLevel.get(id) ?? 0;
  const barycenter = (node, neighbours) => {
    const values = neighbours
      .map((id) => indexInLevel.get(id))
      .filter((value) => Number.isFinite(value));
    if (!values.length) return positionIndex(node.id);
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };

  for (let pass = 0; pass < BARYCENTER_PASSES; pass += 1) {
    // 向前：按父节点重心排布，减少与上一层的交叉。
    for (let i = 1; i < levels.length; i += 1) {
      const level = levels[i];
      level.sort((a, b) => {
        return (
          barycenter(a, parents.get(a.id)) - barycenter(b, parents.get(b.id)) ||
          byYearThenName(a, b)
        );
      });
      level.forEach((node, index) => indexInLevel.set(node.id, index));
    }
    // 向后：按子节点重心排布，减少与下一层的交叉。
    for (let i = levels.length - 2; i >= 0; i -= 1) {
      const level = levels[i];
      level.sort((a, b) => {
        return (
          barycenter(a, children.get(a.id)) - barycenter(b, children.get(b.id)) ||
          byYearThenName(a, b)
        );
      });
      level.forEach((node, index) => indexInLevel.set(node.id, index));
    }
  }

  const maxCount = Math.max(1, ...levels.map((level) => level.length));
  const contentHeight = NODE_H + (maxCount - 1) * Y_GAP;
  const positions = new Map();
  const edges = [];

  levels.forEach((level, levelIndex) => {
    const count = level.length;
    const startY = PAD + NODE_H / 2 + (contentHeight - NODE_H - (count - 1) * Y_GAP) / 2;
    level.forEach((node, index) => {
      positions.set(node.id, {
        x: PAD + NODE_W / 2 + levelIndex * X_GAP,
        y: startY + index * Y_GAP,
        depth: levelIndex,
      });
    });
  });

  for (const node of nodes) {
    for (const prereq of node.prereqs ?? []) {
      if (!map.has(prereq)) continue;
      edges.push({ from: prereq, to: node.id });
    }
  }

  return {
    positions,
    edges,
    levels: levels.map((level) => level.map((node) => node.id)),
    width: PAD * 2 + NODE_W + maxDepth * X_GAP,
    height: PAD * 2 + contentHeight,
    maxDepth,
    maxCount,
  };
}

/** 从一组节点求包围盒，供“聚焦某个时代/搜索结果”使用。 */
export function boundsOf(positions, ids) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const point = positions.get(id);
    if (!point) continue;
    minX = Math.min(minX, point.x - NODE_W / 2);
    minY = Math.min(minY, point.y - NODE_H / 2);
    maxX = Math.max(maxX, point.x + NODE_W / 2);
    maxY = Math.max(maxY, point.y + NODE_H / 2);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
