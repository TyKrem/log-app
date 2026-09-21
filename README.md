# log-app

轻量级日志中心：多个服务往这里上报日志，一个网页统一查询。
不依赖数据库，日志按天落盘，默认保留 30 天。

## 特性

- **多来源聚合**：按 `source` 自动分组，新来源无需改配置
- **网页查询**：按来源、级别、关键字、时间范围过滤与分页
- **写入与查询分离**：写入用 `LOG_INGEST_TOKEN`（服务间调用）；查询要超级码
- **整站超级码**：没有码连日志列表都看不到，解锁一次管 12 小时
- **私密条目**：标了 `private` 的条目在普通视图与来源列表里都看不到，切到「私密条目」才显示
- **自动清理**：超过保留天数的日志自动删除，并记录清理动作
- **零依赖存储**：JSONL 文件，直接 `grep` 也能查

## 架构

```
业务服务 ── POST /api/v1/logs (X-Log-Token) ──┐
                                              ▼
                                        log-center ──> 按天 JSONL
                                              ▲
   浏览器 ── 超级码换 Cookie ── 查询 ─────────┘
```

## 快速开始

```bash
git clone git@github.com:TyKrem/log-app.git
cd log-app

mkdir -p /etc
cat > /etc/log-app.env <<'EOF'
LOG_PORT=8792
LOG_HOST=127.0.0.1
LOG_INGEST_TOKEN=换成你的写入令牌
LOG_SESSION_SECRET=换成随机字符串
LOG_DATA_DIR=/opt/log-app/data
LOG_RETENTION_DAYS=30
EOF
chmod 600 /etc/log-app.env

# 超级码默认读这台机器的 /etc/super-code.env（SUPER_CODE）；
# 想单独指定就加一行 LOG_SUPER_CODE=...

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

## 解锁与私密条目

整站只有一把钥匙：**超级码**。`POST /api/unlock` 换取 12 小时有效的签名 Cookie，
之后查日志、看来源、写私密记录都不用再输码；点「锁定」立刻失效。

- 超级码：`LOG_SUPER_CODE`，不设置时回退读 `/etc/super-code.env` 的 `SUPER_CODE`
  （本机的约定是与文件服务、监控页共用同一个超级码）
- 换超级码 = 所有已下发的 Cookie 立即失效（签名密钥就是超级码加上会话密钥）

私密条目在数据上仍然隔离：存储里带 `private: true`，
普通视图（`/api/v1/logs`）与来源列表（`/api/v1/sources`）都看不到它们，
只有页面右上角「🔒 私密条目」里的 `/api/private/logs` 能查到。
它不再是第二套凭证——解锁整站之后直接就能看。两种写入方式：

1. 直接在私密条目页面里写（走 `/api/private/note`）；
2. 服务上报时在请求体里加 `"private": true`（走 `/api/v1/logs` 与写入令牌）。

渲染时对内容做 HTML 转义，所以私密记录里贴代码也安全。

## 查询接口

需要先解锁（`POST /api/unlock`，body `{"code":"<超级码>"}` 换取 Cookie）：

```bash
curl -c cookie.txt -X POST -H 'Content-Type: application/json' \
  -d '{"code":"<超级码>"}' http://127.0.0.1:8792/api/unlock
curl -b cookie.txt "http://127.0.0.1:8792/api/v1/logs?source=my-service&level=error&size=50"
curl -b cookie.txt "http://127.0.0.1:8792/api/v1/sources"
```

支持的查询参数：`source`、`level`、`q`（关键字）、`from` / `to`（时间）、`page`、`size`。

## 配置项

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LOG_PORT` | `8792` | 监听端口 |
| `LOG_HOST` | `127.0.0.1` | 监听地址 |
| `LOG_INGEST_TOKEN` | — | 写入令牌，必填 |
| `LOG_SESSION_SECRET` | 随机 | 登录 Cookie 签名密钥 |
| `LOG_SUPER_CODE` | 见下 | 整站超级码；不设置时回退读 `/etc/super-code.env` 的 `SUPER_CODE` |
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
