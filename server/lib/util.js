'use strict';

const crypto = require('crypto');

// 通用小工具。全是纯函数，从 server.js 抽出来便于单测。

function sha256hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

// 先各自 sha256 再定时比较，避免按长度或内容提前返回
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// 日志按天分文件，文件名就是本地日期
function dayName(ts) {
  const d = new Date(ts || Date.now());
  const p = function (n) { return n < 10 ? '0' + n : '' + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// 文件名 → 该天 00:00 UTC 的时间戳（用于按天比较先后）
function fileDayTs(name) {
  return Date.parse(String(name).slice(0, 10) + 'T00:00:00Z');
}

module.exports = {
  sha256hex: sha256hex,
  safeEqual: safeEqual,
  dayName: dayName,
  fileDayTs: fileDayTs,
};
