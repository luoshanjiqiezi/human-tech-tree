import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateData } from "../src/validate.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const livePath = `${root}server/data/tech.json`;
const canonicalPath = `${root}data/tech.json`;

const live = JSON.parse(await readFile(livePath, "utf8"));
const check = validateData(live);
if (!check.ok) {
  console.error(`✗ 实时数据校验失败：${check.errors[0]?.message}`);
  process.exit(1);
}

const canonical = JSON.parse(await readFile(canonicalPath, "utf8"));
const before = new Map(canonical.nodes.map((node) => [node.id, JSON.stringify(node)]));
const after = new Map(live.nodes.map((node) => [node.id, JSON.stringify(node)]));
let added = 0;
let changed = 0;
let removed = 0;
for (const [id, value] of after) {
  if (!before.has(id)) added += 1;
  else if (before.get(id) !== value) changed += 1;
}
for (const id of before.keys()) if (!after.has(id)) removed += 1;

await writeFile(canonicalPath, `${JSON.stringify(live, null, 2)}\n`, "utf8");
console.log(
  `✓ 已把实时数据同步到 data/tech.json：新增 ${added}、修改 ${changed}、删除 ${removed}；共 ${live.nodes.length} 项。`,
);
