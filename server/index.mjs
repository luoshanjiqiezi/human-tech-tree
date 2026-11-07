/**
 * 人类科技树 · 实时协作服务器
 *
 * 设计目标：
 * - 零第三方依赖：Node 18+ 即可运行；
 * - 同一个进程同时提供静态站点和 /api；
 * - JSON 文件持久化 + 原子写入 + 版本快照；
 * - SSE 推送最新数据，浏览器无需安装 WebSocket 库；
 * - 账号 / 会话 / 角色 / 速率限制 / 同源检查；
 * - 任何写入都先跑与 CI 相同的数据校验。
 */

import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { validateData } from "../src/validate.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DATA_DIR = join(ROOT, "server", "data");
const DATA_FILE = join(DATA_DIR, "tech.json");
const USERS_FILE = join(DATA_DIR, "users.json");
const REVISIONS_FILE = join(DATA_DIR, "revisions.json");
const STATE_FILE = join(DATA_DIR, "state.json");
const ADMIN_FILE = join(DATA_DIR, "FIRST_ADMIN.txt");

const PORT = Number(process.env.PORT) || 4174;
const HOST = process.env.HOST || "127.0.0.1";
const REGISTRATION_OPEN = String(process.env.REGISTRATION ?? "open").toLowerCase() !== "closed";
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const MAX_REVISIONS = 200;
const MAX_BODY = 2 * 1024 * 1024;
const COOKIE_NAME = "tt_session";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".md": "text/markdown; charset=utf-8",
};

class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const state = {
  data: null,
  users: [],
  revisions: [],
  sessions: new Map(),
  clients: new Set(),
  revision: 0,
  writeQueue: Promise.resolve(),
  loginAttempts: new Map(),
  registerAttempts: new Map(),
  nodeAttempts: new Map(),
};

/* -------------------------------------------------------------------------- */
/* 启动                                                                       */
/* -------------------------------------------------------------------------- */

await init();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
    } else {
      await serveStatic(request, response, url);
    }
  } catch (error) {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    if (error instanceof HttpError) {
      sendJson(response, error.status, { error: error.message, details: error.details });
      return;
    }
    console.error(error);
    sendJson(response, 500, { error: "服务器内部错误" });
  }
});

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("  人类科技树 · 实时协作模式");
  console.log(`  → http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${PORT}`);
  console.log(`  数据文件：${DATA_FILE}`);
  console.log(`  注册：${REGISTRATION_OPEN ? "开放" : "关闭（仅管理员可建号）"}`);
  if (state.bootstrapPassword) {
    console.log("");
    console.log("  ⚠ 首次启动已创建管理员账号：");
    console.log(`    用户名：${state.bootstrapUser}`);
    console.log(`    密码：${state.bootstrapPassword}`);
    console.log(`    同时写入：${ADMIN_FILE}`);
    console.log("    登录后请尽快修改密码（或删除 server/data 后重设 ADMIN_PASSWORD）。");
  }
  console.log("");
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
  console.log("\n正在关闭…");
  for (const client of state.clients) {
    try {
      client.res.end();
    } catch {
      /* ignore */
    }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

/* -------------------------------------------------------------------------- */
/* 初始化与持久化                                                             */
/* -------------------------------------------------------------------------- */

async function init() {
  await mkdir(DATA_DIR, { recursive: true });

  if (!existsSync(DATA_FILE)) {
    const seed = JSON.parse(await readFile(join(ROOT, "data", "tech.json"), "utf8"));
    const check = validateData(seed);
    if (!check.ok) throw new Error(`种子数据校验失败：${check.errors[0]?.message}`);
    await writeJsonAtomic(DATA_FILE, seed);
  }

  state.data = JSON.parse(await readFile(DATA_FILE, "utf8"));
  const check = validateData(state.data);
  if (!check.ok) {
    throw new Error(`server/data/tech.json 校验失败：${check.errors[0]?.message}`);
  }

  state.users = await loadJson(USERS_FILE, []);
  state.revisions = await loadJson(REVISIONS_FILE, []);
  const meta = await loadJson(STATE_FILE, { revision: 0 });
  state.revision = Number.isInteger(meta.revision)
    ? meta.revision
    : state.revisions.length;

  if (!state.users.length) await bootstrapAdmin();
}

async function bootstrapAdmin() {
  const username = String(process.env.ADMIN_USER || "admin").trim();
  const password = String(process.env.ADMIN_PASSWORD || randomPassword());
  const user = createUser(username, password, "admin");
  state.users = [user];
  await writeJsonAtomic(USERS_FILE, state.users);

  state.bootstrapUser = username;
  state.bootstrapPassword = process.env.ADMIN_PASSWORD ? null : password;
  if (!process.env.ADMIN_PASSWORD) {
    await writeFile(
      ADMIN_FILE,
      `人类科技树 首次启动管理员\n\n用户名：${username}\n密码：${password}\n\n登录后请修改密码，或删除 server/data 后使用 ADMIN_PASSWORD 环境变量重新初始化。\n`,
      "utf8",
    );
  }
}

async function loadJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomic(file, value) {
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, file);
}

