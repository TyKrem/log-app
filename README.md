# log-app

轻量级日志中心：多个服务往这里上报日志，一个网页统一查询。
不依赖数据库，日志按天落盘，默认保留 30 天。

## 特性

- **多来源聚合**：按 `source` 自动分组，新来源无需改配置
- **网页查询**：按来源、级别、关键字、时间范围过滤与分页
- **写入与查询分离**：写入用 `LOG_INGEST_TOKEN`，后台用管理员码登录
- **自动清理**：超过保留天数的日志自动删除，并记录清理动作
- **零依赖存储**：JSONL 文件，直接 `grep` 也能查

## 架构

```
业务服务 ── POST /api/v1/logs (X-Log-Token) ──┐
                                              ▼
                                        log-center ──> 按天 JSONL
                                              ▲
   浏览器 ── 管理员码登录 ── 查询 ────────────┘
```

## 快速开始

```bash
git clone git@github.com:TyKrem/log-app.git
cd log-app

mkdir -p /etc
cat > /etc/log-app.env <<'EOF'
LOG_PORT=8792
LOG_HOST=127.0.0.1
LOG_ADMIN_CODE=换成你的管理码
LOG_INGEST_TOKEN=换成你的写入令牌
LOG_SESSION_SECRET=换成随机字符串
LOG_DATA_DIR=/opt/log-app/data
LOG_RETENTION_DAYS=30
EOF
chmod 600 /etc/log-app.env

cp -a deploy/log.service /etc/systemd/system/log-center.service
systemctl daemon-reload
systemctl enable --now log-center
```

站点配置参考 `deploy/nginx.log.http.conf`（先跑 HTTP 签证书）与
`deploy/nginx.log.conf`（HTTPS）。

## 写入日志

```bash
curl -X POST http://127.0.0.1:8792/api/v1/logs \
  -H "Content-Type: application/json" \
  -H "X-Log-Token: <LOG_INGEST_TOKEN>" \
  -d '{
    "source": "my-service",
    "level": "info",
    "message": "收到请求",
    "meta": {"path": "/api/x"}
  }'
```

字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `source` | 是 | 来源名，会出现在来源列表里 |
| `message` | 是 | 日志正文 |
| `level` | 否 | `debug` / `info` / `warn` / `error`，默认 `info` |
| `ts` | 否 | 毫秒时间戳，默认取服务端当前时间 |
| `meta` | 否 | 任意对象，随日志一起存 |

请求体也可以是一个数组，一次提交多条。

## 查询接口

需要管理员登录（`POST /api/login`，body `{"code":"<LOG_ADMIN_CODE>"}` 换取 Cookie）：

```bash
curl -b cookie.txt "http://127.0.0.1:8792/api/v1/logs?source=my-service&level=error&size=50"
curl -b cookie.txt "http://127.0.0.1:8792/api/v1/sources"
```

支持的查询参数：`source`、`level`、`q`（关键字）、`from` / `to`（时间）、`page`、`size`。

## 配置项

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LOG_PORT` | `8792` | 监听端口 |
| `LOG_HOST` | `127.0.0.1` | 监听地址 |
| `LOG_ADMIN_CODE` | — | 后台登录码，必填 |
| `LOG_INGEST_TOKEN` | — | 写入令牌，必填 |
| `LOG_SESSION_SECRET` | 随机 | 登录 Cookie 签名密钥 |
| `LOG_DATA_DIR` | `/opt/log-app/data` | 日志存储目录 |
| `LOG_RETENTION_DAYS` | `30` | 保留天数 |

## License

[MIT](LICENSE)
