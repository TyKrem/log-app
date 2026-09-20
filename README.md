# log-app

轻量级日志中心：多个服务往这里上报日志，一个网页统一查询。
不依赖数据库，日志按天落盘，默认保留 30 天。

## 特性

- **多来源聚合**：按 `source` 自动分组，新来源无需改配置
- **网页查询**：按来源、级别、关键字、时间范围过滤与分页
- **写入与查询分离**：写入用 `LOG_INGEST_TOKEN`，后台用管理员码登录
- **私密区域**：用超级码解锁的独立区域，里面的条目在普通视图与来源列表里都看不到
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

## 私密区域

页面右上角的「🔒 私密区域」用**超级码**解锁（和后台访问码是两套凭证，
超级码解锁后也进不了普通后台，反过来也一样）：

- 访问码：`LOG_PRIVATE_CODE`；不设置时回退读 `/etc/codex-chat.env` 的 `CHAT_SUPER_CODE`
  （本机的约定是「私密区域」与「监控页解锁循环任务」共用同一个超级码）
- 里面的条目在存储上带 `private: true`：普通视图（`/api/v1/logs`）与来源列表
  （`/api/v1/sources`）都看不到它们，只有私密区域（`/api/private/logs`）能查到
- 两种写入方式：
  1. 直接在私密区域页面里写（走 `/api/private/note`，需要解锁）；
  2. 服务上报时在请求体里加 `"private": true`（走原来的 `/api/v1/logs` 与写入令牌）

解锁状态放在单独的 `log_private` Cookie 里，有效期和管理员登录一致（12 小时）；
点「锁定」或退出登录都会清掉。渲染时对内容做 HTML 转义，所以私密记录里贴代码也安全。

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
| `LOG_PRIVATE_CODE` | 见下 | 私密区域访问码；不设置时回退读 `/etc/codex-chat.env` 的 `CHAT_SUPER_CODE` |
| `LOG_DATA_DIR` | `/opt/log-app/data` | 日志存储目录 |
| `LOG_RETENTION_DAYS` | `30` | 保留天数 |

## License

[MIT](LICENSE)
## 测试

```bash
node --test test/        # 需要 Node 16.17+（node:test 是内置的，没加依赖）
```

覆盖 `server/lib/` 下的纯函数：令牌签发与校验（含各种篡改路径）、Cookie 解析、
日志条目校验与查询过滤、分页边界。这个项目本身零依赖、没有 package.json，
所以测试也走原生命令，不引入 npm。
