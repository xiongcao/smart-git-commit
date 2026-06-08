# 代码审查 Webhook 部署指南

## 概述

通过 Cloudflare Workers（免费 Serverless）+ AI API，在 GitHub/Gitee/GitLab 平台实现 **PR/MR 创建时自动代码审查**。

- **成本**：免费（Cloudflare Workers 免费额度每天 10 万次请求）
- **部署**：一次部署，三个平台通用
- **无需自有服务器**

---

## 工作原理

整个系统通过 **Webhook + 平台 API** 串联起来，核心流程如下：

```
1. 开发者创建 PR/MR（如 GitHub Pull Request）
        │
2. 代码平台检测到 PR 事件，自动向配置的 Webhook URL 发送 HTTP POST 请求
   （请求中包含 PR 的标题、源分支、目标分支、仓库信息等 JSON 数据）
        │
3. Cloudflare Worker 收到请求，根据请求头识别平台类型
   （X-GitHub-Event → GitHub, X-Gitlab-Event → GitLab, X-Gitee-Event → Gitee）
        │
4. Worker 通过平台的 REST API 获取 PR 的代码 diff（差异内容）
   - GitHub: GET /repos/{owner}/{repo}/pulls/{pr}  (Accept: diff)
   - GitLab: GET /projects/{id}/merge_requests/{mr}/changes
   - Gitee:  GET /repos/{owner}/{repo}/pulls/{pr}
   ⚠️ 认证方式：使用 Personal Access Token 作为 Bearer Token
        │
5. Worker 将 diff 内容发送给 AI（通义千问/OpenAI）进行代码审查
   ⚠️ 认证方式：使用 AI API Key 作为 Bearer Token
        │
6. AI 返回审查报告（含评分和代码修改建议）
        │
7. Worker 通过平台的 REST API 将报告发布为 PR/MR 评论
   - GitHub: POST /repos/{owner}/{repo}/issues/{pr}/comments
   - GitLab: POST /projects/{id}/merge_requests/{mr}/notes
   - Gitee:  POST /repos/{owner}/{repo}/pulls/{pr}/comments
   ⚠️ 认证方式：使用 Personal Access Token 作为 Bearer Token
```

### 关键概念

| 概念 | 作用 | 类比 |
|------|------|------|
| **Webhook** | 代码平台和 Cloudflare 之间的**桥梁**。平台在 PR 事件发生时，主动向 Worker URL 发 HTTP 请求，通知"有 PR 需要审查" | 像快递到货时的短信通知 |
| **Cloudflare Worker** | 运行在 Cloudflare 服务器上的 JS 代码，**接收 Webhook → 获取代码 → 调 AI → 发评论**，是整个流程的大脑 | 像 24 小时值班的机器人 |
| **平台 REST API** | Worker 通过它**获取代码 diff**（读操作）和**发布评论**（写操作） | 像机器人操控平台的手和嘴 |
| **Personal Access Token** | 平台的"密码替身"，Worker 用它调用 API 时证明身份 | 像机器人的工牌，刷卡才能进门 |

### 数据流示意图

```
┌──────────────┐    Webhook (POST JSON)    ┌──────────────────┐
│  GitHub/Gitee │ ─────────────────────────→│ Cloudflare Worker│
│  /GitLab      │                           │                  │
│               │←─────────────────────────│  (免费托管)       │
│               │   获取 diff (GET API)      │                  │
│               │                           │        │         │
│               │←─────────────────────────│        │ 调 AI   │
│               │   发布评论 (POST API)      │        ↓         │
└──────────────┘                           │  通义千问/OpenAI  │
                                            └──────────────────┘
```

---

## 前置准备

