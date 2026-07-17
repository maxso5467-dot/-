# XuenWu Health

多模态健康问诊系统，包含 React 前端、Express 后端、MySQL 数据库、JWT 认证、结构化文本问诊、风险分级、图片上传和健康档案。

## 当前能力

- 用户登录、健康档案和健康指标
- DeepSeek 真实文本问诊
- 症状、追问、风险、建议科室和医生摘要结构化输出
- 连续追问及回答状态自动关联
- 图片上传和真实错误状态提示
- 问诊历史、模型调用日志和高风险列表

## 本地启动

1. 复制 `.env.example` 为 `.env` 并填写 DeepSeek API Key。
2. 确认 MySQL 数据库 `multimodal_health_consultation` 已创建。
3. 执行 `build-and-start.bat`，或运行 `npm run serve`。
4. 打开 `http://localhost:8080`。

演示账号：`zhangsan / 123456`。

## 数据库

- 完整建库及种子数据：`health_consultation_schema_seed.sql`
- 结构化问诊增量迁移：`database/migrations/002_structured_consultation.sql`

## 安全说明

系统用于健康咨询、信息整理和风险提示，不替代医生诊断。`.env`、上传文件和构建产物不会提交到 Git。

## 开发日志

参见 [CHANGELOG.md](CHANGELOG.md)。
