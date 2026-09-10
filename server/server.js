#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.LOG_PORT || '8792', 10);
const HOST = process.env.LOG_HOST || '127.0.0.1';
const DATA_DIR = process.env.LOG_DATA_DIR || path.join(__dirname, '..', 'data');
const RETENTION_DAYS = Math.max(1, parseInt(process.env.LOG_RETENTION_DAYS || '30', 10) || 30);
const ADMIN_CODE = String(process.env.LOG_ADMIN_CODE || '').trim();
const INGEST_TOKEN = String(process.env.LOG_INGEST_TOKEN || '').trim();
const SESSION_SECRET = String(process.env.LOG_SESSION_SECRET || crypto.createHash('sha256').update('log:' + ADMIN_CODE).digest('hex')).trim();
const COOKIE_NAME = 'log_session';
const COOKIE_MAX_AGE = 60 * 60 * 12;
const MAX_BODY = 2 * 1024 * 1024;
const SOURCE_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const LEVELS = ['debug', 'info', 'warn', 'error'];

if (!ADMIN_CODE) {
  console.error('LOG_ADMIN_CODE is not set');
  process.exit(1);
}

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}

function sha256hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function dayName(ts) {
  const d = new Date(ts || Date.now());
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function fileForTs(ts) {
  return path.join(DATA_DIR, dayName(ts) + '.jsonl');
}

function appendEntries(list) {
  if (!Array.isArray(list)) list = [list];
  list.forEach(function (entry) {
    if (!entry || typeof entry.message !== 'string' || !entry.message) return;
    const source = String(entry.source || 'unknown').toLowerCase().trim();
    if (!SOURCE_RE.test(source)) return;
    const level = LEVELS.indexOf(String(entry.level || 'info').toLowerCase()) >= 0
      ? String(entry.level).toLowerCase() : 'info';
    const ts = Number.isFinite(Number(entry.ts)) ? Number(entry.ts) : Date.now();
    const row = {
      id: crypto.randomBytes(8).toString('hex'),
      ts: ts,
      source: source,
      level: level,
      message: String(entry.message),
      meta: entry.meta && typeof entry.meta === 'object' ? entry.meta : undefined,
    };
    fs.appendFileSync(fileForTs(ts), JSON.stringify(row) + '\n');
  });
}

function dayFiles() {
  let names = [];
  try { names = fs.readdirSync(DATA_DIR); } catch (e) { return []; }
  return names
    .filter(function (n) { return /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n); })
    .sort();
}

function fileDayTs(name) {
  return Date.parse(name.slice(0, 10) + 'T00:00:00Z');
}

function listSources() {
  const cutoff = Date.now() - RETENTION_DAYS * 86400000;
  const map = {};
  dayFiles().forEach(function (name) {
    const dayTs = fileDayTs(name);
    if (dayTs < cutoff) return;
    const raw = fs.readFileSync(path.join(DATA_DIR, name), 'utf8').split('\n');
    raw.forEach(function (line) {
      if (!line.trim()) return;
      try {
        const row = JSON.parse(line);
        const s = row.source || 'unknown';
        if (!map[s]) map[s] = { source: s, count: 0, last: 0 };
        map[s].count++;
        if (row.ts > map[s].last) map[s].last = row.ts;
      } catch (e) {}
    });
  });
  return Object.keys(map).sort().map(function (k) {
    return { source: map[k].source, count: map[k].count, last: map[k].last };
  });
}

function queryLogs(opts) {
  const cutoff = Date.now() - RETENTION_DAYS * 86400000;
  const fromRaw = opts.from !== '' && opts.from != null ? Number(opts.from) : NaN;
  const toRaw = opts.to !== '' && opts.to != null ? Number(opts.to) : NaN;
  const from = Math.max(cutoff, Number.isFinite(fromRaw) ? fromRaw : cutoff);
  const to = Math.max(from, Number.isFinite(toRaw) ? toRaw : Date.now());
  const source = opts.source ? String(opts.source).toLowerCase().trim() : '';
  const level = opts.level ? String(opts.level).toLowerCase().trim() : '';
  const q = opts.q ? String(opts.q).toLowerCase().trim() : '';
  const page = Math.max(1, parseInt(opts.page, 10) || 1);
  const size = Math.min(500, Math.max(1, parseInt(opts.size, 10) || 100));
  const fromDay = dayName(from);
  const toDay = dayName(to);
  const matched = [];

  dayFiles().filter(function (name) {
    const d = name.slice(0, 10);
    return d >= fromDay && d <= toDay;
  }).reverse().forEach(function (name) {
    const raw = fs.readFileSync(path.join(DATA_DIR, name), 'utf8').split('\n');
    for (let i = raw.length - 1; i >= 0; i--) {
      const line = raw[i];
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); } catch (e) { continue; }
      if (!row || row.ts < from || row.ts > to) continue;
      if (source && (row.source || '') !== source) continue;
      if (level && (row.level || '') !== level) continue;
      if (q) {
        const hay = ((row.message || '') + '\n' + JSON.stringify(row.meta || {})).toLowerCase();
        if (hay.indexOf(q) < 0) continue;
      }
      matched.push(row);
    }
  });

  const total = matched.length;
  const start = (page - 1) * size;
  return {
    logs: matched.slice(start, start + size),
    total: total,
    page: page,
    size: size,
    pages: Math.ceil(total / size) || 1,
  };
}