| 准备项 | 说明 |
|--------|------|
| Cloudflare 账号 | 去 [cloudflare.com](https://cloudflare.com) 注册（免费，支持 GitHub/邮箱登录） |
| AI API Key | 通义千问（[阿里云百炼](https://bailian.console.aliyun.com/)）或 OpenAI 的 Key |
| 平台 Token | GitHub/Gitee/GitLab 的 Personal Access Token（用于发评论） |

---

## 第一步：安装 Wrangler CLI

Wrangler 是 Cloudflare 的部署工具：

```bash
npm install -g wrangler
```

---

## 第二步：登录 Cloudflare

```bash
wrangler login
```

会打开浏览器跳转到 Cloudflare 授权页面，点击 **Allow** 授权。

> 授权后会跳转到 `http://localhost:8976` 页面打不开，这是**正常现象**。回到终端看到 `Successfully logged in.` 即可。

---

## 第三步：设置 AI API Key

进入项目目录：

```bash
cd workers
```

选择一个 AI 服务设置密钥：

```bash
# 通义千问（推荐，国内访问快）
wrangler secret put DASHSCOPE_API_KEY --name git-review-bot

# 或 OpenAI
wrangler secret put OPENAI_API_KEY --name git-review-bot
```

输入 Key 后回车（输入时不显示字符，正常现象）。

---

## 第四步：设置平台 Token

### GitHub Token 获取

1. 打开 [GitHub Token 页面](https://github.com/settings/tokens)
2. 点击 **Generate new token (classic)**
3. 勾选 **repo** 权限（只需这一个）
4. 生成后复制 Token

### Gitee Token 获取

1. 打开 [Gitee 私人令牌](https://gitee.com/profile/personal_access_tokens)
2. 生成新令牌，勾选 **pull_requests** 权限

### GitLab Token 获取

1. Settings → Access Tokens
2. 勾选 **api** 权限

### 设置 Token

```bash
# GitHub
wrangler secret put GITHUB_TOKEN --name git-review-bot

# Gitee
wrangler secret put GITEE_TOKEN --name git-review-bot

# GitLab
wrangler secret put GITLAB_TOKEN --name git-review-bot
```

> 可以三个都设置，Worker 会自动根据 Webhook 来源选择对应 Token。没有的按回车跳过即可。

---

## 第五步：部署 Worker

```bash
wrangler deploy
```

首次部署会提示注册 `workers.dev` 子域名：
- 输入 **Y** 确认
- 输入你想要的子域名（如 `xiongchao`）
- 部署完成后获得 URL：`https://git-review-bot.<子域名>.workers.dev`

---

## 第六步：配置 Webhook

### GitHub

1. 打开你的 GitHub 仓库
2. **Settings** → **Webhooks** → **Add webhook**
3. 填写：
   - **Payload URL**：`https://git-review-bot.<子域名>.workers.dev`
   - **Content type**：`application/json`
   - **Which events**：选 `Let me select individual events`，只勾 **Pull requests**
4. 点击 **Add webhook**

### Gitee

1. 仓库 → **管理** → **Webhooks**
2. URL 填 Worker 地址
3. 勾选 **合并请求** 事件

### GitLab

1. 仓库 → **Settings** → **Webhooks**
2. URL 填 Worker 地址
3. 勾选 **Merge request events**

---

## 验证

在你的仓库创建一个测试 PR/MR，几秒后 AI 会自动在评论区给出审查建议，包含：

- 评分（0-10分）：🔴 严重 / 🟡 一般 / 💡 优化建议
- 具体代码修改建议（`+` 新增、`-` 删除、`=` 上下文）
- 问题原因分析

---

## 本地使用

除了平台自动审查，也可以在本地手动审查：

```bash
# 审查当前分支相对于 main 的变更
sgc review main

# 审查指定分支
sgc review feature-branch --target main
```

---

## 常见问题

### Q: 授权后跳转 localhost:8976 打不开？

这是正常的。这个端口是 wrangler CLI 在本地监听的，用来接收 Cloudflare 返回的 token。回到终端看到 `Successfully logged in.` 即可。

### Q: 为什么要安装 wrangler？

Wrangler 是用来将代码部署到 Cloudflare Workers 的工具，相当于"上传部署工具"。没有它就需要手动在网页后台操作。

### Q: 可以同时支持多个平台吗？

可以。只需设置对应平台的 Token，然后在各平台的仓库中配置同一个 Webhook URL。Worker 会根据请求头自动识别来源平台。

### Q: 需要付费吗？

不需要。Cloudflare Workers 免费额度每天 10 万次请求，个人项目完全够用。AI API 按调用量计费（通义千问有免费额度）。

### Q: 部署后修改代码怎么办？

修改 `workers/review-webhook.js` 后，进入 `workers` 目录重新部署：

```bash
cd workers
wrangler deploy
```

### Q: Webhook URL 必须用 Cloudflare Workers 吗？

不是。**Webhook URL 可以是任何公网可访问的 HTTP(S) 地址**，只要该地址能接收 POST 请求即可。替代方案包括：

| 方案 | 说明 |
|------|------|
| 自己服务器 | 部署到自己的 VPS/云服务器，用 Express/Koa 启动服务 |
| Vercel Functions | 类似的免费 Serverless 平台 |
| GitHub Actions | 不需要外部 URL，直接用 Actions 监听 `pull_request` 事件 |

本质上，Webhook 只是代码平台向一个 URL 发 POST 请求，你只需在那个 URL 后面运行一段能处理请求的代码。

### Q: Cloudflare Workers 是不是相当于免费后端？

是的。Cloudflare Workers 就是一个**免费的 Serverless 后端平台**。你可以：

- 部署 API 接口，前端通过 `fetch` 调用
- 接收 Webhook 通知，自动处理业务
- 做代理转发、图片处理、表单提交等

类比传统后端：

| | Cloudflare Workers | 传统服务器 |
|---|---|---|
| 费用 | 免费（10万次/天） | 每月几十到几百块 |
| 部署 | `wrangler deploy` 一行命令 | 配置 Nginx、SSL、域名 |
| 扩展性 | 自动弹性伸缩 | 需手动配置 |

### Q: 一个 Worker 能处理多个接口吗？

可以。所有请求都打到同一个 Worker URL，在代码里根据 `pathname` 分发：

```js
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/webhook/review') {
      // 代码审查 webhook
      return handleReview(request, env);
    }

    if (url.pathname === '/api/users') {
      // 用户接口
      return new Response(JSON.stringify([{ name: '张三' }]));
    }

    return new Response('Not Found', { status: 404 });
  }
};
```

调用：

```
https://git-review-bot.xiongchao.workers.dev/webhook/review
https://git-review-bot.xiongchao.workers.dev/api/users
```
