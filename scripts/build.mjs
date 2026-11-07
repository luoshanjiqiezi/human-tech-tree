import { cp, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const entry of ["index.html", "assets", "src", "data"]) {
  await cp(join(root, entry), join(dist, entry), { recursive: true });
}

async function measure(dir) {
  let total = 0;
  const { readdir } = await import("node:fs/promises");
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    if (item.isDirectory()) total += await measure(full);
    else total += (await stat(full)).size;
  }
  return total;
}

const bytes = await measure(dist);
console.log(`✓ 构建完成：dist/  (${(bytes / 1024).toFixed(1)} KB)`);
