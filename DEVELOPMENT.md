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

**1. 入口：`index.js` 解析命令行参数，识别 `--ai` 标志**

```javascript
// index.js
if (args.includes('--ai')) {
  handleCommit(args);
}
```

**2. 检查 Git 仓库和工作区状态**

获取仓库根目录、当前分支，检测暂存区/未暂存/未跟踪文件。

**`getRepoRoot()`** — 获取 Git 仓库根目录的绝对路径。

底层命令：`git rev-parse --show-toplevel`，`--show-toplevel` 参数返回 `.git` 所在目录的根路径。

```javascript
// 返回值示例
'/Users/xiongchao/Desktop/myproject/git-commit-gen'
```

**`getCurrentBranch()`** — 获取当前所在分支名。

底层命令：`git rev-parse --abbrev-ref HEAD`，`--abbrev-ref` 参数返回简短引用名（如 `master`），而非完整引用名（如 `refs/heads/master`）。

```javascript
// 返回值示例
'master'
```

**`getStagedFiles()`** — 获取暂存区（已 `git add`）的文件列表和变更类型。

底层命令：`git diff --cached --name-status`，`--cached` 查看暂存区对比 HEAD 的差异，`--name-status` 只显示文件名和状态码（M/A/D）。

```javascript
// 返回值示例
[
  { status: 'M', file: 'src/index.js' },
  { status: 'A', file: 'src/newfile.js' },
  { status: 'D', file: 'src/oldfile.js' }
]
```

**`getUnstagedFiles()`** — 获取已跟踪但未暂存（修改了但没 `git add`）的文件列表。

底层命令：`git diff --name-status`，不加 `--cached` 时对比工作区与暂存区的差异。

```javascript
// 返回值示例
[
  { status: 'M', file: 'package.json' }
]
```

**`getUntrackedFiles()`** — 获取未跟踪的新文件。

底层命令：`git ls-files --others --exclude-standard`，`--others` 列出未跟踪文件，`--exclude-standard` 排除 `.gitignore` 中配置的文件。

```javascript
// 返回值示例
['README.md', 'LICENSE']
```

**3. 如果暂存区为空，提示用户先执行 `git add`**

```javascript
if (stagedFiles.length === 0) {
  console.log('暂存区为空，请先 git add -A');
}
```

**4. 获取暂存区变更统计和完整 diff 内容**

**`getStagedDiff()`** — 获取暂存区变更统计（变更文件数和增删行数）。

底层命令：`git diff --cached --stat`，`--cached` 查看暂存区对比 HEAD 的差异，`--stat` 只输出统计信息而非完整 diff。

```javascript
// 返回值示例
' src/index.js | 15 +++++++++++\n package.json | 3 ++-\n 2 files changed, 16 insertions(+), 2 deletions(-)'
```

**`getStagedDiffDetail()`** — 获取暂存区完整 diff 内容（含每行具体改动）。

底层命令：`git diff --cached`，不加额外参数，输出完整的 unified diff 格式内容。

```javascript
// 返回值示例
'diff --git a/src/index.js b/src/index.js\nindex abc123..def456 100644\n--- a/src/index.js\n+++ b/src/index.js\n@@ -1,5 +1,8 @@\n-const old = 1;\n+const new = 2;\n+const extra = 3;'
```

**5. 检测到 `--ai` 标志，走 AI 生成路径**

5.1 检查 API Key，优先级：配置文件（`.sgcrc.json`）> 环境变量（`OPENAI_API_KEY` / `DASHSCOPE_API_KEY` 等）

```javascript
// lib/config.js
const apiKey = config.apiKey || process.env.OPENAI_API_KEY || process.env.DASHSCOPE_API_KEY;
```

5.2 无 API Key 则提示用户输入，或降级为规则引擎生成

5.3 有 API Key 则调用 `generateAICommitMessage(diffDetail, files, branch)`：

```javascript
// lib/ai.js
async function generateAICommitMessage(diffDetail, files, branch) {
  const body = {
    model: config.aiModel,              // 如 qwen-turbo、gpt-4o-mini
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },  // 定义 Conventional Commits 格式要求
      { role: 'user', content: `分支: ${branch}\n变更:\n${diffDetail.slice(0, 16000)}` }
    ],
    temperature: 0.3                     // 低温度保证输出稳定
  };

  const res = await fetch(`${config.aiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  return data.choices?.[0]?.message?.content || null;
}
```

5.4 失败返回 `null`，降级为规则引擎生成

**6. 如果 AI 未生成或失败，回退到规则引擎 `generateCommitMessage()`**

```javascript
// lib/generator.js
detectCommitType(stagedFiles, diffStat);  // 正则匹配 typeRules 推断 type（feat/fix/chore...）
generateScope(stagedFiles);                // 文件路径公共前缀提取 scope
analyzeFileDiff(diff);                     // 逐文件分析 diff 生成业务描述
generateSummary(type, scope, description); // 生成摘要标题 "type(scope): summary"
generateDetailList(changes);               // 生成详细改动列表 "- 改动项"
```

**7. 交互式确认**

用户可选择：Enter 确认提交、e/v 编辑器编辑、t 修改类型、q 退出。确认后通过 `git commit -F` 提交。

```javascript
// lib/commands/commit.js
doCommit(message); // 写入临时文件 → git commit -F <临时文件>
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

**1. 入口：`index.js` 匹配 `push` 命令，分发到 `handlePush`**

```javascript
// index.js
if (command === 'push') {
  handlePush(args);
}
```

**2. 获取当前分支**

```javascript
// lib/git.js
const branch = getCurrentBranch(); // git rev-parse --abbrev-ref HEAD
// 失败 → 报错退出
```

**3. 加载配置，确定推送目标**

```javascript
// lib/config.js
const config = loadConfig();
const pushRemotes = config.pushRemotes; // 来自 .sgcrc.json
```

3.1 如果 `pushRemotes` 有值，按配置名称过滤 remote 列表，检查 remote 是否存在：

```javascript
const allRemotes = getRemotes();
const remotes = allRemotes.filter(r => pushRemotes.includes(r.name));
// 检查配置的 remote 是否都存在
```

3.2 如果 `pushRemotes` 为空，自动检测全部 remote：

```javascript
const remotes = getRemotes();
if (remotes.length === 0) {
  console.error('❌ 当前仓库没有配置远程仓库');
  process.exit(1);
}
```

**4. 显示推送信息**

打印分支名 + 目标 remote 列表（名称 + URL）。

**5. 依次推送到每个 remote，统计成功/失败数量**

```javascript
// lib/commands/push.js
let success = 0, fail = 0;
remotes.forEach((remote, i) => {
  console.log(`[${i + 1}/${remotes.length}] 推送到 ${remote.name}/${branch} ...`);
  const forceFlag = args.includes('--force') ? ' --force' : '';
  try {
    execSync(`git push ${remote.name} ${branch}${forceFlag}`, { stdio: 'inherit' });
    success++;
  } catch {
    fail++;
  }
});
```

**6. 汇总结果**

全部成功 → ✅ 推送成功；部分成功 → ⚠️ 部分推送成功；全部失败 → ❌ 所有推送均失败

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
