# VLM Core

负责人：VLM 与 Prompt 开发者。

职责：

- Prompt 模板和版本管理。
- 大模型 Provider 适配。
- 参考动作与跟练动作的多模态分析。
- 将模型结果整理成稳定的教学纠错结构。
- 模型超时、重试、限流和错误映射。

API Key 只能通过后端环境变量读取，禁止出现在前端或提交到仓库。

其他模块只能从 `index.ts` 引用公开类型、Module 和 Service。
