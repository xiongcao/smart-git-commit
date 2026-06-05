// ============ 代码审查模块 ============
// 负责获取分支间差异，通过 AI 分析代码变更，生成优化建议报告
//
// 核心流程：
// 1. 获取两个分支之间的 git diff
// 2. 解析 diff 按文件分组
// 3. 分批发送给 AI 进行分析
// 4. 汇总所有建议，按严重程度排序输出
//
// 支持平台：本地 CLI 模式 + Webhook 模式（GitHub/GitLab/Gitee）

const { loadConfig } = require('./config');
const { colors } = require('./colors');

// ============ 平台检测 ============

/**
 * 根据 Webhook 请求头判断是哪个平台
 * 不同平台在 Webhook 事件中会设置特定的 HTTP Header
 *
 * @param {Object} headers - HTTP 请求头对象（Header 名已转为小写）
 * @returns {string} 平台标识：'github' | 'gitlab' | 'gitee' | 'unknown'
 */
function detectPlatform(headers) {
  if (headers['x-github-event']) return 'github';
  if (headers['x-gitlab-event']) return 'gitlab';
  if (headers['x-gitee-event']) return 'gitee';
  return 'unknown';
}

// ============ 平台 Webhook 解析 ============

/**
 * 从 Webhook 请求体中提取分支和仓库信息
 * 三个平台的数据结构不同，这里统一解析为通用格式
 *
 * @param {Object} body - Webhook 请求的 JSON body
 * @param {string} platform - 平台标识（github/gitlab/gitee）
 * @returns {{sourceBranch: string, targetBranch: string, cloneUrl: string, prNumber: number}}
 */
function parseWebhookBody(body, platform) {
  if (platform === 'github') {
    const pr = body.pull_request || {};
    return {
      sourceBranch: pr.head?.ref || '',        // PR 的源分支
      targetBranch: pr.base?.ref || '',        // PR 的目标分支（通常是 main/master）
      cloneUrl: body.repository?.clone_url || '',  // 仓库克隆地址
      prNumber: pr.number || 0,                // PR 编号，用于后续发评论
    };
  }

  if (platform === 'gitlab') {
    const attrs = body.object_attributes || {};
    return {
      sourceBranch: attrs.source_branch || '',
      targetBranch: attrs.target_branch || '',
      cloneUrl: body.project?.git_http_url || '',
      prNumber: attrs.iid || 0,                // GitLab 用 iid 表示 MR 编号
    };
  }

  if (platform === 'gitee') {
    const pr = body.pull_request || {};
    return {
      sourceBranch: pr.head?.ref || '',
      targetBranch: pr.base?.ref || '',
      cloneUrl: body.repository?.git_http_url || '',
      prNumber: pr.number || 0,
    };
  }

  // 未知平台返回空值
  return { sourceBranch: '', targetBranch: '', cloneUrl: '', prNumber: 0 };
}

// ============ 安全过滤 ============

/**
 * 判断文件是否需要审查（过滤掉非代码文件）
 * 避免把 lock 文件、二进制文件、构建产物等发给 AI 浪费 token
 *
 * @param {string} filePath - 文件路径
 * @returns {boolean} true 表示需要审查
 */
function shouldReview(filePath) {
  const ext = require('path').extname(filePath).toLowerCase();

  // 需要审查的代码文件扩展名（白名单模式）
  const codeExts = [
    '.js', '.ts', '.jsx', '.tsx',      // JavaScript/TypeScript
    '.py', '.java', '.go', '.rs',      // Python/Java/Go/Rust
    '.c', '.cpp', '.h', '.hpp',        // C/C++
    '.rb', '.php', '.swift', '.kt',    // Ruby/PHP/Swift/Kotlin
    '.vue', '.svelte',                  // 前端框架
    '.css', '.scss', '.less',          // 样式文件
    '.html', '.xml', '.json',          // 标记语言和配置
    '.yaml', '.yml', '.toml',          // 配置文件
    '.sh', '.bash', '.zsh',            // Shell 脚本
    '.sql', '.graphql',                // 数据库/API
    '.md',                              // 文档也需要审查
  ];

  // 排除的目录和文件模式（黑名单模式，双重保险）
  const excludePatterns = [
    /node_modules/,
    /dist\//,
    /build\//,
    /\.git\//,
    /vendor\//,
    /\.lock$/,
    /package-lock\.json$/,
    /yarn\.lock$/,
    /pnpm-lock\.yaml$/,
    /\.min\./,
    /\.map$/,
    /\.d\.ts$/,                          // TypeScript 声明文件（通常自动生成）
    /\.png$/, /\.jpg$/, /\.jpeg$/,      // 图片文件
    /\.gif$/, /\.svg$/, /\.ico$/,       // 图片文件
    /\.woff/, /\.ttf$/, /\.eot$/,       // 字体文件
    /\.pdf$/, /\.zip$/, /\.tar/,        // 二进制文件
    /\.mp4$/, /\.mp3$/, /\.wav$/,       // 媒体文件
  ];

  // 先检查白名单扩展名
  if (!codeExts.includes(ext)) return false;

  // 再检查黑名单模式
  for (const pattern of excludePatterns) {
    if (pattern.test(filePath)) return false;
  }

  return true;
}

