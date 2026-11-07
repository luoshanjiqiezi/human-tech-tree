import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateData } from "../src/validate.js";

const dataUrl = new URL("../data/tech.json", import.meta.url);
const filePath = fileURLToPath(dataUrl);

const dim = (text) => `\x1b[2m${text}\x1b[0m`;
const red = (text) => `\x1b[31m${text}\x1b[0m`;
const yellow = (text) => `\x1b[33m${text}\x1b[0m`;
const green = (text) => `\x1b[32m${text}\x1b[0m`;

let data;
try {
  const raw = await readFile(dataUrl, "utf8");
  data = JSON.parse(raw);
} catch (error) {
  console.error(red(`✗ 无法读取或解析 data/tech.json：${error.message}`));
  process.exit(1);
}

const result = validateData(data);

for (const warning of result.warnings) {
  console.warn(yellow(`⚠ ${warning.message}`));
}

for (const error of result.errors) {
  console.error(red(`✗ ${error.message}`));
}

const { nodes, edges, roots } = result.stats;
const leaves = data.nodes.filter((node) => {
  if (!node || typeof node.id !== "string") return false;
  return !data.nodes.some((other) => Array.isArray(other?.prereqs) && other.prereqs.includes(node.id));
}).length;

if (result.ok) {
  console.log(
    green("✓ 数据校验通过") +
      dim(
        `  ·  ${nodes} 项科技  ·  ${edges} 条依赖  ·  ${roots} 个根节点  ·  ${leaves} 个末端节点  ·  ${result.warnings.length} 条提示`,
      ),
  );
  console.log(dim(`  ${filePath}`));
} else {
  console.error(red(`\n✗ 校验失败：${result.errors.length} 个错误，${result.warnings.length} 条提示。`));
  process.exit(1);
}
