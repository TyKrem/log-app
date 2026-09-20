'use strict';

const crypto = require('crypto');
const { safeEqual } = require('./util.js');

// 会话令牌：ts.claims.sig，签名是 HMAC-SHA256。
// secret 与当前时间都从外面传，这样能脱开环境变量单测。
//
// 两种角色：
//   admin   —— 普通后台（访问码登录），能查普通日志
//   private —— 私密区域（超级码解锁），只能查/写私密条目
// 角色必须显式在白名单里，伪造的其它角色一律判无效。
const ROLES = ['admin', 'private'];

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
    return ROLES.indexOf(claims.role) >= 0 ? { role: claims.role } : null;
  } catch (e) {
    return null;
  }
}

/**
 * 取令牌里的角色，校验不过返回空串。调用方自己判断是不是它要的角色。
 * @param {string} token
 * @param {string} secret
 * @param {number} maxAgeMs
 * @param {number} [now]
 * @returns {string}
 */
function tokenRole(token, secret, maxAgeMs, now) {
  const claims = verifyToken(token, secret, maxAgeMs, now);
  return claims ? claims.role : '';
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
  tokenRole: tokenRole,
  parseCookies: parseCookies,
};
