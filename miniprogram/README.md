# XuenWu Health 微信小程序

## 开发运行

```powershell
npm install
npm run build:weapp
```

使用微信开发者工具导入当前 `miniprogram/` 目录。项目配置会从 `dist/` 读取编译产物。

开发环境默认请求：

```text
http://127.0.0.1:8080/api/v1
```

请先启动仓库根目录的Express服务，并在微信开发者工具中关闭“校验合法域名、web-view（业务域名）、TLS版本以及HTTPS证书”。该设置仅用于本地开发。

## 正式发布

1. 将 `project.config.json` 中的 `touristappid` 替换为正式AppID。
2. 在后端 `.env` 配置 `WECHAT_APP_ID` 和 `WECHAT_APP_SECRET`。
3. 将API部署至HTTPS域名。
4. 构建时设置 `TARO_APP_API_BASE` 为正式API地址。
5. 在微信小程序后台配置request、uploadFile和downloadFile合法域名。
6. 完成隐私保护指引、服务类目和小程序备案。

AppSecret、DeepSeek API Key和JWT密钥禁止写入小程序源码。
