'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const ENTRY = require('../server/lib/entry.js');

// normalizeEntry 是日志入库的唯一入口，写进去的东西没法回退，
// 所以这里断言的重点是「什么会被丢弃」。

test('normalizeEntry 正常条目', function () {
  const row = ENTRY.normalizeEntry(
    { source: 'Feishu-Bot', level: 'WARN', message: '出错了', meta: { a: 1 } },
    'id123',
    1000
  );
  assert.deepStrictEqual(row, {
    id: 'id123',
    ts: 1000,
    source: 'feishu-bot', // 来源统一转小写
    level: 'warn',        // 等级也转小写
    message: '出错了',
    meta: { a: 1 },
  });
});

test('normalizeEntry 丢弃非法条目', function () {
  const ok = function (e) { return ENTRY.normalizeEntry(e, 'i', 1000); };
  assert.strictEqual(ok(null), null);
  assert.strictEqual(ok({}), null);
  assert.strictEqual(ok({ message: '' }), null);          // 空消息
  assert.strictEqual(ok({ message: 123 }), null);         // 消息必须是字符串
  // 来源不合规：含空格、含路径符、超长、以符号开头
  assert.strictEqual(ok({ message: 'x', source: 'a b' }), null);
  assert.strictEqual(ok({ message: 'x', source: '../etc' }), null);
  assert.strictEqual(ok({ message: 'x', source: 'x'.repeat(65) }), null);
  assert.strictEqual(ok({ message: 'x', source: '-lead' }), null);
});

test('normalizeEntry 的兜底值', function () {
  const r = ENTRY.normalizeEntry({ message: 'x' }, 'i', 1000);
  assert.strictEqual(r.source, 'unknown');   // 没给来源
  assert.strictEqual(r.level, 'info');       // 没给等级
  assert.strictEqual(r.ts, 1000);            // 没给时间 → 用传入的 now
  assert.strictEqual(r.meta, undefined);
  // 等级不在白名单里也回落 info，不丢日志
  assert.strictEqual(ENTRY.normalizeEntry({ message: 'x', level: 'fatal' }, 'i', 1).level, 'info');
  // ts 给了非法值同样回落
  assert.strictEqual(ENTRY.normalizeEntry({ message: 'x', ts: 'abc' }, 'i', 1000).ts, 1000);
});

test('matchesFilter 按时间/来源/等级/关键字过滤', function () {
  const row = { ts: 1000, source: 'monitor', level: 'info', message: 'CPU 高', meta: { percent: 91 } };
  const base = { from: 0, to: 2000, source: '', level: '', q: '' };
  assert.strictEqual(ENTRY.matchesFilter(row, base), true);
  // 时间边界是闭区间
  assert.strictEqual(ENTRY.matchesFilter(row, Object.assign({}, base, { from: 1000, to: 1000 })), true);
  assert.strictEqual(ENTRY.matchesFilter(row, Object.assign({}, base, { from: 1001 })), false);
  assert.strictEqual(ENTRY.matchesFilter(row, Object.assign({}, base, { to: 999 })), false);
  assert.strictEqual(ENTRY.matchesFilter(row, Object.assign({}, base, { source: 'monitor' })), true);
  assert.strictEqual(ENTRY.matchesFilter(row, Object.assign({}, base, { source: 'other' })), false);
  assert.strictEqual(ENTRY.matchesFilter(row, Object.assign({}, base, { level: 'info' })), true);
  assert.strictEqual(ENTRY.matchesFilter(row, Object.assign({}, base, { level: 'error' })), false);
  // 关键字同时搜 message 与 meta
  assert.strictEqual(ENTRY.matchesFilter(row, Object.assign({}, base, { q: 'cpu' })), true);
  assert.strictEqual(ENTRY.matchesFilter(row, Object.assign({}, base, { q: '91' })), true);
  assert.strictEqual(ENTRY.matchesFilter(row, Object.assign({}, base, { q: 'nope' })), false);
});

test('matchesFilter 对空行安全', function () {
  assert.strictEqual(ENTRY.matchesFilter(null, { from: 0, to: 1, source: '', level: '', q: '' }), false);
});

test('normalizeFilter 把时间夹在保留期内', function () {
  const now = 100 * 86400000; // 第 100 天
  const f = ENTRY.normalizeFilter({}, now, 30);
  assert.strictEqual(f.from, now - 30 * 86400000); // 不给起始时间 → 保留期边界
  assert.strictEqual(f.to, now);
  // 早于保留期的起始时间会被抬到边界
  assert.strictEqual(ENTRY.normalizeFilter({ from: 0 }, now, 30).from, now - 30 * 86400000);
  // to 不能早于 from
  const g = ENTRY.normalizeFilter({ from: 500, to: 100 }, now, 30);
  assert.strictEqual(g.to, g.from);
  // 查询条件统一转小写
  const h = ENTRY.normalizeFilter({ source: 'Monitor', level: 'WARN', q: 'CPU' }, now, 30);
  assert.strictEqual(h.source, 'monitor');
  assert.strictEqual(h.level, 'warn');
  assert.strictEqual(h.q, 'cpu');
});

test('paginate 分页与上限', function () {
  const list = Array.from({ length: 250 }, function (_, i) { return i; });
  const p1 = ENTRY.paginate(list, 1, 100);
  assert.strictEqual(p1.total, 250);
  assert.strictEqual(p1.pages, 3);
  assert.deepStrictEqual(p1.logs.slice(0, 3), [0, 1, 2]);
  assert.strictEqual(p1.logs.length, 100);
  // 页码越界给空数组，但 total/pages 仍然对
  assert.deepStrictEqual(ENTRY.paginate(list, 9, 100).logs, []);
  assert.strictEqual(ENTRY.paginate(list, 9, 100).total, 250);
  // size 上限 500；非法值回落 100
  assert.strictEqual(ENTRY.paginate(list, 1, 9999).size, 500);
  assert.strictEqual(ENTRY.paginate(list, 1, 'abc').size, 100);
  // page 最小 1
  assert.strictEqual(ENTRY.paginate(list, -5, 10).page, 1);
  // 空列表 pages 也是 1，避免前端算出 0
  assert.strictEqual(ENTRY.paginate([], 1, 10).pages, 1);
});
