/**
 * 站点配置。
 * 部署到自己的仓库后，把 repoUrl 改成真实地址，贡献者就能直接看到
 * “Fork / 提 PR”的入口；留空时会根据 github.io 地址自动推断。
 */
export const CONFIG = {
  siteName: "人类科技树",
  siteTagline: "TECH TREE OF HUMANITY",
  repoUrl: "",
  dataPath: "./data/tech.json",
  storageKey: "human-tech-tree:draft:v1",
  issueTemplate: "tech-suggestion.yml",
  license: "CC BY-SA 4.0",
  minYear: -3300000,
  maxYear: 2200,
};

export function getRepoUrl() {
  if (CONFIG.repoUrl) return CONFIG.repoUrl.replace(/\/+$/, "");
  const host = window.location.hostname;
  const segments = window.location.pathname.split("/").filter(Boolean);
  if (host.endsWith(".github.io") && segments.length > 0) {
    return `https://github.com/${host.slice(0, -".github.io".length)}/${segments[0]}`;
  }
  return "";
}

export function getIssueUrl() {
  const repo = getRepoUrl();
  if (!repo) return "";
  return `${repo}/issues/new?template=${encodeURIComponent(CONFIG.issueTemplate)}`;
}

export function getRepoLabel() {
  const repo = getRepoUrl();
  return repo ? repo.replace(/^https?:\/\/github\.com\//, "") : "";
}
