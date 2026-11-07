# 发布指南

这份指南覆盖两种发布路径：

- **A. GitHub Pages**：只读静态站，免费、CDN、适合公开浏览；
- **B. 实时服务器**：登录、编辑、SSE 广播、版本历史，需要一台 Node 主机。

GitHub Pages **不能**运行 `server/index.mjs`。想要“所有人登录后直接改”，必须走 B。

---

## A. 发布到 GitHub Pages（静态站）

### A1. 不用安装 Git：网页上传

1. 在 GitHub 新建一个空仓库（不要勾选 README / .gitignore / license）。
2. 解压 `human-tech-tree-github.zip`。
3. 进入解压后的目录，全选**目录里的内容**（不是外层文件夹）。
4. 在仓库首页点 **Add file → Upload files**，把内容拖进去。
5. 确认 `.github/`、`assets/`、`data/`、`server/` 等目录都在；Windows 资源管理器需要开启“显示隐藏项目”才能看到 `.github`。
6. 提交 commit。
7. 打开 **Settings → Pages → Build and deployment → Source**，选择 **GitHub Actions**。
8. 打开 **Actions**，等待 `Deploy site` 完成。站点地址会出现在 Pages 设置里。

> GitHub 网页上传对单文件 25 MB、单次 100 个文件有限制；当前项目远低于限制。

### A2. 用 Git 命令行

```bash
git init
git add .
git commit -m "feat: human tech tree"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

然后在仓库 Settings → Pages 选择 **GitHub Actions**。

### A3. 站点配置

- `src/config.js` 的 `repoUrl` 可以留空。部署在 `https://<user>.github.io/<repo>/` 时会自动推断仓库地址，用于「如何参与」里的 GitHub / Issue 入口。
- 如果使用自定义域名，填入：

```js
export const CONFIG = {
  repoUrl: "https://github.com/<you>/<repo>",
};
```

- 数据校验在 `.github/workflows/validate.yml`，Pages 部署在 `.github/workflows/deploy.yml`。PR 会先跑校验。

---

## B. 发布实时服务器

### B1. 本机 / 内网

```bash
npm run live
```

- 默认 `http://127.0.0.1:4174`；
- 首次启动创建管理员，密码在控制台和 `server/data/FIRST_ADMIN.txt`；
- 让局域网访问：`HOST=0.0.0.0 npm run live`。

### B2. Docker / VPS / Render / Fly.io

```bash
docker build -t human-tech-tree .
docker run -d -p 4174:4174 \
  -e HOST=0.0.0.0 \
  -e REGISTRATION=closed \
  -e ADMIN_PASSWORD='换成强密码' \
  -v human-tech-tree-data:/app/server/data \
  human-tech-tree
```

平台部署要点：

- 启动命令：`node server/index.mjs`
- 必须挂持久磁盘到 `/app/server/data`；
- 设置 `HOST=0.0.0.0`，让平台注入 `PORT`；
- 用 HTTPS（反向代理或平台域名）；
- 只跑一个实例，不要把同一份 JSON 挂给多个进程；
- 公开部署建议 `REGISTRATION=closed`，用管理员账号发邀请。

完整说明见 [server/README.md](server/README.md)。

### B3. 数据备份

`server/data/` 是唯一数据源：

- `tech.json`：当前数据；
- `revisions.json`：最近 200 个快照；
- `users.json`：账号哈希；
- `state.json`：版本号。

定期备份整个目录。删除它后，服务器会从 `data/tech.json` 重新初始化（账号也会重建）。

---

## C. 把实时数据同步回静态站

在实时服务器上编辑后：

```bash
npm run promote
```

它会把 `server/data/tech.json` 校验后写回 `data/tech.json`。之后：

```bash
npm run validate
git add data/tech.json
git commit -m "data: sync live edits"
git push
```

Pages 会重新部署只读快照。

---

## 发布前检查清单

- [ ] `npm run validate` 通过（160 项 / 270 条依赖）
- [ ] GitHub Pages 的 Source 已设为 GitHub Actions
- [ ] `src/config.js` 的 `repoUrl` 正确（或使用 github.io 自动推断）
- [ ] 没有把 `server/data/` 提交到 Git（`.gitignore` 已忽略）
- [ ] 实时服务器使用强 `ADMIN_PASSWORD`，并考虑 `REGISTRATION=closed`
- [ ] 实时服务器挂载了持久磁盘并配置 HTTPS
- [ ] 备份了 `server/data/`
