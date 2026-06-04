# Smart Git Commit (sgc)

智能 Git 提交助手 —— 自动检测修改并生成 [Conventional Commits](https://www.conventionalcommits.org/) 规范的提交信息，同时提供分支管理、提交历史查看、Hook 校验等一站式 Git 工作流工具。

## 安装

```bash
npm install -g @xiongcao/smart-git-commit
```

安装后即可在任意 Git 仓库中使用 `sgc` 命令。

## 命令概览

| 命令 | 功能 |
|------|------|
| `sgc` | 交互式生成 commit message 并提交 |
| `sgc commit` | 同上 |
| `sgc log` | 查看美化后的提交历史 + 类型统计 |
| `sgc log --graph` | 图形化提交历史 |
| `sgc log 20` | 查看最近 20 条记录 |
| `sgc status` | 查看仓库状态（增强版） |
| `sgc branch` | 查看分支列表 |
| `sgc branch create` | 创建带规范前缀的分支 |
| `sgc branch switch` | 交互式切换分支 |
| `sgc branch delete` | 交互式删除分支 |
| `sgc init` | 初始化配置文件 `.sgcrc.json` |
| `sgc hook install` | 安装 commit-msg 校验 hook |
| `sgc hook uninstall` | 卸载 hook |
| `sgc hook check` | 检查 hook 状态 |
| `sgc -h` / `sgc help` | 查看帮助信息 |

### Commit 选项

| 选项 | 功能 |
|------|------|
| `--ai` | 使用 AI 生成 commit message |
| `--auto` / `-a` | 跳过交互确认，直接提交 |
| `--dry-run` / `-d` | 预览模式，不实际提交 |

### Git 透传

除以上命令外，所有命令均透传给 `git`，例如：

```bash
sgc add .           # → git add .
sgc diff            # → git diff
sgc push            # → git push
sgc pull            # → git pull
sgc checkout xxx    # → git checkout xxx
# ... 任意 git 命令均可通过 sgc 前缀执行
```

---

## 功能详解

### 1. 智能提交 —— `sgc` / `sgc commit`

核心功能，自动分析暂存区文件变更，生成符合 Conventional Commits 规范的提交信息。

**工作流程：**

1. 检测 Git 仓库和当前分支
2. 如果暂存区为空，列出未暂存修改，询问是否自动 `git add -A`
3. 展示暂存文件列表和变更统计（增删行数）
4. 自动生成 commit message，格式：`type(scope): description`
5. 交互选择：`Enter` 确认 / `e` 编辑 / `t` 修改类型 / `q` 退出
6. 执行 `git commit`

**Commit 选项：**

```bash
sgc                     # 交互模式
sgc --auto / -a         # 跳过交互，直接提交
sgc --dry-run / -d      # 预览模式，不实际提交
sgc --ai                # 使用 AI 生成 commit message
```

**生成规则：**

工具会深度扫描每个文件的 diff 内容，自动分析具体改动，生成符合 Conventional Commits 规范的提交信息。

**规则生成模式**（默认）会分析：
- 新增/删除的函数、方法、组件、类
- 新增/移除的依赖包（package.json）
- 修改的配置项及新旧值对比
- 新增/修改的条件判断、错误处理、异步逻辑
- 样式文件的属性变更
- JSON 配置文件的结构变化
- Markdown 文档的章节变更

**AI 生成模式**（`--ai`）会从功能层面描述本次调整的内容，不包含文件名、路径、函数名等代码符号，更注重业务语义。

可通过 `.sgcrc.json` 中的 `typeRules` 自定义 type 匹配规则。

---

### 2. 提交历史 —— `sgc log`

美化展示最近 N 条提交记录，带颜色标签和类型统计。

```bash
sgc log                 # 查看最近 10 条记录
sgc log 20              # 查看最近 20 条记录
sgc log --graph         # 图形化显示分支历史
```

输出示例：

```text
📜 最近 10 条提交记录
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  abc1234  feat(auth) 新增登录功能
  def5678  fix(api) 修复 token 过期问题
  ghi9012  docs 更新 README

📊 提交类型统计
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  feat         ████████████████████ 8 (40.0%)
  fix          ██████████████ 6 (30.0%)
  docs         ██████ 3 (15.0%)
```

---

### 3. 仓库状态 —— `sgc status`

比 `git status` 更友好的状态展示：

- 显示当前分支及 ahead/behind 信息（`↑3 ↓1`）
- 按暂存区（绿色）/ 未暂存（黄色）/ 未跟踪（洋红）分组
- 显示每个分组的文件数量和增删行数统计
- 图标标注文件状态（新增 🆕 / 修改 ✏️ / 删除 🗑️）

```bash
sgc status
```

---

### 4. 分支管理 —— `sgc branch`

一站式分支管理工具，创建分支自动添加规范前缀。

```bash
sgc branch              # 查看所有分支，当前分支用 ● 标记
sgc branch create       # 交互式创建分支：选择前缀 → 输入名称
sgc branch switch       # 交互式切换分支
sgc branch delete       # 交互式删除分支（支持 --force 强制删除）
```

**创建分支示例：**

```text
🌿 创建新分支
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
选择分支前缀：
  feat         → feat/
  fix          → fix/
  docs         → docs/
  chore        → chore/

分支名（feat/）: login

✅ 已创建并切换到分支: feat/login
```

分支前缀映射可在 `.sgcrc.json` 中配置。

---

### 5. Hook 管理 —— `sgc hook`

自动安装 `commit-msg` hook，在每次 `git commit` 时校验提交信息格式。

```bash
sgc hook install        # 安装 hook（已有 hook 会自动备份）
sgc hook uninstall      # 卸载 hook（自动恢复备份）
sgc hook check          # 检查 hook 安装状态
```

安装后，不符合 Conventional Commits 格式的提交将被拒绝：

```text
❌ Commit message 格式不符合规范！

要求的格式：type(scope): description

示例：
  feat: 添加用户登录功能
  fix(auth): 修复token过期问题
  docs: 更新API文档

可用类型：feat, fix, docs, style, refactor, perf, test, chore, revert, build
```

---

### 6. 初始化配置 —— `sgc init`

在当前 Git 仓库根目录生成 `.sgcrc.json` 配置文件。

```bash
sgc init
```

配置文件内容及说明：

```json
{
  "useAI": false,              // 是否默认启用 AI 模式
  "apiKey": "",                // AI API Key（可选，不填则从环境变量读取）
  "aiModel": "gpt-4o-mini",    // AI 模型名称
  "aiBaseUrl": "https://api.openai.com/v1",  // AI API 地址
  "defaultType": "feat",       // 默认 commit 类型
  "typeRules": [...],          // 文件匹配规则
  "commitTypes": [...],        // 可选 commit 类型列表
  "branchPrefixes": {...}      // 分支前缀映射
}
```

配置优先级：**项目级 `.sgcrc.json` > 全局级 `~/.sgcrc.json` > 默认配置**

---

## AI 模式

支持通过 AI 生成更智能的 commit message，兼容 OpenAI 接口协议（支持 OpenAI、阿里通义千问等）。

### 配置方式

**方式一：环境变量**

```bash
export OPENAI_API_KEY="sk-your-key"      # OpenAI
export DASHSCOPE_API_KEY="your-key"      # 阿里通义千问
```

**方式二：配置文件**

在 `.sgcrc.json` 中设置：

```json
{
  "useAI": true,
  "apiKey": "your-api-key",
  "aiModel": "gpt-4o-mini",
  "aiBaseUrl": "https://api.openai.com/v1"
}
```

**方式三：交互式输入**

直接运行 `sgc --ai`，工具会提示输入 Key（仅当次有效）。

### 使用

```bash
sgc --ai                # 使用 AI 生成提交信息
```

---

## 项目结构

```
smart-git-commit/
├── index.js              # 主入口，命令路由
├── package.json          # 注册 sgc 全局命令
└── lib/
    ├── colors.js         # ANSI 终端颜色工具
    ├── git.js            # Git 命令封装
    ├── config.js         # 配置管理
    ├── generator.js      # Commit message 规则生成器
    ├── ai.js             # AI 模式（OpenAI 兼容接口）
    ├── prompt.js         # 交互工具
    └── commands/
        ├── commit.js     # 提交流程
        ├── log.js        # 提交历史
        ├── status.js     # 仓库状态
        ├── branch.js     # 分支管理
        ├── hook.js       # Hook 管理
        └── init.js       # 初始化配置
```

## License

MIT