// ============ Diff 解析 ============

/**
 * 解析 git diff 输出，按文件分组
 *
 * git diff 输出格式示例：
 * ```
 * diff --git a/src/app.js b/src/app.js
 * index abc123..def456 100644
 * --- a/src/app.js
 * +++ b/src/app.js
 * @@ -10,6 +10,8 @@
 *  context line
 * -deleted line
 * +added line 1
 * +added line 2
 * ```
 *
 * @param {string} diffOutput - git diff 的完整输出
 * @returns {Array<{file: string, content: string, additions: number, deletions: number}>}
 */
function parseDiff(diffOutput) {
  if (!diffOutput) return [];

  const files = [];
  const lines = diffOutput.split('\n');

  let currentFile = null;
  let currentContent = [];
  let currentAdditions = 0;
  let currentDeletions = 0;

  for (const line of lines) {
    // 检测 diff --git 行：新文件开始
    // 格式：diff --git a/path/to/file b/path/to/file
    if (line.startsWith('diff --git ')) {
      // 保存上一个文件的数据
      if (currentFile && shouldReview(currentFile)) {
        files.push({
          file: currentFile,
          content: currentContent.join('\n'),
          additions: currentAdditions,
          deletions: currentDeletions,
        });
      }

      // 提取文件路径：取 b/ 后面的部分
      // 格式：diff --git a/src/app.js b/src/app.js
      const match = line.match(/diff --git a\/(.*?) b\/(.*?)$/);
      currentFile = match ? match[2] : '';
      currentContent = [];
      currentAdditions = 0;
      currentDeletions = 0;
      continue;
    }

    // 跳过 diff 头部信息行（不需要发给 AI）
    if (line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      continue;
    }

    // 统计增删行数
    if (line.startsWith('+') && !line.startsWith('+++')) {
      currentAdditions++;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      currentDeletions++;
    }

    // 收集 diff 内容行
    currentContent.push(line);
  }

  // 保存最后一个文件的数据
  if (currentFile && shouldReview(currentFile)) {
    files.push({
      file: currentFile,
      content: currentContent.join('\n'),
      additions: currentAdditions,
      deletions: currentDeletions,
    });
  }

  return files;
}

// ============ AI 审查调用 ============

/**
 * 获取 API Key（复用 config 模块的逻辑）
 *
 * @returns {string|null} API Key，未配置返回 null
 */
function getApiKey(config) {
  const API_KEY_ENV_NAMES = [
    'OPENAI_API_KEY',
    'DASHSCOPE_API_KEY',
    'ANTHROPIC_API_KEY',
    'DEEPSEEK_API_KEY',
  ];

  if (config.apiKey) return config.apiKey;

  for (const name of API_KEY_ENV_NAMES) {
    if (process.env[name]) return process.env[name];
  }

  return null;
}

/**
 * 构建代码审查的 AI 提示词
 *
 * 告诉 AI 扮演代码审查员的角色，重点关注：
 * - 逻辑错误和潜在 bug
 * - 性能问题
 * - 安全问题
 * - 代码可维护性
 * - 最佳实践
 *
 * @param {string} diffContent - 代码差异内容
 * @param {string} sourceBranch - 源分支名
 * @param {string} targetBranch - 目标分支名
 * @returns {Array} messages 数组（OpenAI Chat Completions 格式）
 */
