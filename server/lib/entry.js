'use strict';

// 日志条目的校验、归一化与查询过滤。纯函数，时间与 id 从外面传。

const SOURCE_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const LEVELS = ['debug', 'info', 'warn', 'error'];
// 隐私维度：only = 只看私密（私密区域），exclude = 只不看私密（普通视图）
const PRIVACY = ['only', 'exclude', 'all'];

/**
 * 把客户端提交的一条日志整理成入库的行。
 * 消息为空、来源不合规的一律丢弃（返回 null），而不是写进库里。
 *
 * @param {any} entry
 * @param {string} id 调用方生成的 id（保持这个函数纯净）
 * @param {number} now 毫秒时间戳，entry.ts 缺失时用它
 * @returns {{ id: string, ts: number, source: string, level: string, message: string, meta?: any, private?: boolean }|null}
 */
function normalizeEntry(entry, id, now) {
  if (!entry || typeof entry.message !== 'string' || !entry.message) return null;
  const source = String(entry.source || 'unknown').toLowerCase().trim();
  if (!SOURCE_RE.test(source)) return null;
  // 注意：条件里用的兜底值必须和取值用的是同一个变量。
  // 原来写成 LEVELS.indexOf(String(entry.level || 'info')...) >= 0
  //   ? String(entry.level).toLowerCase() : 'info'
  // 条件按 'info' 判断成立、取值却用了原始的 entry.level（undefined），
  // 于是不带 level 的条目会被存成字符串 "undefined"，
  // 之后按 level 过滤永远匹配不上。
  const levelRaw = String(entry.level || 'info').toLowerCase();
  const level = LEVELS.indexOf(levelRaw) >= 0 ? levelRaw : 'info';
  const ts = Number.isFinite(Number(entry.ts)) ? Number(entry.ts) : now;
  const row = {
    id: id,
    ts: ts,
    source: source,
    level: level,
    message: String(entry.message),
    meta: entry.meta && typeof entry.meta === 'object' ? entry.meta : undefined,
  };
  // 只有显式 private: true 才算私密；写进库里而不是靠来源命名区分，
  // 这样同一个服务也能混合写普通日志与私密日志
  if (entry.private === true) row.private = true;
  return row;
}

/**
 * 条目是不是私密条目。
 * @param {any} row
 * @returns {boolean}
 */
function isPrivate(row) {
  return !!(row && row.private === true);
}

/**
 * 一条日志是否命中查询条件。
 * @param {any} row
 * @param {{ from: number, to: number, source: string, level: string, q: string }} filter
 * @returns {boolean}
 */
function matchesFilter(row, filter) {
  if (!row) return false;
  if (filter.privacy === 'only' && !isPrivate(row)) return false;
  if (filter.privacy === 'exclude' && isPrivate(row)) return false;
  if (row.ts < filter.from || row.ts > filter.to) return false;
  if (filter.source && (row.source || '') !== filter.source) return false;
  if (filter.level && (row.level || '') !== filter.level) return false;
  if (filter.q) {
    // 消息和 meta 一起搜，方便按结构化字段定位
    const hay = ((row.message || '') + '\n' + JSON.stringify(row.meta || {})).toLowerCase();
    if (hay.indexOf(filter.q) < 0) return false;
  }
  return true;
}

/**
 * 把查询参数整理成过滤器。时间范围会被夹在保留期内。
 * @param {any} opts
 * @param {number} now
 * @param {number} retentionDays
 * @returns {{ from: number, to: number, source: string, level: string, q: string }}
 */
function normalizeFilter(opts, now, retentionDays) {
  const o = opts || {};
  const cutoff = now - retentionDays * 86400000;
  const fromRaw = o.from !== '' && o.from != null ? Number(o.from) : NaN;
  const toRaw = o.to !== '' && o.to != null ? Number(o.to) : NaN;
  const from = Math.max(cutoff, Number.isFinite(fromRaw) ? fromRaw : cutoff);
  const to = Math.max(from, Number.isFinite(toRaw) ? toRaw : now);
  return {
    from: from,
    to: to,
    source: o.source ? String(o.source).toLowerCase().trim() : '',
    level: o.level ? String(o.level).toLowerCase().trim() : '',
    q: o.q ? String(o.q).toLowerCase().trim() : '',
    privacy: PRIVACY.indexOf(String(o.privacy || 'exclude')) >= 0 ? String(o.privacy || 'exclude') : 'exclude',
  };
}

/**
 * 分页。size 上限 500，page 最小 1。
 * @param {any[]} list
 * @param {any} pageRaw
 * @param {any} sizeRaw
 * @returns {{ logs: any[], total: number, page: number, size: number, pages: number }}
 */
function paginate(list, pageRaw, sizeRaw) {
  const page = Math.max(1, parseInt(pageRaw, 10) || 1);
  const size = Math.min(500, Math.max(1, parseInt(sizeRaw, 10) || 100));
  const total = list.length;
  const start = (page - 1) * size;
  return {
    logs: list.slice(start, start + size),
    total: total,
    page: page,
    size: size,
    pages: Math.ceil(total / size) || 1,
  };
}

module.exports = {
  SOURCE_RE: SOURCE_RE,
  LEVELS: LEVELS,
  normalizeEntry: normalizeEntry,
  isPrivate: isPrivate,
  matchesFilter: matchesFilter,
  normalizeFilter: normalizeFilter,
  paginate: paginate,
};
