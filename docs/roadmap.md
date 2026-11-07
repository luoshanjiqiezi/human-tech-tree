# 协作架构与路线图

这份文档回答三个问题：

1. 为什么静态版用 **浏览器编辑 + Git 审核**，而不是一个公开可写数据库？
2. 单机实时协作怎么实现，已经做到哪一步？
3. 规模上去后，如何升级到 Postgres/Supabase？

当前代码已经包含 **Phase 1（静态 + Git）** 和 **Phase 1.5（单机实时服务器）**；Phase 2 是规模化方案。

---

## Phase 1：静态站 + Git（已实现）

```text
data/tech.json ──► 静态站点（HTML/CSS/ESM）
       ▲                    │
       │                    ├─ 搜索 / 筛选 / DAG 布局 / 详情
       │                    └─ 浏览器编辑 → localStorage 草稿 → 导出 tech.json
       │
       └── GitHub PR / Issue ◄── 贡献者
                 │
                 ├─ GitHub Actions: validate-data.mjs（结构、引用、环、年代提示）
                 └─ 合并 main → 构建 dist/ → GitHub Pages
```

**优点**

- 零服务器成本，CDN 直接扛流量；
- 每次改动都有 commit、diff、review、回滚；
- 数据可 fork，站点不会锁定在某个平台；
- 不需要处理账号、验证码、垃圾内容和实时冲突。

**局限**

- 非技术用户提交门槛高；
- 编辑不能实时同步；
- 多人同时改同一文件会产生 Git 冲突；
- 没有细粒度权限（谁能直接发布、谁只能建议）。

---

## Phase 1.5：单机实时协作（已实现）

```text
浏览器 ──登录/编辑──► POST /api/nodes
   ▲                      │
   │                      ├─ validateData() 同一套 DAG 校验
   │                      ├─ 原子写 server/data/tech.json
   │                      ├─ 追加 revisions.json（最近 200 个完整快照）
   │                      └─ SSE /api/events 广播完整快照
   │
   └──────── 所有在线页面自动重绘 ◄──┘
```

实现位置：

- `server/index.mjs`：零依赖 HTTP + API + SSE + 静态站；
- `src/live.js`：浏览器端 SSE / 登录 / 编辑 API；
- `scripts/promote-live.mjs`：把实时数据同步回 `data/tech.json`；
- `Dockerfile`：单镜像部署。

**已具备**

- 账号注册/登录，scrypt 密码哈希，HttpOnly + SameSite=Lax 会话；
- 贡献者增改、管理员删除/恢复/导入/建号；
- 登录后编辑立即写入并广播；所有页面实时更新；
- 完整版本快照 + 管理员回滚；
- 登录/注册/编辑速率限制、同源检查；
- 静态目录白名单，账号与数据文件不可通过 HTTP 读取；
- 单机 JSON 持久化，适合几十到几百人的社区。

**明确不做**

- 多实例共享一个 JSON 文件（会互相覆盖）；
- 邮箱验证 / 验证码 / 细粒度封禁后台；
- 预审核队列（当前是“登录即发布 + 事后回滚”）；
- 图片上传 / 富文本。

这些限制决定了 Phase 1.5 适合 **可信社区 / 内网 / 小范围公开**。如果要让完全陌生的公众开放注册，应该进入 Phase 2，或者至少设置 `REGISTRATION=closed` 并人工发号。

---

## Phase 2：Postgres/Supabase（规模化）

目标：**匿名可读；登录可建议；编辑者审核发布；所有改动可回滚；网站仍然以静态数据为主。**

### 2.1 数据模型

```sql
-- 已发布的科技节点
create table public.tech_nodes (
  id            text primary key,
  name          text not null,
  name_en       text,
  year          integer not null,
  approx        boolean not null default false,
  era           text not null,
  category      text not null,
  summary       text not null,
  description   text,
  status        text not null default 'established',
  tags          text[] not null default '{}',
  sources       jsonb not null default '[]',
  published     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 依赖边
create table public.tech_edges (
  from_id  text not null references public.tech_nodes(id) on delete cascade,
  to_id    text not null references public.tech_nodes(id) on delete cascade,
  primary key (from_id, to_id),
  check (from_id <> to_id)
);

-- 用户资料与角色
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role        text not null default 'contributor'
              check (role in ('contributor', 'reviewer', 'admin')),
  created_at  timestamptz not null default now()
);

-- 建议：不直接写生产表，先进入审核队列
create table public.suggestions (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references public.profiles(id),
  kind        text not null check (kind in ('create', 'update', 'delete', 'edge')),
  payload     jsonb not null,
  base_version text,
  note        text,
  status      text not null default 'pending'
              check (status in ('pending', 'accepted', 'rejected', 'superseded')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at  timestamptz not null default now()
);

-- 每次发布写一条完整快照，支持 diff 和回滚
create table public.revisions (
  id          bigint generated always as identity primary key,
  version     text not null unique,
  data        jsonb not null,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  note        text
);
```