function buildReviewPrompt(diffContent, sourceBranch, targetBranch) {
  return [
    {
      role: 'system',
      content: `你是一位资深的代码审查专家。请根据代码变更内容（git diff），给出专业的优化建议。

审查重点（按优先级排序）：
1. 🔴 严重问题（8-10分）：逻辑错误、潜在的运行时崩溃、安全漏洞（如 SQL 注入、XSS、未处理的异常、敏感信息泄露）
2. 🟡 一般问题（6-7分）：性能瓶颈、内存泄漏、资源未释放、竞态条件、错误处理缺失
3. 💡 优化建议（1-5分）：代码可读性、可维护性、设计模式、重复代码、命名规范

评分规则（0-10分）：
- 每个建议必须给出评分，分数越高表示越需要优化
- 8-10分：严重问题，必须修复，否则会导致 bug 或安全风险
- 6-7分：一般问题，建议修复，可能影响性能或稳定性
- 1-5分：优化建议，属于锦上添花，不强制修改，但仍值得关注
- 0分：没有值得提出的问题，不输出

输出格式要求：
每个问题必须按以下格式输出：

【评分 X/10】严重程度图标 文件路径:行号范围
- 问题：简要描述问题是什么
- 原因：说明为什么这是问题
- 建议：给出具体的代码修改建议，必须使用以下标记区分增删代码：
  用 + 开头标记新增/修改的代码行（绿色）
  用 - 开头标记删除的代码行（红色）
  用 = 开头标记保留不变的上下文代码行

格式示例：
【评分 9/10】🔴 src/auth.js:42-48
- 问题：用户输入未做任何校验直接拼接到 SQL 语句中
- 原因：存在 SQL 注入风险，攻击者可构造恶意输入获取数据库权限
- 建议：
  = async function getUserById(userId) {
  =   const db = await getConnection();
  -   const sql = \`SELECT * FROM users WHERE id = '\${userId}'\`;
  -   return db.query(sql);
  +   const sql = 'SELECT * FROM users WHERE id = ?';
  +   return db.query(sql, [userId]);
  = }

【评分 7/10】🟡 src/utils.js:15-20
- 问题：循环内重复计算相同的值
- 原因：每次迭代都重新计算，当数据量较大时浪费 CPU
- 建议：
  = for (let i = 0; i < items.length; i++) {
  +   const price = calculatePrice(items[i]);
  -   const total += items[i].price * 1.2;
  +   const total += price * 1.2;
  = }

【评分 3/10】💡 src/index.js:8-12
- 问题：变量命名不够清晰
- 原因：d 和 tmp 含义模糊，降低代码可读性
- 建议：
  - const d = new Date();
  + const currentDate = new Date();
  - const tmp = data.filter(x => x.active);
  + const activeItems = data.filter(item => item.active);

不要输出：
- 没有实质问题的客套话（如"代码写得很好"、"整体质量不错"）
- 没有代码修改建议的纯描述性评论
- 关于 commit message 的建议

请用中文输出。`,
    },
    {
      role: 'user',
      content: `请审查从 ${targetBranch} 合并到 ${sourceBranch} 的代码变更：

\`\`\`diff
${diffContent.slice(0, 20000)}
\`\`\`

请逐文件分析，对每个问题给出评分（0-10分），并给出具体的代码修改建议，用 + 标记新增代码、- 标记删除代码、= 标记上下文代码。`,
    },
  ];
}

/**
 * 调用 AI API 审查一批代码差异
 *
 * @param {string} diffContent - 拼接后的 diff 内容
 * @param {string} sourceBranch - 源分支名
 * @param {string} targetBranch - 目标分支名
 * @returns {Promise<string>} AI 返回的审查建议文本
 */
