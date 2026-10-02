'use strict';

const crypto = require('crypto');

const COOKIE_NAME = 'tykrem_session';
const MAX_AGE_SECONDS = 12 * 60 * 60;

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function issue(role, secret, now = Date.now()) {
  if (role !== 'admin' && role !== 'read') throw new Error('无效的会话角色');
  const payload = Buffer.from(JSON.stringify({ v: 1, role, exp: Math.floor(now / 1000) + MAX_AGE_SECONDS,
    nonce: crypto.randomBytes(12).toString('base64url') })).toString('base64url');
  return payload + '.' + sign(payload, secret);
}

function verify(token, secret, now = Date.now()) {
  if (!secret || typeof token !== 'string' || token.length > 512) return '';
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return '';
  const expected = Buffer.from(sign(parts[0], secret));
  const actual = Buffer.from(parts[1]);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return '';
  try {
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const current = Math.floor(now / 1000);
    if (data.v !== 1 || (data.role !== 'admin' && data.role !== 'read') ||
        !Number.isSafeInteger(data.exp) || data.exp <= current || data.exp > current + MAX_AGE_SECONDS) return '';
    return data.role;
  } catch (error) { return ''; }
}

function cookieValue(header) {
  const match = String(header || '').match(/(?:^|;\s*)tykrem_session=([^;]*)/);
  return match ? match[1] : '';
}

module.exports = { COOKIE_NAME, MAX_AGE_SECONDS, issue, verify, cookieValue };