function randomPassword() {
  return randomBytes(12).toString("base64url");
}

/* -------------------------------------------------------------------------- */
/* 用户与会话                                                                 */
/* -------------------------------------------------------------------------- */

function normalizeUsername(value) {
  return String(value ?? "").trim();
}

function validateUsername(username) {
  if (!/^[\p{L}\p{N}_-]{2,24}$/u.test(username)) {
    throw new HttpError(400, "用户名需为 2–24 个字符，只能包含文字、数字、下划线或连字符。");
  }
}

function createUser(username, password, role = "contributor") {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return {
    id: randomUUID(),
    username,
    salt,
    hash,
    role,
    createdAt: new Date().toISOString(),
  };
}

function verifyPassword(user, password) {
  const hash = scryptSync(password, user.salt, 64);
  const stored = Buffer.from(user.hash, "hex");
  return stored.length === hash.length && timingSafeEqual(stored, hash);
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt,
  };
}

function createSession(userId) {
  const token = randomBytes(32).toString("hex");
  state.sessions.set(token, { userId, createdAt: Date.now(), lastSeen: Date.now() });
  return token;
}

function getSessionToken(request) {
  const cookies = parseCookies(request);
  return cookies[COOKIE_NAME] || "";
}

function currentUser(request) {
  const token = getSessionToken(request);
  if (!token) return null;
  const session = state.sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL) {
    state.sessions.delete(token);
    return null;
  }
  session.lastSeen = Date.now();
  return state.users.find((user) => user.id === session.userId) ?? null;
}

function requireUser(request) {
  const user = currentUser(request);
  if (!user) throw new HttpError(401, "请先登录。");
  return user;
}

function requireAdmin(request) {
  const user = requireUser(request);
  if (user.role !== "admin") throw new HttpError(403, "只有管理员可以执行这个操作。");
  return user;
}