async function callAIReview(diffContent, sourceBranch, targetBranch) {
  const config = loadConfig();
  const apiKey = getApiKey(config);

  if (!apiKey) {
    throw new Error('未配置 AI API Key，请设置环境变量 OPENAI_API_KEY 或在 .sgcrc.json 中配置 apiKey');
  }

  // 动态引入 https 模块（仅在需要时加载，避免影响不需要 AI 的场景）
  const https = require('https');

  // 构建请求 URL
  const baseUrl = new URL(config.aiBaseUrl);
  const pathname = baseUrl.pathname.replace(/\/$/, '') + '/chat/completions';
  const url = new URL(pathname, baseUrl.origin);

  // 构建提示词
  const messages = buildReviewPrompt(diffContent, sourceBranch, targetBranch);

  // 构建请求体
  const body = JSON.stringify({
    model: config.aiModel,
    messages,
    temperature: 0.5,   // 审查场景：略高的温度，让建议更丰富
    max_tokens: 2000,   // 审查建议可能较长，给足够的 token
  });

  // 发送 HTTPS POST 请求
  const response = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            const preview = data.slice(0, 500);
            reject(new Error(`HTTP ${res.statusCode}: ${preview}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            const preview = data.slice(0, 500);
            reject(new Error(`Invalid JSON response: ${preview}`));
          }
        });
      }
    );
    req.on('error', (e) => reject(new Error(`网络请求失败: ${e.message}`)));
    req.write(body);
    req.end();
  });

  if (response.error) {
    throw new Error(response.error.message || 'AI API 请求失败');
  }

  return response.choices?.[0]?.message?.content?.trim() || '';
}

// ============ 分批处理 ============

/**
 * 将文件列表分批，每批不超过指定大小
 *
 * 为什么要分批？
 * - AI API 有上下文长度限制（通常 8K-128K tokens）
 * - 一次发送太多 diff 内容可能超出限制或导致审查质量下降
 * - 分批可以让每批的审查更加聚焦
 *
 * @param {Array<{file: string, content: string}>} files - 文件列表
 * @param {number} maxCharsPerBatch - 每批最大字符数，默认 8000
 * @returns {Array<Array<{file: string, content: string}>>} 分批后的文件组
 */
function splitIntoBatches(files, maxCharsPerBatch = 8000) {
  const batches = [];
  let currentBatch = [];
  let currentSize = 0;

  for (const file of files) {
    const fileContent = `\n--- 文件：${file.file} (新增 ${file.additions} 行，删除 ${file.deletions} 行) ---\n${file.content}`;
    const fileSize = fileContent.length;

    // 如果当前批加上这个文件会超出限制，则新建一批
    if (currentSize + fileSize > maxCharsPerBatch && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentSize = 0;
    }

    currentBatch.push(file);
    currentSize += fileSize;
  }

  // 最后一批
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

/**
 * 将一批文件的内容拼接为一个 diff 字符串
 *
 * @param {Array<{file: string, content: string, additions: number, deletions: number}>} batch
 * @returns {string} 拼接后的 diff 内容
 */
function concatBatch(batch) {
  return batch
    .map(
      (f) => `--- 文件：${f.file} (新增 ${f.additions} 行，删除 ${f.deletions} 行) ---\n${f.content}`
    )
    .join('\n\n');
}

// ============ 主审查流程 ============

/**
 * 执行代码审查
 *
 * 完整流程：
 * 1. 获取两个分支间的 git diff
 * 2. 解析 diff 按文件分组
 * 3. 过滤非代码文件
 * 4. 分批发送给 AI 分析
 * 5. 汇总所有建议
 * 6. 返回结构化报告
 *
 * @param {Object} options - 审查选项
 * @param {string} options.sourceBranch - 源分支（被审查的分支）
 * @param {string} options.targetBranch - 目标分支（合并到的分支）
 * @param {string} [options.cwd] - 工作目录，默认为当前目录
 * @param {boolean} [options.silent=false] - 是否静默模式（不输出进度日志）
 * @returns {Promise<{report: string, summary: Object}>} 审查报告和摘要
 */
async function reviewCode({ sourceBranch, targetBranch, cwd, silent = false }) {
  // 动态引入 git 模块（仅在需要时加载）
  const { runGit } = require('./git');

  const log = silent ? () => {} : console.log;

  log(`${colors.cyan}🔍 开始代码审查...${colors.reset}`);
  log(`  源分支：${colors.yellow}${sourceBranch}${colors.reset}`);
  log(`  目标分支：${colors.yellow}${targetBranch}${colors.reset}\n`);

  // ============ 步骤 1：获取 git diff ============
  // 使用三点语法 source...target 获取两个分支共同祖先之后的差异
  // 三点语法 git diff target...source 等价于 git diff $(git merge-base target source) source
  log(`${colors.gray}  正在获取代码差异...${colors.reset}`);
  const diffOutput = runGit(`diff ${targetBranch}...${sourceBranch}`, cwd);

  if (!diffOutput) {
    log(`${colors.yellow}  ⚠️  两个分支之间没有差异${colors.reset}`);
    return {
      report: '两个分支之间没有代码差异，无需审查。',
      summary: { totalFiles: 0, reviewedFiles: 0, batches: 0 },
    };
  }

  // ============ 步骤 2：解析 diff ============
  log(`${colors.gray}  正在解析差异文件...${colors.reset}`);
  const allFiles = parseDiff(diffOutput);
  log(`  发现 ${allFiles.length} 个文件变更`);

  if (allFiles.length === 0) {
    return {
      report: '变更文件中没有需要审查的代码文件。',
      summary: { totalFiles: 0, reviewedFiles: 0, batches: 0 },
    };
  }

  // ============ 步骤 3：分批处理 ============
  const batches = splitIntoBatches(allFiles);
  log(`  分为 ${batches.length} 批发送给 AI 分析\n`);

  // ============ 步骤 4：逐批发送 AI 分析 ============
  const results = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchContent = concatBatch(batch);
    const batchFiles = batch.map((f) => f.file);

    log(`  ${colors.cyan}正在分析第 ${i + 1}/${batches.length} 批...${colors.reset}`);
    log(`    包含文件：${colors.gray}${batchFiles.join(', ')}${colors.reset}`);

    try {
      const reviewText = await callAIReview(batchContent, sourceBranch, targetBranch);
      results.push({
        batchIndex: i + 1,
        files: batchFiles,
        review: reviewText,
      });
    } catch (e) {
      log(`  ${colors.yellow}⚠️  第 ${i + 1} 批分析失败: ${e.message}${colors.reset}`);
      results.push({
        batchIndex: i + 1,
        files: batchFiles,
        review: `[分析失败] ${e.message}`,
      });
    }
  }

  // ============ 步骤 5：汇总报告 ============
  const report = formatReviewReport(results, sourceBranch, targetBranch, allFiles);

  return {
    report,
    summary: {
      totalFiles: allFiles.length,
      reviewedFiles: allFiles.length,
      batches: batches.length,
      totalAdditions: allFiles.reduce((sum, f) => sum + f.additions, 0),
      totalDeletions: allFiles.reduce((sum, f) => sum + f.deletions, 0),
    },
  };
}

/**
 * 格式化审查报告为易读的文本
 *
 * 对 AI 返回的代码修改建议中的 + / - / = 标记进行颜色渲染：
 *   + 开头 → 绿色（新增/修改的代码）
 *   - 开头 → 红色（删除的代码）
 *   = 开头 → 灰色（保留不变的上下文代码）
 *
 * @param {Array<{batchIndex: number, files: string[], review: string}>} results
 * @param {string} sourceBranch - 源分支
 * @param {string} targetBranch - 目标分支
 * @param {Array} allFiles - 所有文件
 * @returns {string} 带 ANSI 颜色的格式化的报告文本
 */
function formatReviewReport(results, sourceBranch, targetBranch, allFiles) {
  const totalAdditions = allFiles.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = allFiles.reduce((sum, f) => sum + f.deletions, 0);

  // 构建报告头部
  const header = [
    `${colors.cyan}${'='.repeat(60)}${colors.reset}`,
    `${colors.bold}${colors.cyan}代码审查报告${colors.reset}`,
    `${colors.cyan}${'='.repeat(60)}${colors.reset}`,
    ``,
    `源分支：${colors.yellow}${sourceBranch}${colors.reset}`,
    `目标分支：${colors.yellow}${targetBranch}${colors.reset}`,
    `变更文件：${colors.bold}${allFiles.length}${colors.reset} 个`,
    `变更行数：${colors.green}+${totalAdditions}${colors.reset} / ${colors.red}-${totalDeletions}${colors.reset}`,
    `审查批次：${results.length} 批`,
    ``,
    `${colors.gray}${'─'.repeat(60)}${colors.reset}`,
    ``,
  ].join('\n');

  // 构建每批的审查结果
  const sections = results
    .map((result, index) => {
      const batchHeader = [
        `${colors.cyan}📋 第 ${result.batchIndex} 批审查${colors.reset}`,
        `   文件：${colors.gray}${result.files.join(', ')}${colors.reset}`,
        ``,
      ].join('\n');

      // 对审查内容中的代码建议行进行颜色渲染
      // + 开头 → 绿色  - 开头 → 红色  = 开头 → 灰色
      const coloredReview = result.review
        .split('\n')
        .map((line) => {
          // 匹配 "建议：" 后面代码块中以 + / - / = 开头的行
          if (/^\s*\+\s/.test(line)) {
            // 新增代码 → 绿色
            return `${colors.green}${line}${colors.reset}`;
          }
          if (/^\s*-\s/.test(line)) {
            // 删除代码 → 红色
            return `${colors.red}${line}${colors.reset}`;
          }
          if (/^\s*=\s/.test(line)) {
            // 上下文代码 → 灰色
            return `${colors.gray}${line}${colors.reset}`;
          }
          // 其他行保持原样
          return line;
        })
        .join('\n');

      return batchHeader + coloredReview;
    })
    .join(`\n${colors.gray}${'─'.repeat(60)}${colors.reset}\n\n`);

  // 构建报告尾部
  const footer = [
    ``,
    `${colors.gray}${'─'.repeat(60)}${colors.reset}`,
    ``,
    `${colors.bold}📊 统计：${colors.reset}`,
    `  - 变更文件：${colors.bold}${allFiles.length}${colors.reset} 个`,
    `  - 新增行数：${colors.green}+${totalAdditions}${colors.reset}`,
    `  - 删除行数：${colors.red}-${totalDeletions}${colors.reset}`,
    `  - 审查批次：${results.length} 批`,
    ``,
    `${colors.cyan}${'='.repeat(60)}${colors.reset}`,
    `${colors.green}审查完成 ✅${colors.reset}`,
  ].join('\n');

  return header + sections + footer;
}

// ============ 平台 API 评论 ============

/**
 * 通过平台 API 将审查报告以评论形式发送到 PR/MR 页面
 *
 * @param {Object} options - 评论选项
 * @param {string} options.platform - 平台标识：github/gitlab/gitee
 * @param {string} options.repoUrl - 仓库地址
 * @param {number} options.prNumber - PR/MR 编号
 * @param {string} options.report - 审查报告文本
 * @param {string} options.token - 平台 API Token
 * @returns {Promise<boolean>} 是否评论成功
 */
async function postReviewComment({ platform, repoUrl, prNumber, report, token }) {
  const https = require('https');

  // 根据平台构建 API 请求
  let apiUrl, body;
  if (platform === 'github') {
    // GitHub API: POST /repos/{owner}/{repo}/issues/{pr}/comments
    const repoMatch = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (!repoMatch) throw new Error(`无法解析 GitHub 仓库地址: ${repoUrl}`);
    const owner = repoMatch[1];
    const repo = repoMatch[2];
    apiUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`;
    body = JSON.stringify({ body: report });
  } else if (platform === 'gitlab') {
    // GitLab API: POST /projects/{id}/merge_requests/{mr}/notes
    // GitLab 需要对项目路径做 URL 编码
    const repoMatch = repoUrl.match(/gitlab\.com[/:](.+?)(?:\.git)?$/);
    if (!repoMatch) throw new Error(`无法解析 GitLab 仓库地址: ${repoUrl}`);
    const projectPath = encodeURIComponent(repoMatch[1]);
    apiUrl = `https://gitlab.com/api/v4/projects/${projectPath}/merge_requests/${prNumber}/notes`;
    body = JSON.stringify({ body: report });
  } else if (platform === 'gitee') {
    // Gitee API: POST /repos/{owner}/{repo}/pulls/{pr}/comments
    const repoMatch = repoUrl.match(/gitee\.com\/([^/]+)\/([^/.]+)/);
    if (!repoMatch) throw new Error(`无法解析 Gitee 仓库地址: ${repoUrl}`);
    const owner = repoMatch[1];
    const repo = repoMatch[2];
    apiUrl = `https://gitee.com/api/v5/repos/${owner}/${repo}/pulls/${prNumber}/comments`;
    body = JSON.stringify({ body: report });
  } else {
    throw new Error(`不支持的平台: ${platform}`);
  }

  const url = new URL(apiUrl);

  // 发送 API 请求
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'git-commit-gen-review-bot',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(true);
          } else {
            reject(new Error(`API 请求失败 HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', (e) => reject(new Error(`网络请求失败: ${e.message}`)));
    req.write(body);
    req.end();
  });
}

module.exports = {
  reviewCode,
  parseDiff,
  splitIntoBatches,
  concatBatch,
  callAIReview,
  formatReviewReport,
  detectPlatform,
  parseWebhookBody,
  postReviewComment,
};
