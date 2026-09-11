# 日志中心（log.tykrem.top）

统一日志收集 / 查询服务，为多个来源保留统一入口，默认保留 30 天。

## 当前来源

- `feishu-bot`：飞书 → Codex 中转日志（原 `qq-bot` 已下线）
- `log-center`：日志中心自身的清理记录
- 后续接入：任意服务按下面 API 上报即可自动出现在来源列表中

## 日志写入 API

```bash
curl -X POST http://127.0.0.1:8792/api/v1/logs \
  -H "Content-Type: application/json" \
  -H "X-Log-Token: <LOG_INGEST_TOKEN>" \
  -d '{
    "source": "feishu-bot",
    "level": "info",
    "message": "收到消息",
    "meta": {"openId": "ou_xxxx"}
  }'
```

字段：`source`（必填）、`message`（必填）、`level`（debug/info/warn/error）、`ts`（毫秒，可省略）、`meta`（对象，可省略）。也支持一次提交数组。

## 目录

| 路径 | 说明 |
| --- | --- |
| `/root/log-app` | 源码 |
| `/opt/log-app` | 运行目录 |
| `/etc/log-app.env` | 配置（管理员码、写入 Token、会话密钥） |
| `/etc/nginx/conf.d/log.tykrem.top.conf` | 站点配置 |

## 维护

```bash
systemctl status log-center
systemctl restart log-center
journalctl -u log-center -f
```

同步：

```bash
cp -a /root/log-app/public/. /opt/log-app/public/
cp /root/log-app/server/server.js /opt/log-app/server/server.js
systemctl restart log-center
```

## License

MIT
