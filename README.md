# XuenWu Health

多模态健康问诊系统，包含 React 前端、Express 后端、MySQL 数据库、JWT 认证、结构化文本问诊、风险分级、图片上传和健康档案。

项目同时提供 Taro React 微信小程序客户端，与Web端共用Express、MySQL和DeepSeek服务。

## 当前能力

- 用户登录、健康档案和健康指标
- DeepSeek 真实文本问诊
- 症状、追问、风险、建议科室和医生摘要结构化输出
- 连续追问及回答状态自动关联
- 分步症状自查向导，可生成规范症状描述并进入AI问诊
- 普通、儿童、老人三种问诊模式
- 中文和中英双语问诊回复
- 问诊结果打印，便于线下就医时提供信息
- 图片问诊开发中提示和真实错误状态提示
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
- 微信账号映射迁移：`database/migrations/003_wechat_accounts.sql`

## 微信小程序

原生微信小程序源码位于 `miniprogram/native/`，包含登录、首页、智能问诊、症状自查、儿童/老人模式、健康档案和问诊历史。图片问诊入口当前只显示“功能正在开发中”，不会选择或上传用户图片。

图片问诊开发提示演示：登录后进入智能问诊，点击“图片问诊（开发中）”。Web 端会显示页面通知，小程序会显示 Toast；两端均不会打开图片选择器或上传图片。

```powershell
npm run miniprogram:install
npm run miniprogram:build
```

在微信开发者工具中导入 `miniprogram/native/` 目录。当前 `project.config.json` 使用 `touristappid` 供本地开发，取得正式小程序AppID后替换该值，并在服务端 `.env` 配置 `WECHAT_APP_ID` 和 `WECHAT_APP_SECRET`。

开发者工具本地测试需要关闭合法域名校验；真机与正式发布必须将后端部署到HTTPS域名，并配置小程序的 `request`、`uploadFile` 和 `downloadFile` 合法域名。

## 安全说明

系统用于健康咨询、信息整理和风险提示，不替代医生诊断。`.env`、上传文件和构建产物不会提交到 Git。

## 开发日志

参见 [CHANGELOG.md](CHANGELOG.md)。
