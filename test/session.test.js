'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const SESSION = require('../server/lib/session.js');

// 令牌是管理口的唯一凭证，这里把所有能想到的篡改路径都试一遍。

const SECRET = 'test-secret';
const MAX_AGE = 12 * 60 * 60 * 1000; // 12 小时
const NOW = 1700000000000;

test('签发后能验回来', function () {
  const t = SESSION.makeToken('super', SECRET, NOW);
  assert.strictEqual(t.split('.').length, 3);
  assert.deepStrictEqual(SESSION.verifyToken(t, SECRET, MAX_AGE, NOW), { role: 'super' });
});

test('过期就不认', function () {
  const t = SESSION.makeToken('super', SECRET, NOW);
  assert.ok(SESSION.verifyToken(t, SECRET, MAX_AGE, NOW + MAX_AGE - 1), '差一点没过期应有效');
  assert.strictEqual(SESSION.verifyToken(t, SECRET, MAX_AGE, NOW + MAX_AGE + 1), null, '过期应无效');
});

test('换密钥就不认', function () {
  const t = SESSION.makeToken('super', SECRET, NOW);
  assert.strictEqual(SESSION.verifyToken(t, 'another-secret', MAX_AGE, NOW), null);
});

test('篡改载荷就不认', function () {
  const t = SESSION.makeToken('super', SECRET, NOW);
  const parts = t.split('.');
  // 往载荷里塞东西，签名对不上
  const forged = Buffer.from(JSON.stringify({ role: 'super', extra: 1 })).toString('base64url');
  assert.strictEqual(SESSION.verifyToken(parts[0] + '.' + forged + '.' + parts[2], SECRET, MAX_AGE, NOW), null);
});

test('篡改签名就不认', function () {
  const t = SESSION.makeToken('super', SECRET, NOW);
  const parts = t.split('.');
  const flipped = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  assert.strictEqual(SESSION.verifyToken(parts[0] + '.' + parts[1] + '.' + flipped, SECRET, MAX_AGE, NOW), null);
});

test('非 super 角色的令牌不认', function () {
  const t = SESSION.makeToken('guest', SECRET, NOW);
  assert.strictEqual(SESSION.verifyToken(t, SECRET, MAX_AGE, NOW), null);
});

test('畸形令牌一律返回 null，不抛', function () {
  const bad = [
    '', null, undefined, 'abc', 'a.b', 'a.b.c.d',
    'notanumber.claims.sig',
    '...',
    '123.' + Buffer.from('不是JSON').toString('base64url') + '.sig',
  ];
  bad.forEach(function (t) {
    assert.strictEqual(SESSION.verifyToken(t, SECRET, MAX_AGE, NOW), null, '应拒绝：' + t);
  });
});

test('parseCookies 解析与容错', function () {
  assert.deepStrictEqual(
    SESSION.parseCookies('a=1; b=2'),
    { a: '1', b: '2' }
  );
  // 值里带百分号编码要还原
  assert.deepStrictEqual(SESSION.parseCookies('t=' + encodeURIComponent('x.y.z')), { t: 'x.y.z' });
  // 没有等号的段、空串都跳过
  assert.deepStrictEqual(SESSION.parseCookies('novalue; a=1'), { a: '1' });
  assert.deepStrictEqual(SESSION.parseCookies(''), {});
  assert.deepStrictEqual(SESSION.parseCookies(null), {});
  // 畸形的百分号编码不能抛，退回原值
  assert.deepStrictEqual(SESSION.parseCookies('a=%E0%A4%A'), { a: '%E0%A4%A' });
});

// 整站只有一种角色：super（超级码解锁）。历史上那套 admin / private 双角色已合并

test('只认 super 角色，别的角色一律不认', function () {
  const NOW = 1700000000000;
  const MAX_AGE = 3600000;
  const token = SESSION.makeToken('super', SECRET, NOW);
  assert.deepStrictEqual(SESSION.verifyToken(token, SECRET, MAX_AGE, NOW), { role: 'super' });
  assert.strictEqual(SESSION.tokenRole(token, SECRET, MAX_AGE, NOW), 'super');
  // 白名单外的角色一律判无效：旧的 admin / private 令牌在改版后全部失效
  ['admin', 'private', 'guest'].forEach(function (role) {
    const forged = SESSION.makeToken(role, SECRET, NOW);
    assert.strictEqual(SESSION.verifyToken(forged, SECRET, MAX_AGE, NOW), null, role + ' 不该被接受');
  });
  assert.strictEqual(SESSION.tokenRole('bad.token.here', SECRET, MAX_AGE, NOW), '');
});