### 2.2 权限（RLS）

- `tech_nodes` / `tech_edges`：`select` 对 `anon` 开放，只允许 `published = true`；写入只允许 `reviewer` / `admin`。
- `suggestions`：登录用户只能 `select` 自己的；`insert` 需要 `auth.uid() = author_id`，并做速率限制；`update` 只能改自己的 `pending` 建议。
- `revisions`：所有人可读；只有服务端函数写。
- 发布动作放在 `security definer` 的 RPC 里：校验 DAG 无环、校验节点字段、写 revision、更新节点/边，事务一次完成。

### 2.3 审核流

```text
登录 → 编辑（本地乐观更新）→ 提交建议
        │
        ├─ 自动校验：字段 / 引用 / 环 / 年代提示
        ├─ 审核队列：reviewer 看 diff、来源、讨论
        ├─ 接受 → RPC 发布 → 写 revision → 实时广播
        └─ 拒绝 → 附理由，建议保留在用户历史里
```

- 新用户默认只能“建议”，不能直接发布；
- 连续贡献、来源可靠的用户可以升级为 `reviewer`；
- 管理员可以回滚到任意 revision；
- 所有写操作记 `audit_log`（谁、何时、改了什么、IP 哈希）。

### 2.4 反滥用

公开编辑必须假设会遇到垃圾内容和恶意破坏：

- OAuth（GitHub / Google）+ 邮箱验证；
- 每用户每日建议数、每 IP 速率限制；
- 新账号的前 N 条建议必须人工审核；
- 来源 URL 黑名单 / 域名信誉；
- 关键词与链接频率检测；
- 敏感节点（战争、核能、疫苗等）提高审核级别；
- 一键回滚 + 冻结账号；
- 不提供匿名写入。

### 2.5 读取路径

即使有了数据库，网站也不应该每次请求都查库：

1. 发布后由 Edge Function 生成 `data/tech.json` 快照；
2. 静态站优先 fetch 快照（CDN 缓存）；
3. 页面打开后通过 Supabase Realtime 订阅变更，做增量更新；
4. 数据库故障时，静态快照仍然可用。

这样保留了静态站的可用性和成本优势，又获得实时协作。

### 2.6 迁移步骤

1. 建 Supabase 项目，执行 schema + RLS；
2. 写导入脚本：`tech.json` → `tech_nodes` + `tech_edges`；
3. 保留现有 `scripts/validate-data.mjs` 作为服务端校验的共享逻辑；
4. 先上线“只读 + 建议”模式，不开放直接发布；
5. 招募 3–5 名 reviewer，跑两周审核队列；
6. 再开放 Realtime 编辑；
7. 保留 Git 导出，作为灾难恢复和开放数据渠道。

---

## Phase 3：规模化之后

- **引用系统**：每个年代/因果判断绑定具体来源，支持多来源和可信度标注；
- **讨论**：节点级评论区，争议进入 `disputed` 状态；
- **多语言**：`name` / `summary` / `description` 做 i18n 表；
- **公共 API**：`/api/v1/nodes`、`/api/v1/graph`，供研究者和第三方可视化使用；
- **快照与论文引用**：每次发布生成 DOI 友好的版本号；
- **可视化扩展**：时间轴视图、文明/地区筛选、技术扩散动画；
- **导入管线**：从 Wikidata / Wikipedia / 博物馆开放数据半自动提案，但仍需人工审核。

---

## 不做什么

- 不做“匿名直接写生产库”：破坏成本太低；
- 不做“所有技术都连所有技术”的知识图谱：那会失去“树”的解释力；
- 不把产品型号、公司、人物当作技术节点；
- 不用单一文明视角叙述全球技术史；有争议的起源并列呈现并给来源。

---

## 决策记录

| 日期 | 决策 | 理由 |
| --- | --- | --- |
| 2026-11 | 先做静态站 + Git | 零成本、可审计，先验证数据模型和社区需求 |
| 2026-11 | 横轴用依赖深度，不用年份 | 避免历史倒挂导致箭头回退 |
| 2026-11 | 数据单文件 JSON | 160 项规模下，单文件 diff/review 最方便 |
| 2026-11 | 编辑先落 localStorage | 无后端也能让非技术用户体验编辑流程 |
| 2026-11 | 增加单机实时服务器（JSON + SSE） | 先验证登录、实时广播、版本回滚，不引入外部依赖 |
| 2026-11 | 贡献者可增改，删除/恢复仅管理员 | 降低破坏面，同时保留任何人都能补枝的低门槛 |
| 2026-11 | 暂不开放“匿名直接写公网库” | 缺少验证码、邮箱验证和审核队列，先用登录 + 速率限制 + 回滚 |
