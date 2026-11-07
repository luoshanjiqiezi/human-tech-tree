# 实时协作服务器

`server/` 是一个**零第三方依赖**的 Node 服务器：同一个进程提供静态站点、账号、编辑 API、SSE 实时推送和版本历史。它解决的是“打开网页、登录、修改后所有人立刻看到”的需求，同时保留可回滚的历史。

> 这是单机参考实现，适合几十到几百人的社区、内部部署或一台小 VPS。需要多实例/托管数据库时，看 [roadmap](../docs/roadmap.md) 里的 Postgres/Supabase 方案。

---

## 快速开始

```bash
npm run live
# → http://127.0.0.1:4174
```

首次启动会：

1. 把 `data/tech.json` 复制为 `server/data/tech.json`；
2. 创建管理员账号；
3. 把用户名和随机密码打印到控制台，并写入 `server/data/FIRST_ADMIN.txt`。

默认注册开放。登录后即可编辑；保存会立即写入服务器，并通过 SSE 广播给所有在线页面。

### 让局域网其他人访问

```bash
HOST=0.0.0.0 PORT=4174 npm run live
```

Windows PowerShell：

```powershell
$env:HOST="0.0.0.0"; npm run live
```

然后访问 `http://<你的局域网 IP>:4174`。公网部署请放在 HTTPS 反向代理之后。

---

## 账号与角色

| 角色 | 能做什么 |
| --- | --- |
| 贡献者 `contributor` | 登录、新增/修改科技、查看历史 |
| 管理员 `admin` | 贡献者的全部权限，外加删除节点、恢复任意版本、导入数据、创建账号 |

- 注册默认开放，有 IP 速率限制（5 次/小时）。
- 公开部署建议关闭开放注册：

```bash
REGISTRATION=closed ADMIN_PASSWORD='换成强密码' npm run live
```

关闭后，用管理员账号创建贡献者：

```bash
curl -X POST http://127.0.0.1:4174/api/users \
  -H 'Content-Type: application/json' \
  -H 'Cookie: tt_session=<管理员会话>' \
  -d '{"username":"alice","password":"至少八位","role":"contributor"}'
```

也可以先在开放注册时建号，再改成 `closed`。

- 密码用 Node `scrypt` + 随机盐哈希保存。
- 会话是 7 天有效的 HttpOnly、SameSite=Lax Cookie；**会话存在内存里，重启服务器会让所有人重新登录**。
- 登录/注册/编辑都有基础速率限制。
- 修改密码：账户弹窗 → “修改密码”。

---

## 数据与版本

| 文件 | 内容 |
| --- | --- |
| `server/data/tech.json` | 当前实时数据（唯一写入目标） |
| `server/data/revisions.json` | 最近 200 个完整快照 |
| `server/data/users.json` | 用户名、scrypt 哈希、角色 |
| `server/data/state.json` | 当前版本号 |
| `server/data/FIRST_ADMIN.txt` | 首次生成的管理员密码（仅生成时写入） |

每次写入都会：

1. 在最新数据上应用修改；
2. 跑与 CI 相同的 `validateData()`（字段、引用、DAG 无环、年代提示）；
3. 写 `tech.json`、`revisions.json`、`state.json`；
4. 通过 SSE 广播新数据。

`server/data/` 已被 `.gitignore` 忽略，不会把账号密码提交到 Git。

### 把实时数据同步回 Git

在本地实时服务器上编辑后，用：

```bash
npm run promote
```

它会把 `server/data/tech.json` 校验后写回 `data/tech.json`，方便你 commit / PR / 部署静态站。

> 生产环境请定期备份 `server/data/`。这是唯一的数据源；删除它会从 `data/tech.json` 重新初始化。

---

## API

所有写操作要求已登录；`DELETE`、恢复、导入、创建账号要求管理员。写请求会检查 `Origin` 与 `Host` 同源。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 运行状态、版本号、在线人数 |
| GET | `/api/data` | 当前完整数据 |
| GET | `/api/me` | 当前登录用户 |
| GET | `/api/events` | SSE：`hello` / `data` / `presence` |
| GET | `/api/revisions` | 最近 60 条版本元数据 |
| POST | `/api/register` | 注册（可关闭） |
| POST | `/api/login` | 登录 |
| POST | `/api/logout` | 退出 |
| POST | `/api/nodes` | 新增或更新 `{ node }` |
| DELETE | `/api/nodes/:id` | 删除节点（管理员） |
| POST | `/api/revisions/:id/restore` | 恢复版本（管理员） |
| POST | `/api/import` | 导入完整数据（管理员） |
| POST | `/api/users` | 创建账号（管理员） |
| POST | `/api/password` | 修改自己的密码 |

### SSE 事件

```text
event: data
data: {"data":{...},"revision":{...},"actor":{...}}
```

客户端收到 `data` 后用完整快照替换本地数据并重绘。当前实现是“全量快照广播”，在 160 项规模下约 40–80 KB/次；几千项时应改成增量补丁。

---

## 部署

### Docker

```bash
docker build -t human-tech-tree .
docker run -d \
  -p 4174:4174 \
  -e HOST=0.0.0.0 \
  -e REGISTRATION=closed \
  -e ADMIN_PASSWORD='换成强密码' \
  -v human-tech-tree-data:/app/server/data \
  --name human-tech-tree \
  human-tech-tree
```

### Render / Fly.io / Railway / 小 VPS

- 启动命令：`node server/index.mjs`
- 环境变量：`HOST=0.0.0.0`、`PORT`（平台通常注入）、`ADMIN_PASSWORD`、`REGISTRATION=closed`
- 挂载持久磁盘到 `/app/server/data`
- 用平台 HTTPS 域名访问；反向代理需传 `X-Forwarded-Proto: https`，Cookie 才会带 `Secure`

### 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 设为 `0.0.0.0` 才能被外部访问 |
| `PORT` | `4174` | 监听端口 |
| `ADMIN_USER` | `admin` | 首次初始化管理员用户名 |
| `ADMIN_PASSWORD` | 随机 | 首次初始化管理员密码 |
| `REGISTRATION` | `open` | 设为 `closed` 关闭开放注册 |
| `TRUST_PROXY` | 未设置 | 设为 `1` 时信任 `X-Forwarded-For` 第一段 |

---

## 安全与限制

**已有**

- scrypt 密码哈希、HttpOnly Cookie、SameSite=Lax；
- 写请求同源检查；
- 登录/注册/编辑速率限制；
- 服务端数据校验（与 CI 同一套）；
- 版本快照 + 管理员回滚；
- 静态目录白名单，`server/data` 不可通过 HTTP 访问。

**仍需注意**

- 没有邮箱验证、验证码、IP 封禁后台；公开开放注册前请评估。
- 单进程 + JSON 文件，**不能横向扩容**；多实例会互相覆盖。
- 会话在内存，重启后需重新登录。
- SSE 是单向推送；在线人数按连接数统计，不区分游客。
- 没有图片上传；来源只存 URL。
- 没有细粒度页面保护；任何贡献者都可以修改任何节点（但管理员可回滚）。

需要这些能力时，升级到 Postgres/Supabase：表结构和 RLS 设计见 [docs/roadmap.md](../docs/roadmap.md)。
