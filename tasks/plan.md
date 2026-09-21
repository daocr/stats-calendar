# Implementation Plan: 国家统计局日历订阅源

## Architecture Decisions

- Cloudflare Worker 动态抓取固定国家统计局 URL，输出单一公开 ICS 资源。
- 转换逻辑保持纯函数，HTTP、缓存和日志留在 Worker 边界。
- 使用 Cloudflare Cache API 缓存成功响应六小时，不缓存失败。

## Task List

1. 建立数据解析和 ICS 生成核心，并以单元测试覆盖。
2. 实现 Worker HTTP、缓存、错误和条件请求契约。
3. 增加 CI/CD、文档和真实数据验证。
4. 创建 GitHub 仓库、配置 Secrets、合并并部署。

## Risks and Mitigations

- 上游返回带尾逗号的非标准 JSON：只修复已确认的单个尾逗号，其余异常拒绝。
- 上游字段污染 ICS：严格校验 URL、日期和长度，并进行 RFC 5545 转义与折行。
- 上游暂时失败：优先使用边缘缓存，未命中时降级到随 Worker 发布的已验证快照。
