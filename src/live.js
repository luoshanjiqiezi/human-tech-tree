/**
 * 实时协作客户端。
 *
 * 站点由实时服务器提供时，/api/health 会返回 live:true。
 * 此时数据来自 /api/data，更新通过 SSE 推送；否则继续走静态 JSON + 本地草稿。
 */

export async function detectLive(timeoutMs = 900) {
  // 实时服务器会把 index.html 里的 tt-mode 改成 live；静态托管保持 static。
  // 这样静态站不会为一个不存在的 /api/health 打出 404。
  const mode = document.querySelector('meta[name="tt-mode"]')?.getAttribute("content");
  if (mode !== "live") return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("/api/health", {
      cache: "no-store",
      signal: controller.signal,
      credentials: "same-origin",
    });
    if (!response.ok) return null;
    const info = await response.json();
    return info?.live ? info : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export class LiveClient {
  constructor({ onData, onPresence, onUser, onConnection } = {}) {
    this.onData = onData ?? (() => {});
    this.onPresence = onPresence ?? (() => {});
    this.onUser = onUser ?? (() => {});
    this.onConnection = onConnection ?? (() => {});
    this.data = null;
    this.user = null;
    this.source = null;
  }

  async start() {
    const [dataResponse, meResponse] = await Promise.all([
      fetch("/api/data", { cache: "no-store", credentials: "same-origin" }),
      fetch("/api/me", { cache: "no-store", credentials: "same-origin" }),
    ]);
    if (!dataResponse.ok) {
      throw new Error(`读取实时数据失败（HTTP ${dataResponse.status}）`);
    }
    this.data = await dataResponse.json();
    if (meResponse.ok) {
      const me = await meResponse.json();
      this.user = me.user ?? null;
    }
    this.openEvents();
    return this.data;
  }

  openEvents() {
    if (this.source) this.source.close();
    this.source = new EventSource("/api/events");

    this.source.addEventListener("open", () => {
      this.onConnection(true);
    });

    this.source.addEventListener("error", () => {
      this.onConnection(false);
      // EventSource 会自动重连；这里只更新 UI 状态。
    });

    this.source.addEventListener("hello", (event) => {
      const payload = safeParse(event.data);
      if (!payload) return;
      this.onConnection(true);
      this.onPresence(Number(payload.online) || 0);
      if (payload.user !== undefined) {
        this.user = payload.user;
        this.onUser(this.user);
      }
    });

    this.source.addEventListener("presence", (event) => {
      const payload = safeParse(event.data);
      if (payload) this.onPresence(Number(payload.online) || 0);
    });

    this.source.addEventListener("data", (event) => {
      const payload = safeParse(event.data);
      if (!payload?.data) return;
      this.data = payload.data;
      this.onData(payload);
    });
  }

  close() {
    this.source?.close();
    this.source = null;
  }

  setUser(user) {
    this.user = user;
    this.onUser(user);
  }

  async request(path, { method = "GET", body } = {}) {
    const response = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let payload = {};
    try {
      payload = await response.json();
    } catch {
      /* 空响应 */
    }

    if (!response.ok) {
      if (response.status === 401) this.setUser(null);
      const error = new Error(payload.error || `请求失败（HTTP ${response.status}）`);
      error.status = response.status;
      error.details = payload.details;
      throw error;
    }
    return payload;
  }

  async login(username, password) {
    const payload = await this.request("/login", { method: "POST", body: { username, password } });
    this.setUser(payload.user);
    return payload.user;
  }

  async register(username, password) {
    const payload = await this.request("/register", { method: "POST", body: { username, password } });
    this.setUser(payload.user);
    return payload.user;
  }

  async logout() {
    await this.request("/logout", { method: "POST" });
    this.setUser(null);
  }

  async saveNode(node) {
    const payload = await this.request("/nodes", { method: "POST", body: { node } });
    if (payload.data) this.data = payload.data;
    return payload;
  }

  async deleteNode(id) {
    const payload = await this.request(`/nodes/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (payload.data) this.data = payload.data;
    return payload;
  }

  async listRevisions() {
    return this.request("/revisions");
  }

  async restoreRevision(id) {
    const payload = await this.request(`/revisions/${encodeURIComponent(id)}/restore`, {
      method: "POST",
    });
    if (payload.data) this.data = payload.data;
    return payload;
  }

  async changePassword(currentPassword, nextPassword) {
    return this.request("/password", {
      method: "POST",
      body: { currentPassword, nextPassword },
    });
  }
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
