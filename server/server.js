#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const UTIL = require('./lib/util.js');
const SHARED_SESSION = require('./lib/session.js');
const ENTRY = require('./lib/entry.js');

const PORT = parseInt(process.env.LOG_PORT || '8792', 10);
const HOST = process.env.LOG_HOST || '127.0.0.1';
const DATA_DIR = process.env.LOG_DATA_DIR || path.join(__dirname, '..', 'data');
const RETENTION_DAYS = Math.max(1, parseInt(process.env.LOG_RETENTION_DAYS || '30', 10) || 30);
const INGEST_TOKEN = String(process.env.LOG_INGEST_TOKEN || '').trim();
const SHARED_SECRET = String(process.env.AUTH_SESSION_SECRET || '').trim();
const MAX_BODY = 2 * 1024 * 1024;

if (!SHARED_SECRET) {
  console.error('未配置统一会话签名密钥：检查 /etc/auth-session.env');
  process.exit(1);
}

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}

// 纯函数都在 server/lib 下（可单测），这里起别名保持调用点不变
const sha256hex = UTIL.sha256hex;
const safeEqual = UTIL.safeEqual;
const dayName = UTIL.dayName;
const fileDayTs = UTIL.fileDayTs;

function fileForTs(ts) {
  return path.join(DATA_DIR, dayName(ts) + '.jsonl');
}

function appendEntries(list) {
  if (!Array.isArray(list)) list = [list];
  list.forEach(function (entry) {
    const row = ENTRY.normalizeEntry(entry, crypto.randomBytes(8).toString('hex'), Date.now());
    if (!row) return;
    fs.appendFileSync(fileForTs(row.ts), JSON.stringify(row) + '\n');
  });
}

function dayFiles() {
  let names = [];
  try { names = fs.readdirSync(DATA_DIR); } catch (e) { return []; }
  return names
    .filter(function (n) { return /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n); })
    .sort();
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
        // 私密条目不进普通视图的来源列表，免得来源名就把私密的存在暴露了
        if (ENTRY.isPrivate(row)) return;
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
  const filter = ENTRY.normalizeFilter(opts, Date.now(), RETENTION_DAYS);
  const from = filter.from;
  const to = filter.to;
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
      if (!ENTRY.matchesFilter(row, filter)) continue;
      matched.push(row);
    }
  });

  return ENTRY.paginate(matched, opts.page, opts.size);
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

// 管理会话由统一登录服务签发，日志写入仍使用独立的服务令牌。
function isUnlocked(req) {
  return SHARED_SESSION.verify(SHARED_SESSION.cookieValue(req.headers.cookie), SHARED_SECRET) === 'admin';
}

function isIngestAllowed(req) {
  if (!INGEST_TOKEN) return true;
  const header = String(req.headers['x-log-token'] || req.headers.authorization || '');
  return safeEqual(header.replace(/^Bearer\s+/i, ''), INGEST_TOKEN);
}

function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  if (req.method === 'POST' && p !== '/api/v1/logs' && req.headers.origin &&
      req.headers.origin !== 'https://log.tykrem.top') {
    return sendJson(res, 403, { error: '请求来源无效' });
  }

  // 旧登录入口不再签发站点专用会话，避免绕过统一登录。
  if (req.method === 'POST' && p === '/api/unlock') {
    return sendJson(res, 410, { error: '请使用统一登录入口' });
  }

  if (req.method === 'POST' && p === '/api/lock') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': SHARED_SESSION.COOKIE_NAME + '=; Domain=tykrem.top; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0',
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'GET' && p === '/api/session') {
    const role = SHARED_SESSION.verify(SHARED_SESSION.cookieValue(req.headers.cookie), SHARED_SECRET);
    return sendJson(res, 200, { configured: !!SHARED_SECRET, unlocked: role === 'admin', role });
  }

  // ---- 私密条目：数据上仍然隔离（普通视图看不到），但不再需要二次解锁 ----
  if (p.indexOf('/api/private/') === 0) {
    if (!isUnlocked(req)) {
      return sendJson(res, 401, { error: '需要超级码' });
    }

    if (req.method === 'GET' && p === '/api/private/logs') {
      const params = url.searchParams;
      return sendJson(res, 200, queryLogs({
        source: params.get('source') || '',
        level: params.get('level') || '',
        q: params.get('q') || '',
        from: params.get('from') || '',
        to: params.get('to') || '',
        page: params.get('page') || '1',
        size: params.get('size') || '100',
        privacy: 'only',
      }));
    }

    if (req.method === 'POST' && p === '/api/private/note') {
      readBody(req).then(function (body) {
        const message = String(body.message || '').trim();
        if (!message) return sendJson(res, 400, { error: '内容不能为空' });
        appendEntries({
          source: String(body.source || 'private'),
          level: String(body.level || 'info'),
          message: message,
          meta: body.meta && typeof body.meta === 'object' ? body.meta : undefined,
          private: true,
        });
        sendJson(res, 201, { ok: true });
      }).catch(function (e) { sendJson(res, e.status || 400, { error: e.message }); });
      return;
    }

    return sendJson(res, 404, { error: '未找到接口' });
  }

  if (req.method === 'POST' && p === '/api/v1/logs') {
    if (!isIngestAllowed(req)) return sendJson(res, 401, { error: '无效的日志写入凭证' });
    readBody(req).then(function (body) {
      appendEntries(body);
      sendJson(res, 201, { ok: true });
    }).catch(function (e) { sendJson(res, e.status || 400, { error: e.message }); });
    return;
  }

  // 除了上面的写入接口，其余一律要超级码解锁后的会话
  if (!isUnlocked(req)) {
    return sendJson(res, 401, { error: '需要超级码' });
  }

  if (req.method === 'GET' && p === '/api/me') {
    return sendJson(res, 200, { role: 'super' });
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
      privacy: 'exclude',        // 普通视图永远不含私密条目
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

// 自己也往自己报一条「启动」：重启时间点在日志里能直接看到（走的是对外写入接口）。
function reportSelf(message, meta) {
  if (!INGEST_TOKEN) return;
  try {
    const body = JSON.stringify({ source: 'log-center', level: 'info', message: message, meta: meta || {} });
    const req = http.request({
      host: HOST,
      port: PORT,
      path: '/api/v1/logs',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Log-Token': INGEST_TOKEN,
      },
      timeout: 3000,
    }, function (res) { res.resume(); });
    req.on('error', function () {});
    req.on('timeout', function () { req.destroy(); });
    req.end(body);
  } catch (e) {}
}

server.listen(PORT, HOST, function () {
  console.log('log-center listening on http://' + HOST + ':' + PORT + ' retention=' + RETENTION_DAYS + 'd');
  reportSelf('日志中心启动', { port: PORT, retentionDays: RETENTION_DAYS, dataDir: DATA_DIR });
});
