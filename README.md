# stats-calendar

将[国家统计局主要统计信息发布日程](https://www.stats.gov.cn/sj/fbrc/index_fbrc.html)转换为 macOS 日历可订阅的 iCalendar feed。

## 订阅

部署后的地址：

```text
https://stats-calendar.guotang240.workers.dev/calendar.ics
```

在 macOS 日历中选择“文件”→“新建日历订阅”，粘贴该 HTTPS 地址并选择自动刷新频率。事件为全天事件，不包含强制提醒；可在日历客户端设置提醒。

日历包含上海时区当年和下一年度的全部发布明细，并保留当年已过去的事件。发布日期可能调整，以事件内链接指向的国家统计局页面为准。

## HTTP 接口

- `GET /calendar.ics`：返回 `text/calendar; charset=utf-8`。
- `HEAD /calendar.ics`：只返回响应头。
- `GET /`：重定向到 `/calendar.ics`。
- 成功响应在 Cloudflare 边缘缓存 6 小时，并支持 `ETag`/`If-None-Match`。
- 上游不可用或数据校验失败时返回 `502`，不会发布空日历。

## 本地开发

需要 Node.js 24 和 npm 11。

```bash
npm ci --ignore-scripts
npm test
npm run typecheck
npm run verify:source
npm run deploy:dry-run
npm run dev
```

Wrangler 本地服务启动后访问 `http://localhost:8787/calendar.ics`。

## 部署

公开仓库的 `master` 分支更新后，[GitHub Actions](.github/workflows/ci.yml)会先运行测试、类型检查、依赖审计、真实源验证和 Worker dry-run，全部通过后再部署。

在 GitHub 仓库的 Actions secrets 中配置：

- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 账户 ID。
- `CLOUDFLARE_API_TOKEN`：使用“Edit Cloudflare Workers”模板创建的最小权限令牌。

令牌不得写入代码、Wrangler 配置或提交历史。部署方式遵循 [Cloudflare 官方 GitHub Actions 文档](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)。

## 数据处理

统计局列表当前以 `text/html` 返回近似 JSON，并带一个尾逗号。本项目只修复这个已知格式问题，然后严格验证目标年度日期、标题和 `stats.gov.cn` 详情链接。输出遵循 RFC 5545 的 CRLF、文本转义和 UTF-8 75 字节折行要求。
