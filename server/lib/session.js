'use strict';

const crypto = require('crypto');
const { safeEqual } = require('./util.js');

// 管理端会话令牌：ts.claims.sig，签名是 HMAC-SHA256。
// secret 与当前时间都从外面传，这样能脱开环境变量单测。

/**
 * @param {string} role
 * @param {string} secret
 * @param {number} [now] 毫秒时间戳
 * @returns {string}
 */
function makeToken(role, secret, now) {
  const ts = Number(now) || Date.now();
  const claims = Buffer.from(JSON.stringify({ role: role })).toString('base64url');
  const sig = crypto.createHmac('sha256', String(secret))
    .update(ts + '.' + claims)
    .digest('base64url');
  return ts + '.' + claims + '.' + sig;
}

/**
 * @param {string} token
 * @param {string} secret
 * @param {number} maxAgeMs 有效期（毫秒）
 * @param {number} [now] 毫秒时间戳
 * @returns {{ role: string }|null} 校验不过一律返回 null
 */
function verifyToken(token, secret, maxAgeMs, now) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const ts = parseInt(parts[0], 10);
  const current = Number(now) || Date.now();
  if (!isFinite(ts) || current - ts > maxAgeMs) return null;
  const expect = crypto.createHmac('sha256', String(secret))
    .update(parts[0] + '.' + parts[1])
    .digest('base64url');
  if (!safeEqual(expect, parts[2])) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return claims.role === 'admin' ? { role: 'admin' } : null;
  } catch (e) {
    return null;
  }
}

// Cookie 头 → 对象。值会做一次 decodeURIComponent。
/**
 * @param {string} headerValue req.headers.cookie
 * @returns {Record<string, string>}
 */
function parseCookies(headerValue) {
  const out = {};
  String(headerValue || '').split(';').forEach(function (part) {
    const i = part.indexOf('=');
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch (e) {
        out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
      }
    }
  });
  return out;
}

module.exports = {
  makeToken: makeToken,
  verifyToken: verifyToken,
  parseCookies: parseCookies,
};
