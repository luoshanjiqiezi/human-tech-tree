/**
 * 全局常量：时代、分类、状态与年代格式化。
 * 数据文件（data/tech.json）里只能使用这里登记的 key。
 */

export const ERAS = {
  paleolithic: {
    label: "旧石器时代",
    short: "旧石器",
    color: "#b08968",
    range: "约 330 万年前 – 前 10000 年",
  },
  neolithic: {
    label: "新石器时代",
    short: "新石器",
    color: "#8fbc6a",
    range: "前 10000 – 前 3300 年",
  },
  bronze: {
    label: "青铜时代",
    short: "青铜",
    color: "#d29a5b",
    range: "前 3300 – 前 1200 年",
  },
  iron: {
    label: "铁器时代",
    short: "铁器",
    color: "#94a3b8",
    range: "前 1200 – 前 500 年",
  },
  classical: {
    label: "古典时代",
    short: "古典",
    color: "#e0b45c",
    range: "前 500 – 公元 500 年",
  },
  medieval: {
    label: "中世纪",
    short: "中世纪",
    color: "#b08bd4",
    range: "501 – 1450 年",
  },
  renaissance: {
    label: "文艺复兴",
    short: "文艺复兴",
    color: "#e0896a",
    range: "1451 – 1700 年",
  },
  industrial: {
    label: "工业革命",
    short: "工业",
    color: "#f2b544",
    range: "1701 – 1870 年",
  },
  electric: {
    label: "电气时代",
    short: "电气",
    color: "#ffe066",
    range: "1871 – 1945 年",
  },
  atomic: {
    label: "原子时代",
    short: "原子",
    color: "#6fb7ff",
    range: "1946 – 1969 年",
  },
  information: {
    label: "信息时代",
    short: "信息",
    color: "#4dd6c8",
    range: "1970 – 1999 年",
  },
  digital: {
    label: "数字时代",
    short: "数字",
    color: "#63e6a5",
    range: "2000 – 2014 年",
  },
  ai: {
    label: "智能时代",
    short: "智能",
    color: "#ff7ac6",
    range: "2015 – 2025 年",
  },
  future: {
    label: "未来 / 探索中",
    short: "未来",
    color: "#a78bfa",
    range: "2026 年起",
  },
};

export const ERA_ORDER = [
  "paleolithic",
  "neolithic",
  "bronze",
  "iron",
  "classical",
  "medieval",
  "renaissance",
  "industrial",
  "electric",
  "atomic",
  "information",
  "digital",
  "ai",
  "future",
];

export const CATEGORIES = {
  energy: { label: "能源", color: "#ffb454", icon: "bolt" },
  materials: { label: "材料", color: "#e07a5f", icon: "layers" },
  tools: { label: "工具与机械", color: "#9fb0c7", icon: "gear" },
  agriculture: { label: "农业与食品", color: "#8fbc6a", icon: "leaf" },
  information: { label: "信息与传播", color: "#4dd0e1", icon: "wave" },
  transport: { label: "交通", color: "#64b5f6", icon: "arrow" },
  medicine: { label: "医学", color: "#f06292", icon: "cross" },
  science: { label: "科学", color: "#b388ff", icon: "atom" },
  computing: { label: "计算与智能", color: "#66d9a8", icon: "chip" },
  space: { label: "航天", color: "#ff8a65", icon: "orbit" },
  society: { label: "社会与制度", color: "#d4a94a", icon: "people" },
};

export const CATEGORY_ORDER = [
  "energy",
  "materials",
  "tools",
  "agriculture",
  "information",
  "transport",
  "medicine",
  "science",
  "computing",
  "space",
  "society",
];

export const STATUSES = {
  established: { label: "已确立", color: "#8fa3bf" },
  experimental: { label: "实验 / 前沿", color: "#ffb454" },
  speculative: { label: "推测 / 设想", color: "#a78bfa" },
  disputed: { label: "年代或归属有争议", color: "#f06292" },
};

export const YEAR_MIN = -3300000;
export const YEAR_MAX = 2200;

/** 把数字年份格式化成中文年代。 */
export function formatYear(year, approx = false) {
  const prefix = approx ? "约" : "";
  if (!Number.isFinite(year)) return "年代未知";
  if (year < 0) {
    const abs = Math.abs(year);
    if (abs >= 10000) {
      const wan = abs / 10000;
      const text = wan >= 100 ? Math.round(wan) : Math.round(wan * 10) / 10;
      return `${prefix}前 ${text} 万年`;
    }
    return `${prefix}前 ${abs} 年`;
  }
  return `${prefix}${year} 年`;
}

/** 根据年份粗略推断时代，仅用于编辑器的默认值。 */
export function eraForYear(year) {
  if (year < -10000) return "paleolithic";
  if (year < -3300) return "neolithic";
  if (year < -1200) return "bronze";
  if (year < -500) return "iron";
  if (year <= 500) return "classical";
  if (year <= 1450) return "medieval";
  if (year <= 1700) return "renaissance";
  if (year <= 1870) return "industrial";
  if (year <= 1945) return "electric";
  if (year <= 1969) return "atomic";
  if (year <= 1999) return "information";
  if (year <= 2014) return "digital";
  if (year <= 2025) return "ai";
  return "future";
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function makeId(nameEn, fallbackSeed = Date.now()) {
  const base = String(nameEn || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || `tech-${fallbackSeed.toString(36)}`;
}
