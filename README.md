# log-app

轻量级日志中心：多个服务往这里上报日志，一个网页统一查询。
不依赖数据库，日志按天落盘，默认保留 30 天。

## 特性

- **多来源聚合**：按 `source` 自动分组，新来源无需改配置
- **网页查询**：按来源、级别、关键字、时间范围过滤与分页；电脑与手机均可使用，元数据按需展开，私密浮层支持 Escape 关闭
- **页面风格**：明亮蓝色、白色卡片与高对比文字，随系统切换深色模式
- **写入与查询分离**：写入用 `LOG_INGEST_TOKEN`（服务间调用）；查询要统一登录的管理会话
- **统一登录**：未登录看不到日志，会话有效期 7 天
- **私密条目**：标了 `private` 的条目在普通视图与来源列表里都看不到，切到「私密条目」才显示
- **自动清理**：超过保留天数的日志自动删除，并记录清理动作
- **零依赖存储**：JSONL 文件，直接 `grep` 也能查

## 架构

```
业务服务 ── POST /api/v1/logs (X-Log-Token) ──┐
                                              ▼
                                        log-center ──> 按天 JSONL
                                              ▲
   浏览器 ── 统一登录 Cookie ── 查询 ───────┘
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
LOG_DATA_DIR=/opt/log-app/data
LOG_RETENTION_DAYS=30
EOF
chmod 600 /etc/log-app.env

# 另需 /etc/auth-session.env，见 auth-app/README.md。

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

## 登录与私密条目

先到 `https://tykrem.top/auth/` 使用管理码登录；日志站只验证共享会话，不接受只读会话。旧 `POST /api/unlock` 返回 410。点「锁定」会退出所有共用会话的站点。

私密条目在数据上仍然隔离：存储里带 `private: true`，
普通视图（`/api/v1/logs`）与来源列表（`/api/v1/sources`）都看不到它们，
只有页面右上角「🔒 私密条目」里的 `/api/private/logs` 能查到。
它不再是第二套凭证——登录之后直接就能看。两种写入方式：

1. 直接在私密条目页面里写（走 `/api/private/note`）；
2. 服务上报时在请求体里加 `"private": true`（走 `/api/v1/logs` 与写入令牌）。

渲染时对内容做 HTML 转义，所以私密记录里贴代码也安全。

## 查询接口

需要先在统一登录入口登录，之后携带 `tykrem_session` Cookie：

```bash
curl -b 'tykrem_session=<从浏览器会话取出的令牌>' \
  "http://127.0.0.1:8792/api/v1/logs?source=my-service&level=error&size=50"
```

支持的查询参数：`source`、`level`、`q`（关键字）、`from` / `to`（时间）、`page`、`size`。

## 配置项

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LOG_PORT` | `8792` | 监听端口 |
| `LOG_HOST` | `127.0.0.1` | 监听地址 |
| `LOG_INGEST_TOKEN` | — | 写入令牌，必填 |
| `AUTH_SESSION_SECRET` | — | 统一会话签名密钥，由 systemd 从 `/etc/auth-session.env` 注入 |
| `LOG_DATA_DIR` | `/opt/log-app/data` | 日志存储目录 |
| `LOG_RETENTION_DAYS` | `30` | 保留天数 |

## License

[MIT](LICENSE)
## 测试

```bash
node --test test/        # 需要 Node 16.17+（node:test 是内置的，没加依赖）
```

覆盖 `server/lib/` 下的纯函数：统一会话签发与校验（含篡改、过期）、Cookie 解析、
日志条目校验与查询过滤、分页边界。这个项目本身零依赖、没有 package.json，
所以测试也走原生命令，不引入 npm。
