# 开发与实现细节

## 目录

- [开发与发布](#开发与发布)
- [sgc --ai 实现流程](#sgc---ai-实现流程)
- [sgc push 实现流程](#sgc-push-实现流程)

---

## 开发与发布

### 发布到 npm

```bash
# 1. 更新版本号（修改 package.json 中的 version 字段）
# 2. 登录 npm（仅首次需要）
npm login --registry https://registry.npmjs.org

# 3. 发布
npm publish --access public --registry https://registry.npmjs.org

# 4. 如果开启了 OTP 两步验证，需要带上验证码
npm publish --access public --registry https://registry.npmjs.org --otp=<验证码>
```

### 更新 sgc

发布新版本后，用户执行以下命令更新：

```bash
npm update -g @xiongcao/smart-git-commit
```

或重新安装：

```bash
npm install -g @xiongcao/smart-git-commit
```

### 部署 Webhook Worker

修改 `workers/review-webhook.js` 后，重新部署：

```bash
cd workers
wrangler deploy
```

---

## sgc --ai 实现流程

`sgc --ai` 使用 AI 大模型分析代码变更，生成更智能的 commit message。兼容 OpenAI 接口协议，支持 OpenAI、阿里通义千问、DeepSeek 等。

### 整体流程

```
用户执行 sgc --ai
    │
    ▼
index.js → 解析 args，识别到 --ai
    │
    ▼
handleCommit(args)
    │
    ├── 1. 检查 Git 仓库和工作区状态
    │       getRepoRoot() → getCurrentBranch()
    │       getStagedFiles() / getUnstagedFiles() / getUntrackedFiles()
    │
    ├── 2. 如果暂存区为空，提示用户 git add -A
    │
    ├── 3. 显示暂存文件列表和变更统计
    │       getStagedDiff()
    │
    ├── 4. 获取完整 diff 内容
    │       getStagedDiffDetail()
    │
    ├── 5. 检测到 --ai 标志 → 走 AI 生成路径
    │       │
    │       ├── 检查 API Key（优先级：配置文件 > 环境变量）
    │       │      config.apiKey → OPENAI_API_KEY → DASHSCOPE_API_KEY 等
    │       │
    │       ├── 无 Key → 提示用户输入，或降级为规则生成
    │       │
    │       └── 有 Key → generateAICommitMessage(diffDetail, files, branch)
    │              │
    │              ├── 5a. 构建请求体
    │              │       model: config.aiModel（如 qwen-turbo）
    │              │       system prompt: 定义 Conventional Commits 格式要求
    │              │       user prompt: 当前分支 + diff 内容（截断到 16000 字符）
    │              │       temperature: 0.3（保证输出稳定一致）
    │              │
    │              ├── 5b. 发送 HTTPS POST 请求
    │              │       POST {config.aiBaseUrl}/chat/completions
    │              │       Authorization: Bearer {apiKey}
    │              │
    │              ├── 5c. 解析响应
    │              │       response.choices[0].message.content
    │              │
    │              └── 5d. 失败 → 返回 null，降级为规则生成
    │
    ├── 6. 如果 AI 未生成或失败 → 回退规则引擎
    │       generateCommitMessage(stagedFiles, diffStat)
    │       │
    │       ├── detectCommitType()  → 正则匹配 typeRules 推断 type
    │       ├── generateScope()     → 文件路径公共前缀提取 scope
    │       ├── analyzeFileDiff()   → 逐文件分析 diff 生成业务描述
    │       ├── generateSummary()   → 生成摘要标题
    │       └── generateDetailList()→ 生成详细改动列表
    │
    └── 7. 交互式确认
            Enter → 确认提交
            e/v   → 编辑器编辑
            t     → 修改提交类型
            q     → 退出
            │
            └── doCommit(message) → git commit -F 临时文件
```

### 关键模块

| 模块 | 文件 | 职责 |
|------|------|------|
| 命令路由 | `index.js` | 解析 `--ai` 参数，分发到 `handleCommit` |
| 提交流程 | `lib/commands/commit.js` | 编排整体提交流程，AI 模式判断 |
| AI 调用 | `lib/ai.js` | OpenAI 兼容接口调用，prompt 构建 |
| 规则引擎 | `lib/generator.js` | AI 失败时的降级方案，基于规则生成 |
| Git 操作 | `lib/git.js` | 封装 git 命令，提供 diff/status 等 |
| 配置管理 | `lib/config.js` | 加载 .sgcrc.json，管理 apiKey/aiModel 等 |

### AI Prompt 设计

**System Prompt** 定义了严格的输出格式：

```text
你是一个专业的 Git 提交信息生成器。根据代码变更内容，生成 Conventional Commits 格式的提交信息。

格式要求：
type(scope): 变更摘要

- 具体改动项 1（说明改了什么功能）
- 具体改动项 2
- 具体改动项 3

规则：
1. 第一行是标题：type(scope): 变更摘要（不超过 72 字符）
2. 空一行
3. 用 "- " 列出每项具体改动，每项都要描述改了什么功能、为什么改
4. 不要出现文件名、文件路径、函数名、变量名等代码符号
5. 用自然语言描述功能层面的变化，而非代码层面的变化
6. 只返回提交信息，不要其他解释
```

### API 兼容性

支持以下 AI 服务（通过配置 `aiBaseUrl` 和 `aiModel`）：

| 服务 | aiBaseUrl | aiModel 示例 |
|------|-----------|-------------|
| 阿里通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-turbo` / `qwen-max` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` / `gpt-4o` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |

---

## sgc push 实现流程

`sgc push` 一键推送到多个远程仓库平台（如 GitHub + Gitee），省去逐平台推送的繁琐步骤。

### 整体流程

```
用户执行 sgc push [--force]
    │
    ▼
index.js → 匹配 'push' 命令
    │
    ▼
handlePush(args)
    │
    ├── 1. 获取当前分支
    │       getCurrentBranch()
    │       失败 → 报错退出
    │
    ├── 2. 加载配置
    │       loadConfig() → config.pushRemotes
    │
    ├── 3. 确定推送目标
    │       │
    │       ├── pushRemotes 有值 → 按配置名称过滤
    │       │     getRemotes() → filter by name
    │       │     检查配置的 remote 是否存在
    │       │
    │       └── pushRemotes 为空 → 自动检测全部
    │             getRemotes() → 获取所有 remote
    │             为空 → 报错退出
    │
    ├── 4. 显示推送信息
    │       分支名 + 目标 remote 列表（名称 + URL）
    │
    ├── 5. 依次推送到每个 remote
    │       forEach remote:
    │         git push {remote.name} {branch} [--force]
    │         execSync(cmd, { stdio: 'inherit' })
    │         统计成功/失败数量
    │
    └── 6. 汇总结果
            全部成功 → ✅ 推送成功
            部分成功 → ⚠️ 部分推送成功
            全部失败 → ❌ 所有推送均失败
```

### 关键模块

| 模块 | 文件 | 职责 |
|------|------|------|
| 命令路由 | `index.js` | 匹配 `push` 命令，分发到 `handlePush` |
| Push 命令 | `lib/commands/push.js` | 编排推送流程，多 remote 依次推送 |
| Git 操作 | `lib/git.js` | `getRemotes()` 解析 `git remote -v`，`getCurrentBranch()` |
| 配置管理 | `lib/config.js` | 加载 `pushRemotes` 配置 |

### getRemotes() 实现

```javascript
function getRemotes() {
  const output = runGit('remote -v');
  // 输出格式：origin\thttps://github.com/... (fetch)\norigin\thttps://github.com/... (push)

  const remoteMap = {};
  output.split('\n').filter(Boolean).forEach((line) => {
    const parts = line.split(/\s+/);
    // ['origin', 'https://...', '(fetch)']
    if (parts.length >= 2) {
      const name = parts[0];
      const url = parts[1];
      // 同名 remote 只保留第一个（fetch/push 去重）
      if (!remoteMap[name]) {
        remoteMap[name] = { name, url };
      }
    }
  });

  return Object.values(remoteMap);
}
```

### 两种使用模式

**1. 自动检测模式**（`pushRemotes` 为空）：

```bash
sgc push
# 自动检测所有 remote，全部推送
```

**2. 预设模式**（配置 `pushRemotes`）：

```json
{
  "pushRemotes": ["origin", "github"]
}
```

```bash
sgc push --force
# 只推送 origin 和 github，支持透传 --force 等参数
```

### 输出示例

```text
🚀 开始推送
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  分支: master
  目标: github (https://github.com/...), origin (https://gitee.com/...)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[1/2] 推送到 github/master ...
[2/2] 推送到 origin/master ...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ 推送成功 (全部 2 个远程仓库)
```
