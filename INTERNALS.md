# Smart Git Commit (sgc) 内部原理与 Node.js 模块详解

## 目录

- [一、执行流程](#一执行流程)
  - [1.1 从终端到 Node.js](#11-从终端到-nodejs)
  - [1.2 命令路由机制](#12-命令路由机制)
  - [1.3 完整提交流程](#13-完整提交流程)
- [二、Node.js 内置模块详解](#二nodejs-内置模块详解)
  - [2.1 child_process — 执行 Shell 命令](#21-child_process---执行-shell-命令)
  - [2.2 fs — 文件系统操作](#22-fs---文件系统操作)
  - [2.3 path — 路径处理](#23-path---路径处理)
  - [2.4 readline — 命令行交互](#24-readline---命令行交互)
  - [2.5 https — HTTPS 网络请求](#25-https---https-网络请求)
  - [2.6 process — 进程相关](#26-process---进程相关)
  - [2.7 全局对象/类](#27-全局对象类)
- [三、项目架构](#三项目架构)
- [四、配置文件 .sgcrc.json](#四配置文件-sgcrcjson)

---

## 一、执行流程

### 1.1 从终端到 Node.js

当在终端输入 `sgc --ai` 时，操作系统经过以下步骤最终执行 Node.js 代码：

```
终端输入: sgc --ai
    │
    ▼
操作系统在 PATH 中搜索 "sgc"
    │
    ▼
找到 /usr/local/bin/sgc （软链接，由 npm install -g 创建）
    │
    ▼
软链接指向: .../lib/node_modules/@xiongcao/smart-git-commit/index.js
    │
    ▼
读取 index.js 第一行: #!/usr/bin/env node
    │
    ▼
操作系统用 node 执行: node index.js --ai
    │
    ▼
Node.js 进程启动
  process.argv = ['/usr/local/bin/node', '.../index.js', '--ai']
```

**三个关键要素：**

| 要素 | 位置 | 作用 |
|------|------|------|
| `#!/usr/bin/env node` | `index.js` 第 1 行 | 声明用 node 解释器执行此文件 |
| `"bin": { "sgc": "./index.js" }` | `package.json` | 注册 `sgc` 为全局命令名 |
| `npm install -g` | 用户安装时 | npm 在系统 PATH 目录创建软链接 |

**等价关系：**

```bash
sgc              →  node index.js
sgc --ai         →  node index.js --ai
sgc log --graph  →  node index.js log --graph
sgc add .        →  node index.js add .
```

### 1.2 命令路由机制

`index.js` 主函数通过 `process.argv` 获取命令行参数，按优先级分发：

```
process.argv = ['node路径', 'index.js路径', 用户参数1, 用户参数2, ...]

slice(2) 后:
args = [用户参数1, 用户参数2, ...]
command = args[0]   ← 第一个参数作为子命令名
```

**路由优先级（从上到下匹配）：**

```
① command === 'help' / '--help' / '-h'     → showHelp()       显示帮助
② command === '--version' / '-v'           → console.log(v)   显示版本
③ !command 或 command.startsWith('-')      → handleCommit()   默认提交（--ai、--auto 等）
④ knownCommands.includes(command)          → 各命令处理器
⑤ 其他                                     → 透传给 git
```

**`args.slice(1)` 的含义：**

当命令已匹配后，`args.slice(1)` 去掉子命令名，把剩余参数传给具体处理器。

```
sgc log --graph
    │     │
    │     └── args.slice(1) = ['--graph'] → 传给 handleLog()
    └── args[0] = 'log' → 路由匹配

sgc branch create
    │       │
    │       └── args.slice(1) = ['create'] → 传给 handleBranch()
    └── args[0] = 'branch' → 路由匹配
```

### 1.3 完整提交流程

`sgc`（或 `sgc commit`）触发的智能提交流程：

```
用户输入: sgc
    │
    ▼
handleCommit(args)
    │
    ├── 检查是否在 Git 仓库中 → 否 → 退出
    │
    ▼
检查暂存区 (git diff --cached --stat)
    │
    ├── 暂存区为空 → 显示未暂存文件 → 询问是否 git add -A
    │       ├── y → 执行 git add -A
    │       └── 其他 → 退出
    │
    ▼
显示暂存文件列表 + 变更行数统计
    │
    ▼
生成 commit message
    │
    ├── --ai 模式 → 调用 AI API (https.request)
    │   └── AI 失败 → 回退到规则生成
    └── 默认模式 → 规则引擎分析 diff (generator.js)
    │
    ▼
交互确认（展示生成的 message）
    │
    ├── Enter → 执行 git commit -m "message"
    ├── e     → 打开编辑器修改 message → 执行 git commit -F <文件>
    ├── t     → 重新选择 type → 重新生成 message
    └── q     → 退出不提交
    │
    ▼
显示提交结果
```

---

## 二、Node.js 内置模块详解

项目**零第三方依赖**，100% 使用 Node.js 内置模块实现。

### 2.1 child_process — 执行 Shell 命令

用于调用 Git 命令和系统编辑器。

```js
const { execSync } = require('child_process');
```

#### execSync(command, options)

同步执行 Shell 命令，返回命令输出字符串。

**参数说明：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `command` | `string` | 要执行的 Shell 命令 |
| `options.encoding` | `string` | 输出编码，`'utf-8'` 返回字符串而非 Buffer |
| `options.cwd` | `string` | 工作目录，默认 `process.cwd()` |
| `options.maxBuffer` | `number` | 最大输出缓冲区（字节），默认 1MB |
| `options.stdio` | `string` | `'inherit'` 直接继承父进程标准 I/O |

**使用示例：**

```js
// 基础用法：执行 git status，返回输出字符串
const output = execSync('git status', { encoding: 'utf-8' });
console.log(output);

// 指定工作目录
execSync('git log -5', { cwd: '/path/to/repo', encoding: 'utf-8' });

// 大缓冲区（防止 diff 内容过多溢出）
const diff = execSync('git diff', {
  encoding: 'utf-8',
  maxBuffer: 10 * 1024 * 1024  // 10MB
});

// 透传模式：终端交互直接继承
execSync('git add .', { stdio: 'inherit' });

// 错误处理
try {
  execSync('git status', { encoding: 'utf-8' });
} catch (e) {
  console.error('命令失败:', e.message);
}
```

**项目中的实际用法：**

```js
// lib/git.js — 封装的 runGit 函数（所有 Git 命令的底层执行器）
function runGit(args, cwd) {
  try {
    return execSync(`git ${args}`, {
      encoding: 'utf-8',
      cwd: cwd || process.cwd(),
      maxBuffer: 10 * 1024 * 1024,  // 10MB
    }).trim();
  } catch (e) {
    return '';  // 失败返回空字符串
  }
}

// 调用示例
runGit('status --porcelain');          // → git status --porcelain
runGit('diff --cached --stat');        // → git diff --cached --stat
runGit('log -10 --format="%h %s"');   // → git log -10 --format="%h %s"
runGit('rev-parse --show-toplevel');   // → git rev-parse --show-toplevel
runGit('branch --list');               // → git branch --list
runGit('add -A');                      // → git add -A
```

```js
// index.js — 透传未知命令给 git
execSync(`git ${args.join(' ')}`, { stdio: 'inherit' });
// sgc add .     → execSync('git add .', { stdio: 'inherit' })
// sgc push      → execSync('git push', { stdio: 'inherit' })
// sgc checkout  → execSync('git checkout', { stdio: 'inherit' })
```

```js
// lib/commands/commit.js — 打开系统编辑器让用户编辑 commit message
const editor = process.env.EDITOR || process.env.VISUAL || 'vim';
execSync(`${editor} ${filePath}`, { stdio: 'inherit' });
```

---

### 2.2 fs — 文件系统操作

用于读写配置文件、hook 文件、临时文件等。

```js
const fs = require('fs');
```

| API | 类型 | 说明 |
|-----|------|------|
| `fs.existsSync(path)` | 同步 | 检查文件/目录是否存在，返回 `boolean` |
| `fs.readFileSync(path, encoding)` | 同步 | 读取文件内容，返回字符串 |
| `fs.writeFileSync(path, data, options)` | 同步 | 写入文件内容 |
| `fs.unlinkSync(path)` | 同步 | 删除文件 |
| `fs.copyFileSync(src, dest)` | 同步 | 复制文件 |

**使用示例：**

```js
// existsSync — 检查文件是否存在
if (fs.existsSync('.sgcrc.json')) {
  console.log('配置文件存在');
}

// readFileSync — 读取文件
const content = fs.readFileSync('.sgcrc.json', 'utf-8');
const config = JSON.parse(content);

// writeFileSync — 写入文件
fs.writeFileSync('output.txt', 'Hello World');

// 写入可执行脚本（Unix 权限 0o755 = rwxr-xr-x）
fs.writeFileSync('.git/hooks/commit-msg', hookScript, { mode: 0o755 });

// unlinkSync — 删除文件
fs.unlinkSync('temp-file.txt');

// copyFileSync — 复制文件
fs.copyFileSync('original.txt', 'backup.txt');
```

**文件权限 mode 值对照：**

| mode 值 | Unix 权限 | 说明 |
|---------|----------|------|
| `0o644` | rw-r--r-- | 默认普通文件 |
| `0o755` | rwxr-xr-x | 可执行文件（脚本） |
| `0o600` | rw------- | 仅所有者可读写（敏感文件） |

**项目中的实际用法：**

```js
// lib/commands/hook.js — 安装 Git Hook
const hookPath = '.git/hooks/commit-msg';

// 检查是否已有 hook
if (fs.existsSync(hookPath)) {
  const content = fs.readFileSync(hookPath, 'utf-8');
  if (content.includes('Smart Git Commit')) {
    console.log('hook 已安装');
    return;
  }
  // 备份已有 hook
  fs.copyFileSync(hookPath, hookPath + '.backup');
}

// 写入新的 hook 脚本（带执行权限）
fs.writeFileSync(hookPath, hookScript, { mode: 0o755 });

// 卸载时恢复备份或删除
if (fs.existsSync(backupPath)) {
  fs.copyFileSync(backupPath, hookPath);
  fs.unlinkSync(backupPath);
} else {
  fs.unlinkSync(hookPath);
}
```

```js
// lib/commands/commit.js — 编辑模式的临时文件操作
const tmpFile = '.git/COMMIT_EDITMSG_TMP';

// 写入待编辑的 message
fs.writeFileSync(tmpFile, message);

// 打开编辑器让用户修改
execSync(`vim ${tmpFile}`, { stdio: 'inherit' });

// 读取修改后的内容
const edited = fs.readFileSync(tmpFile, 'utf-8');

// 清理临时文件
fs.unlinkSync(tmpFile);
```

---

### 2.3 path — 路径处理

用于跨平台安全的路径拼接、解析。

```js
const path = require('path');
```

| API | 说明 | 示例输入 | 示例输出 |
|-----|------|---------|---------|
| `path.join(...paths)` | 拼接路径（自动处理分隔符） | `path.join('/a', 'b', 'c')` | `/a/b/c` |
| `path.basename(p)` | 获取文件名 | `path.basename('/a/b/file.js')` | `file.js` |
| `path.extname(p)` | 获取扩展名 | `path.extname('file.js')` | `.js` |
| `path.dirname(p)` | 获取目录名 | `path.dirname('/a/b/file.js')` | `/a/b` |

**使用示例：**

```js
const path = require('path');

// join — 跨平台路径拼接（自动用 / 或 \）
const homeDir = process.env.HOME || process.env.USERPROFILE;
const configPath = path.join(homeDir, '.sgcrc.json');
// Unix:   /home/user/.sgcrc.json
// Win:    C:\Users\user\.sgcrc.json

const hooksDir = path.join(repoRoot, '.git', 'hooks');

// basename — 提取文件名
path.basename('/project/src/utils/auth.js');  // → 'auth.js'
path.basename('/project/src/utils/auth.js', '.js'); // → 'auth'

// extname — 提取扩展名
path.extname('index.js');      // → '.js'
path.extname('style.css');     // → '.css'
path.extname('config.json');   // → '.json'
path.extname('README.md');     // → '.md'
path.extname('Dockerfile');    // → ''

// dirname — 提取目录名
path.dirname('/project/src/auth/login.js');  // → '/project/src/auth'
```

**项目中的实际用法：**

```js
// lib/generator.js — 文件类型判断
const ext = path.extname(filename).toLowerCase();
const basename = path.basename(filename);
const dir = path.dirname(filename);

if (ext === '.js') { /* JavaScript 文件分析 */ }
if (ext === '.css') { /* CSS 样式分析 */ }
if (basename === 'package.json') { /* 依赖变更分析 */ }
if (dir.includes('components')) { /* 组件目录分析 */ }
```

```js
// lib/config.js — 配置文件路径
const homeDir = process.env.HOME || process.env.USERPROFILE;
const globalConfigPath = path.join(homeDir, '.sgcrc.json');
const projectConfigPath = path.join(repoRoot, '.sgcrc.json');
```

---

### 2.4 readline — 命令行交互

用于和用户在终端中进行问答交互。

```js
const readline = require('readline');
```

**核心 API：`readline.createInterface(options)`**

创建交互接口，绑定输入输出流。

**返回对象的方法：**

| 方法 | 说明 |
|------|------|
| `rl.question(query, callback)` | 向用户提问，回调接收用户输入 |
| `rl.close()` | 关闭接口释放资源 |

**使用示例：**

```js
const readline = require('readline');

// 基础用法
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('请输入你的名字: ', (answer) => {
  console.log(`你好, ${answer}!`);
  rl.close();
});
```

**项目中的封装（`lib/prompt.js`）：**

```js
// 提问函数（支持默认值）
function ask(question, defaultValue) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const trimmed = answer.trim();
      resolve(trimmed || (defaultValue !== undefined ? defaultValue : ''));
    });
  });
}

// 使用示例
const name = await ask('你的名字: ');
const confirm = await ask('确认提交？[y/N] ');
if (confirm.toLowerCase() === 'y') {
  // 执行提交
}

// 列表选择
function selectFromList(title, items) {
  items.forEach((item, i) => console.log(`  ${i + 1}. ${item}`));
  const choice = await ask('请选择: ');
  return items[parseInt(choice) - 1];
}
```

**为什么用 `new Promise` 包装？**

`rl.question` 是回调式的异步 API，用 `Promise` 包装后可以配合 `await` 使用，让代码变成同步风格的写法，避免回调地狱。

---

### 2.5 https — HTTPS 网络请求

用于调用 AI API（OpenAI 兼容接口）。

```js
const https = require('https');
```

**核心 API：`https.request(options, callback)`**

发送 HTTPS 请求，返回 `ClientRequest` 对象。

**`ClientRequest` 方法：**

| 方法 | 说明 |
|------|------|
| `req.write(data)` | 写入请求体（POST 数据） |
| `req.end()` | 结束请求 |
| `req.on('error', callback)` | 监听请求错误 |

**`IncomingMessage` 事件：**

| 事件 | 说明 |
|------|------|
| `res.on('data', callback)` | 接收响应数据块（可能多次触发） |
| `res.on('end', callback)` | 响应接收完毕 |

**使用示例：**

```js
const https = require('https');

function httpPost(urlStr, body, apiKey) {
  const url = new URL(urlStr);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';

      // 拼接响应数据
      res.on('data', (chunk) => {
        data += chunk;
      });

      // 响应完成
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (e) => reject(e));

    // 发送请求体
    req.write(JSON.stringify(body));
    req.end();
  });
}
```

**项目中的实际用法（`lib/ai.js`）：**

```js
// 构建 API URL
const baseUrl = new URL(config.aiBaseUrl);
const pathname = baseUrl.pathname.replace(/\/$/, '') + '/chat/completions';
const url = new URL(pathname, baseUrl.origin);

// 构建请求体
const body = {
  model: config.aiModel,
  messages: [
    { role: 'system', content: '你是专业的 Git 提交信息生成器...' },
    { role: 'user', content: `变更详情：\n${diff}` },
  ],
};

// 发送请求
const https = require('https');
const req = https.request({
  hostname: url.hostname,
  path: url.pathname + url.search,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  },
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const result = JSON.parse(data);
    const message = result.choices[0].message.content;
    resolve(message);
  });
});

req.on('error', reject);
req.write(JSON.stringify(body));
req.end();
```

---

### 2.6 process — 进程相关

`process` 是全局对象，无需 `require`，直接使用。

| API | 说明 | 示例 |
|-----|------|------|
| `process.argv` | 命令行参数数组 | `['node', 'index.js', '--ai']` |
| `process.cwd()` | 当前工作目录 | `/Users/xxx/my-project` |
| `process.exit(code)` | 退出进程 | `process.exit(0)` 正常退出 |
| `process.env` | 环境变量对象 | `process.env.HOME` |
| `process.stdin` | 标准输入流 | 传给 `readline.createInterface` |
| `process.stdout` | 标准输出流 | 传给 `readline.createInterface` |

**使用示例：**

```js
// process.argv — 命令行参数
// 终端输入: sgc log --graph
process.argv;  // ['/usr/local/bin/node', '.../index.js', 'log', '--graph']
const args = process.argv.slice(2);  // ['log', '--graph']
const command = args[0];             // 'log'

// process.cwd() — 当前目录
const cwd = process.cwd();  // '/Users/xxx/my-project'

// process.exit() — 退出码
process.exit(0);   // 正常退出
process.exit(1);   // 异常退出
process.exit(e.status || 1);  // 透传 git 命令的退出码

// process.env — 读取环境变量
const home = process.env.HOME;                    // Unix: /home/user
const userProfile = process.env.USERPROFILE;      // Windows: C:\Users\user
const editor = process.env.EDITOR || process.env.VISUAL || 'vim';
const openaiKey = process.env.OPENAI_API_KEY;
const dashscopeKey = process.env.DASHSCOPE_API_KEY;
```

---

### 2.7 全局对象/类

以下均为 JavaScript 内置全局对象/类，无需 `require`。

#### JSON

```js
// JSON.stringify — 将对象序列化为 JSON 字符串
const body = JSON.stringify({ model: 'gpt-4o', messages: [...] });

// JSON.parse — 将 JSON 字符串解析为对象
const config = JSON.parse(fs.readFileSync('.sgcrc.json', 'utf-8'));
const response = JSON.parse(data);
```

#### URL

```js
// new URL(pathname, base) — 解析和拼接 URL
const baseUrl = 'https://api.openai.com/v1';
const url = new URL('/chat/completions', baseUrl);
console.log(url.href);       // 'https://api.openai.com/chat/completions'
console.log(url.hostname);   // 'api.openai.com'
console.log(url.pathname);   // '/chat/completions'

// 手动拼接避免路径覆盖
const base = new URL('https://dashscope.aliyuncs.com/compatible-mode/v1');
const pathname = base.pathname.replace(/\/$/, '') + '/chat/completions';
const final = new URL(pathname, base.origin);
console.log(final.href);  // 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
```

#### Promise

```js
// 包装异步操作为 Promise，配合 await 使用
function ask(question) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

const name = await ask('你的名字: ');  // 同步风格写法
```

#### RegExp

```js
// 将字符串转为正则对象
const pattern = 'feat|fix|docs';
const regex = new RegExp(`^(${pattern})`, 'i');  // /^(feat|fix|docs)/i

if (regex.test('feat(auth): 新增登录')) {
  console.log('匹配成功');
}
```

#### Set

```js
// 去重集合
const cssProps = new Set();
cssProps.add('color');
cssProps.add('font-size');
cssProps.add('color');  // 重复，不会添加
console.log(cssProps.size);  // 2
```

#### Object 静态方法

```js
// Object.assign — 合并多个对象
const defaultConfig = { type: 'feat', useAI: false };
const userConfig = { useAI: true };
const merged = Object.assign({}, defaultConfig, userConfig);
// { type: 'feat', useAI: true }

// Object.values — 获取对象所有值
const stats = { feat: 8, fix: 6, docs: 3 };
const total = Object.values(stats).reduce((a, b) => a + b, 0);  // 17

// Object.entries — 获取键值对数组
const entries = Object.entries(stats);
// [['feat', 8], ['fix', 6], ['docs', 3]]
entries.sort((a, b) => b[1] - a[1]);  // 按数量降序排列
```

---

## 三、项目架构

```
index.js                    # 入口：Shebang + 参数解析 + 命令路由
package.json                # bin 注册 + 版本信息
lib/
├── colors.js               # ANSI 终端颜色常量
├── config.js               # 配置管理（读取 .sgcrc.json，合并默认/全局/项目配置）
├── git.js                  # Git 命令封装层（runGit 函数）
├── generator.js            # Commit message 规则生成引擎（分析 diff 内容）
├── ai.js                   # AI 模式（调用 OpenAI 兼容接口）
├── prompt.js               # 命令行交互工具（提问、选择列表）
└── commands/
    ├── commit.js           # 核心提交流程（检查 → 暂存 → 生成 → 确认 → 提交）
    ├── log.js              # 提交历史查看（美化输出 + 类型统计图表）
    ├── status.js           # 仓库状态查看（增强版，含 ahead/behind + 行数统计）
    ├── branch.js           # 分支管理（列表 / 创建 / 切换 / 删除）
    ├── hook.js             # Git Hook 管理（安装 / 卸载 / 检查 commit-msg hook）
    └── init.js             # 初始化配置文件 .sgcrc.json
```

**依赖关系（箭头表示调用）：**

```
index.js
  ├── commands/commit.js
  │     ├── git.js         → runGit() 执行所有 Git 命令
  │     ├── config.js      → 读取 AI 和生成配置
  │     ├── generator.js   → 规则模式生成 message
  │     ├── ai.js          → AI 模式生成 message
  │     │     └── https.request → 调用 AI API
  │     └── prompt.js      → 用户交互（提问/选择）
  ├── commands/log.js
  │     ├── git.js         → runGit('log -N --format=...')
  │     └── colors.js      → 终端颜色
  ├── commands/status.js
  │     └── git.js         → runGit('status') 等
  ├── commands/branch.js
  │     ├── git.js         → runGit('branch') 等
  │     └── prompt.js      → 交互选择分支
  ├── commands/hook.js
  │     ├── git.js         → getRepoRoot()
  │     └── fs 模块        → 读写 hook 文件
  └── commands/init.js
        ├── git.js         → getRepoRoot()
        └── fs 模块        → 写配置文件
```

---

## 四、配置文件 .sgcrc.json

通过 `sgc init` 生成，支持项目级（`./.sgcrc.json`）和全局级（`~/.sgcrc.json`）。

**配置优先级：项目级 > 全局级 > 默认值**

```json
{
  "useAI": false,
  "apiKey": "",
  "aiModel": "gpt-4o-mini",
  "aiBaseUrl": "https://api.openai.com/v1",
  "defaultType": "feat",
  "typeRules": [
    {
      "pattern": "\\.test\\.",
      "type": "test",
      "description": "测试文件"
    },
    {
      "pattern": "package\\.json",
      "type": "chore",
      "description": "依赖管理"
    }
  ],
  "commitTypes": ["feat", "fix", "docs", "style", "refactor", "perf", "test", "chore", "revert", "build"],
  "branchPrefixes": {
    "feat": "功能开发",
    "fix": "问题修复",
    "docs": "文档",
    "chore": "杂项"
  }
}
```

**关键字段说明：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `useAI` | `boolean` | 是否默认启用 AI 模式 |
| `apiKey` | `string` | AI API Key（也可通过环境变量设置） |
| `aiModel` | `string` | AI 模型名，如 `gpt-4o-mini`、`qwen-turbo` |
| `aiBaseUrl` | `string` | AI API 地址 |
| `defaultType` | `string` | 默认 commit type |
| `typeRules` | `Array` | 文件匹配规则（正则 + 对应 type） |
| `commitTypes` | `Array` | 可选 commit type 列表 |
| `branchPrefixes` | `Object` | 分支前缀映射 |
