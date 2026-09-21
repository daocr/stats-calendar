# Spec: 国家统计局 macOS 日历订阅源

## Objective

提供公开、稳定、可自动更新的 iCalendar 地址，将国家统计局主要统计信息发布日程订阅到 macOS 日历。

## Tech Stack

- Cloudflare Worker + TypeScript
- Wrangler 4
- Vitest 5
- GitHub Actions 部署

## Commands

- 安装：`npm ci`
- 测试：`npm test`
- 类型检查：`npm run typecheck`
- 部署预检：`npm run deploy:dry-run`
- 本地运行：`npm run dev`
- 部署：`npm run deploy`

## Project Structure

- `src/`：数据解析、ICS 生成和 Worker 请求处理
- `test/`：单元和接口测试
- `.github/workflows/`：PR 检查及生产部署
- `tasks/`：实施计划和进度

## Code Style

使用严格 TypeScript、显式边界类型和纯函数；第三方响应只在入口校验一次，内部只接收已验证数据。

## Testing Strategy

纯数据转换使用单元测试，Worker 路由使用注入式 fetch/cache 测试；发布前运行测试、类型检查、Wrangler dry-run、依赖审计和真实源数据烟雾测试。

## Boundaries

- Always：校验外部数据、保持 UID 稳定、使用 CRLF 和 UTF-8 字节折行、只通过 Secrets 使用部署凭据。
- Ask first：增加筛选、提醒、精确发布时间、自定义域名。
- Never：提交令牌、使用 `eval`、接受非 `stats.gov.cn` 事件链接、在上游异常时发布空日历。

## Success Criteria

- `GET/HEAD /calendar.ics` 返回可被 macOS 日历订阅的全天事件日历。
- 只包含上海时区当年和下一年的发布明细，汇总日程表被排除。
- 成功响应缓存六小时；异常返回通用错误且不缓存。
- GitHub PR 自动验证，`master` 更新自动部署 Cloudflare Worker。