function parseCookies(request) {
  const header = request.headers.cookie ?? "";
  const result = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

function sessionCookie(request, token) {
  const secure =
    request.socket.encrypted ||
    String(request.headers["x-forwarded-proto"] ?? "").split(",")[0].trim() === "https";
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL / 1000)}${secure ? "; Secure" : ""}`;
}

function clearCookie() {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

function assertSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return;
  try {
    const originHost = new URL(origin).host;
    if (originHost !== request.headers.host) {
      throw new HttpError(403, "跨站请求被拒绝。");
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(403, "请求来源不合法。");
  }
}

function clientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (forwarded && process.env.TRUST_PROXY === "1") {
    return String(forwarded).split(",")[0].trim();
  }
  return request.socket.remoteAddress ?? "unknown";
}

function rateLimit(map, key, max, windowMs, message = "操作太频繁，请稍后再试。") {
  const now = Date.now();
  const recent = (map.get(key) ?? []).filter((time) => now - time < windowMs);
  if (recent.length >= max) throw new HttpError(429, message);
  recent.push(now);
  map.set(key, recent);
  if (map.size > 5000) {
    for (const [entryKey, times] of map) {
      if (!times.length || now - times[times.length - 1] > windowMs * 4) map.delete(entryKey);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 写入与版本                                                                 */
/* -------------------------------------------------------------------------- */

function mutate(mutator, meta) {
  const run = state.writeQueue.then(async () => {
    const candidate = mutator(structuredClone(state.data));
    candidate.updated = new Date().toISOString().slice(0, 10);

    const validation = validateData(candidate);
    if (!validation.ok) {
      throw new HttpError(400, validation.errors[0]?.message ?? "数据校验失败。", validation.errors);
    }

    const revision = {
      id: randomUUID(),
      revision: state.revision + 1,
      at: new Date().toISOString(),
      user: publicUser(meta.user),
      action: meta.action,
      targetId: meta.targetId ?? null,
      targetName: meta.targetName ?? null,
      note: meta.note ?? "",
      data: candidate,
    };

    const revisions = [...state.revisions, revision].slice(-MAX_REVISIONS);
    await writeJsonAtomic(DATA_FILE, candidate);
    await writeJsonAtomic(REVISIONS_FILE, revisions);
    await writeJsonAtomic(STATE_FILE, {
      revision: revision.revision,
      updatedAt: revision.at,
    });

    state.data = candidate;
    state.revision = revision.revision;
    state.revisions = revisions;

    const payload = {
      data: candidate,
      revision: publicRevision(revision),
      actor: publicUser(meta.user),
    };
    broadcast("data", payload);
    return payload;
  });

  state.writeQueue = run.catch(() => {});
  return run;
}

function publicRevision(revision) {
  if (!revision) return null;
  return {
    id: revision.id,
    revision: revision.revision,
    at: revision.at,
    user: revision.user,
    action: revision.action,
    targetId: revision.targetId,
    targetName: revision.targetName,
    note: revision.note,
  };
}

/* -------------------------------------------------------------------------- */
/* API 路由                                                                   */
/* -------------------------------------------------------------------------- */

async function handleApi(request, response, url) {
  const method = request.method ?? "GET";
  const path = url.pathname;

  if (method === "GET" && path === "/api/health") {
    sendJson(response, 200, {
      live: true,
      revision: state.revision,
      online: state.clients.size,
      registration: REGISTRATION_OPEN,
      nodes: state.data.nodes.length,
    });
    return;
  }

  if (method === "GET" && path === "/api/data") {
    response.setHeader("X-Revision", String(state.revision));
    sendJson(response, 200, state.data);
    return;
  }

  if (method === "GET" && path === "/api/me") {
    sendJson(response, 200, { user: publicUser(currentUser(request)) });
    return;
  }

  if (method === "GET" && path === "/api/revisions") {
    sendJson(response, 200, {
      revisions: state.revisions
        .slice(-60)
        .reverse()
        .map(publicRevision),
      current: state.revision,
    });
    return;
  }

  if (method === "GET" && path === "/api/events") {
    handleEvents(request, response);
    return;
  }

  if (method === "POST" && path === "/api/register") {
    await handleRegister(request, response);
    return;
  }

  if (method === "POST" && path === "/api/login") {
    await handleLogin(request, response);
    return;
  }

  if (method === "POST" && path === "/api/logout") {
    assertSameOrigin(request);
    const token = getSessionToken(request);
    if (token) state.sessions.delete(token);
    response.setHeader("Set-Cookie", clearCookie());
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "POST" && path === "/api/nodes") {
    await handleSaveNode(request, response);
    return;
  }

  const deleteMatch = path.match(/^\/api\/nodes\/([^/]+)$/);
  if (method === "DELETE" && deleteMatch) {
    await handleDeleteNode(request, response, decodeURIComponent(deleteMatch[1]));
    return;
  }

  const restoreMatch = path.match(/^\/api\/revisions\/([^/]+)\/restore$/);
  if (method === "POST" && restoreMatch) {
    await handleRestore(request, response, decodeURIComponent(restoreMatch[1]));
    return;
  }

  if (method === "POST" && path === "/api/import") {
    await handleImport(request, response);
    return;
  }

  if (method === "POST" && path === "/api/users") {
    await handleCreateUser(request, response);
    return;
  }

  if (method === "POST" && path === "/api/password") {
    await handleChangePassword(request, response);
    return;
  }

  throw new HttpError(404, "API 不存在。");
}

async function handleRegister(request, response) {
  assertSameOrigin(request);
  if (!REGISTRATION_OPEN) throw new HttpError(403, "当前服务器关闭了开放注册，请联系管理员。");
  rateLimit(state.registerAttempts, clientIp(request), 5, 60 * 60 * 1000, "注册太频繁，请一小时后再试。");

  const body = await readJson(request);
  const username = normalizeUsername(body.username);
  const password = String(body.password ?? "");
  validateUsername(username);
  if (password.length < 8 || password.length > 200) {
    throw new HttpError(400, "密码至少 8 位，最多 200 位。");
  }
  if (state.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
    throw new HttpError(409, "这个用户名已被使用。");
  }

  const user = createUser(username, password, "contributor");
  state.users.push(user);
  await writeJsonAtomic(USERS_FILE, state.users);

  const token = createSession(user.id);
  response.setHeader("Set-Cookie", sessionCookie(request, token));
  sendJson(response, 201, { user: publicUser(user) });
}

async function handleLogin(request, response) {
  assertSameOrigin(request);
  rateLimit(state.loginAttempts, clientIp(request), 15, 15 * 60 * 1000, "登录尝试太频繁，请稍后再试。");
  const body = await readJson(request);
  const username = normalizeUsername(body.username);
  const password = String(body.password ?? "");
  const user = state.users.find((candidate) => candidate.username.toLowerCase() === username.toLowerCase());
  if (!user || !verifyPassword(user, password)) {
    throw new HttpError(401, "用户名或密码不正确。");
  }
  const token = createSession(user.id);
  response.setHeader("Set-Cookie", sessionCookie(request, token));
  sendJson(response, 200, { user: publicUser(user) });
}

async function handleChangePassword(request, response) {
  assertSameOrigin(request);
  const user = requireUser(request);
  const body = await readJson(request);
  const current = String(body.currentPassword ?? "");
  const next = String(body.nextPassword ?? "");
  if (!verifyPassword(user, current)) throw new HttpError(403, "当前密码不正确。");
  if (next.length < 8 || next.length > 200) throw new HttpError(400, "新密码至少 8 位。");

  const salt = randomBytes(16).toString("hex");
  user.salt = salt;
  user.hash = scryptSync(next, salt, 64).toString("hex");
  await writeJsonAtomic(USERS_FILE, state.users);
  sendJson(response, 200, { ok: true });
}

async function handleCreateUser(request, response) {
  assertSameOrigin(request);
  requireAdmin(request);
  const body = await readJson(request);
  const username = normalizeUsername(body.username);
  const password = String(body.password ?? "");
  const role = body.role === "admin" ? "admin" : "contributor";
  validateUsername(username);
  if (password.length < 8 || password.length > 200) {
    throw new HttpError(400, "密码至少 8 位，最多 200 位。");
  }
  if (state.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
    throw new HttpError(409, "这个用户名已被使用。");
  }
  const user = createUser(username, password, role);
  state.users.push(user);
  await writeJsonAtomic(USERS_FILE, state.users);
  sendJson(response, 201, { user: publicUser(user) });
}

async function handleSaveNode(request, response) {
  assertSameOrigin(request);
  const user = requireUser(request);
  rateLimit(state.nodeAttempts, user.id, 80, 60 * 1000, "编辑太频繁，请稍后再试。");

  const body = await readJson(request);
  const node = body.node;
  if (!node || typeof node !== "object" || typeof node.id !== "string") {
    throw new HttpError(400, "缺少合法的 node。");
  }

  const exists = state.data.nodes.some((candidate) => candidate.id === node.id);
  const result = await mutate(
    (current) => {
      const index = current.nodes.findIndex((candidate) => candidate.id === node.id);
      if (index >= 0) current.nodes[index] = node;
      else current.nodes.push(node);
      return current;
    },
    {
      user,
      action: exists ? "update" : "create",
      targetId: node.id,
      targetName: node.name,
    },
  );

  sendJson(response, 200, { ...result, node });
}

async function handleDeleteNode(request, response, id) {
  assertSameOrigin(request);
  const user = requireAdmin(request);
  rateLimit(state.nodeAttempts, user.id, 30, 60 * 1000, "操作太频繁，请稍后再试。");

  const existing = state.data.nodes.find((node) => node.id === id);
  if (!existing) throw new HttpError(404, "找不到这项科技。");

  const result = await mutate(
    (current) => {
      current.nodes = current.nodes
        .filter((node) => node.id !== id)
        .map((node) => ({
          ...node,
          prereqs: (node.prereqs ?? []).filter((prereq) => prereq !== id),
        }));
      return current;
    },
    {
      user,
      action: "delete",
      targetId: id,
      targetName: existing.name,
    },
  );

  sendJson(response, 200, result);
}

async function handleImport(request, response) {
  assertSameOrigin(request);
  const user = requireAdmin(request);
  const body = await readJson(request);
  if (!body.data || !Array.isArray(body.data.nodes)) {
    throw new HttpError(400, "导入数据缺少 nodes 数组。");
  }
  const result = await mutate(() => structuredClone(body.data), {
    user,
    action: "import",
    targetId: null,
    targetName: "完整数据",
    note: String(body.note ?? "").slice(0, 300),
  });
  sendJson(response, 200, result);
}

async function handleRestore(request, response, revisionId) {
  assertSameOrigin(request);
  const user = requireAdmin(request);
  const revision = state.revisions.find((item) => item.id === revisionId);
  if (!revision) throw new HttpError(404, "找不到这个版本。");
  const result = await mutate(() => structuredClone(revision.data), {
    user,
    action: "restore",
    targetId: null,
    targetName: `版本 ${revision.revision}`,
    note: `恢复到 ${revision.at}`,
  });
  sendJson(response, 200, result);
}

/* -------------------------------------------------------------------------- */
/* SSE                                                                        */
/* -------------------------------------------------------------------------- */

function handleEvents(request, response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.write("retry: 2500\n\n");

  const client = { res: response, user: publicUser(currentUser(request)) };
  state.clients.add(client);

  sendEvent(client, "hello", {
    revision: state.revision,
    online: state.clients.size,
    user: client.user,
    registration: REGISTRATION_OPEN,
  });
  broadcastPresence();

  const heartbeat = setInterval(() => {
    try {
      response.write(": ping\n\n");
    } catch {
      cleanup();
    }
  }, 25000);

  function cleanup() {
    clearInterval(heartbeat);
    state.clients.delete(client);
    broadcastPresence();
  }

  request.on("close", cleanup);
  request.on("error", cleanup);
}

function sendEvent(client, event, payload) {
  try {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  } catch {
    state.clients.delete(client);
  }
}

function broadcast(event, payload) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of [...state.clients]) {
    try {
      client.res.write(frame);
    } catch {
      state.clients.delete(client);
    }
  }
}

function broadcastPresence() {
  broadcast("presence", { online: state.clients.size });
}

/* -------------------------------------------------------------------------- */
/* HTTP 工具                                                                  */
/* -------------------------------------------------------------------------- */

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, "请求体太大。");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "请求体不是合法 JSON。");
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

async function serveStatic(request, response, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  // 只暴露站点需要的目录；server/data、.git、.github 等不对外。
  const allowed =
    pathname === "/index.html" ||
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/src/") ||
    pathname.startsWith("/data/") ||
    pathname.startsWith("/docs/");
  if (!allowed) {
    response.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<h1>404</h1><p><a href=\"/\">返回科技树</a></p>");
    return;
  }

  const filePath = resolve(join(ROOT, normalize(pathname)));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  const info = await stat(filePath).catch(() => null);
  if (!info || !info.isFile()) {
    response.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<h1>404</h1><p><a href=\"/\">返回科技树</a></p>");
    return;
  }

  const body = await readFile(filePath);
  const contentType = MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";

  if (pathname === "/index.html") {
    const html = body
      .toString("utf8")
      .replace('name="tt-mode" content="static"', 'name="tt-mode" content="live"');
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : html);
    return;
  }

  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(request.method === "HEAD" ? undefined : body);
}