function cleanupExpired() {
  const cutoffDay = dayName(Date.now() - RETENTION_DAYS * 86400000);
  let removed = 0;
  dayFiles().forEach(function (name) {
    if (name.slice(0, 10) < cutoffDay) {
      try {
        fs.unlinkSync(path.join(DATA_DIR, name));
        removed++;
      } catch (e) {}
    }
  });
  if (removed) appendEntries({
    source: 'log-center',
    level: 'info',
    message: '日志清理完成，删除 ' + removed + ' 个过期日志文件',
    meta: { retentionDays: RETENTION_DAYS },
  });
}

/* ---------------- HTTP ---------------- */
function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject({ status: 413, message: '请求体过大' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) {
        reject({ status: 400, message: '无效的 JSON' });
      }
    });
    req.on('error', function () { reject({ status: 400, message: '请求读取失败' }); });
  });
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(function (part) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function makeToken(role) {
  const ts = Date.now();
  const claims = Buffer.from(JSON.stringify({ role: role })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET)
    .update(ts + '.' + claims)
    .digest('base64url');
  return ts + '.' + claims + '.' + sig;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const ts = parseInt(parts[0], 10);
  if (!isFinite(ts) || Date.now() - ts > COOKIE_MAX_AGE * 1000) return null;
  const expect = crypto.createHmac('sha256', SESSION_SECRET)
    .update(parts[0] + '.' + parts[1])
    .digest('base64url');
  if (!safeEqual(expect, parts[2])) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return claims.role === 'admin' ? { role: 'admin' } : null;
  } catch (e) { return null; }
}

function isAdmin(req) {
  return !!verifyToken(parseCookies(req)[COOKIE_NAME]);
}

function isIngestAllowed(req) {
  if (!INGEST_TOKEN) return true;
  const header = String(req.headers['x-log-token'] || req.headers.authorization || '');
  return safeEqual(header.replace(/^Bearer\s+/i, ''), INGEST_TOKEN);
}

function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (req.method === 'POST' && p === '/api/login') {
    readBody(req).then(function (body) {
      if (!safeEqual(String(body.code || ''), ADMIN_CODE)) {
        return sendJson(res, 401, { error: '访问码错误' });
      }
      const token = makeToken('admin');
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': COOKIE_NAME + '=' + encodeURIComponent(token) + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + COOKIE_MAX_AGE,
      });
      res.end(JSON.stringify({ ok: true, role: 'admin' }));
    }).catch(function (e) { sendJson(res, e.status || 400, { error: e.message }); });
    return;
  }

  if (req.method === 'POST' && p === '/api/logout') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': COOKIE_NAME + '=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'POST' && p === '/api/v1/logs') {
    if (!isIngestAllowed(req)) return sendJson(res, 401, { error: '无效的日志写入凭证' });
    readBody(req).then(function (body) {
      appendEntries(body);
      sendJson(res, 201, { ok: true });
    }).catch(function (e) { sendJson(res, e.status || 400, { error: e.message }); });
    return;
  }

  if (!isAdmin(req)) {
    return sendJson(res, 401, { error: '未登录' });
  }

  if (req.method === 'GET' && p === '/api/me') {
    return sendJson(res, 200, { role: 'admin' });
  }

  if (req.method === 'GET' && p === '/api/v1/sources') {
    return sendJson(res, 200, { sources: listSources() });
  }

  if (req.method === 'GET' && p === '/api/v1/logs') {
    const params = url.searchParams;
    return sendJson(res, 200, queryLogs({
      source: params.get('source') || '',
      level: params.get('level') || '',
      q: params.get('q') || '',
      from: params.get('from') || '',
      to: params.get('to') || '',
      page: params.get('page') || '1',
      size: params.get('size') || '100',
    }));
  }

  sendJson(res, 404, { error: '未找到接口' });
}

const server = http.createServer(function (req, res) {
  try {
    route(req, res);
  } catch (e) {
    sendJson(res, 500, { error: e.message || '服务器错误' });
  }
});

cleanupExpired();
setInterval(cleanupExpired, 60 * 60 * 1000);

server.listen(PORT, HOST, function () {
  console.log('log-center listening on http://' + HOST + ':' + PORT + ' retention=' + RETENTION_DAYS + 'd');
});
