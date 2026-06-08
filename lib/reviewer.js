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

// ============ JSON 修复工具 ============

/**
 * 修复 AI 返回的 JSON 中未正确转义的换行符
 * 在 JSON 字符串值内部，将裸换行符替换为 \\n 转义序列
 */
function fixJsonNewlines(jsonStr) {
  let result = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const ch = jsonStr[i];

    if (escape) {
      result += ch;
      escape = false;
      continue;
    }

    if (ch === '\\') {
      result += ch;
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }

    if (inString) {
      if (ch === '\n') {
        result += '\\n';
      } else if (ch === '\r') {
        if (jsonStr[i + 1] === '\n') {
          i++;
        }
        result += '\\n';
      } else if (ch === '\t') {
        result += '\\t';
      } else {
        result += ch;
      }
    } else {
      result += ch;
    }
  }

  return result;
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
 * AI 返回 JSON 数组格式，每条建议包含评分、文件路径、行号、问题和优化代码。
 * 这种结构化输出便于在 GitHub Files changed 页面发布"行内评论"。
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
1. 🔴 严重问题（8-10分）：逻辑错误、运行时崩溃、安全漏洞（SQL注入、XSS、未处理异常、敏感信息泄露）
2. 🟡 一般问题（6-7分）：性能瓶颈、内存泄漏、资源未释放、竞态条件、错误处理缺失
3. 💡 优化建议（1-5分）：代码可读性、可维护性、设计模式、重复代码、命名规范

评分规则：
- 8-10分：严重问题，必须修复
- 6-7分：一般问题，建议修复
- 1-5分：优化建议，不强制修改但仍值得关注

输出格式：你必须返回一个 JSON 数组，每个元素是一条审查建议。格式如下：

\`\`\`json
[
  {
    "score": 9,
    "level": "critical",
    "file": "src/auth.js",
    "line": 42,
    "endLine": 48,
    "title": "SQL 注入风险",
    "reason": "用户输入未做任何校验直接拼接到 SQL 语句中，攻击者可构造恶意输入获取数据库权限。",
    "suggestion": "使用参数化查询代替字符串拼接：\\n\\n\`\`\`javascript\\nasync function getUserById(userId) {\\n  const db = await getConnection();\\n  const sql = 'SELECT * FROM users WHERE id = ?';\\n  return db.query(sql, [userId]);\\n}\\n\`\`\`"
  },
  {
    "score": 7,
    "level": "warning",
    "file": "src/utils.js",
    "line": 15,
    "endLine": 20,
    "title": "循环内重复计算",
    "reason": "每次迭代都重新计算价格，当数据量较大时浪费 CPU。",
    "suggestion": "将计算提取到循环外：\\n\\n\`\`\`javascript\\nconst price = calculatePrice(item);\\ntotal += price * 1.2;\\n\`\`\`"
  },
  {
    "score": 3,
    "level": "suggestion",
    "file": "src/index.js",
    "line": 8,
    "title": "变量命名不够清晰",
    "reason": "d 和 tmp 含义模糊，降低代码可读性。",
    "suggestion": "使用有意义的变量名：\\n\\n\`\`\`javascript\\nconst currentDate = new Date();\\nconst activeItems = data.filter(item => item.active);\\n\`\`\`"
  }
]
\`\`\`

重要规则：
- 必须返回有效的 JSON 数组，不要有其他文字
- file 必须是 diff 中出现的真实文件路径
- line 和 endLine 给出行号即可（diff hunk 中 @@ 后面的 +数字 是新文件起始行号，可作为参考）
- suggestion 中的代码建议用 markdown 代码块包裹，指定语言（如 \`\`\`javascript）
- 如果没有值得提出的问题，返回空数组 []
- 每个问题必须给出行号`,
    },
    {
      role: 'user',
      content: `请审查从 ${targetBranch} 合并到 ${sourceBranch} 的代码变更：

\`\`\`diff
${diffContent.slice(0, 20000)}
\`\`\`

请逐文件分析，返回 JSON 数组。`,
    },
  ];
}

/**
 * 调用 AI API 审查一批代码差异
 *
 * AI 返回 JSON 数组格式的审查建议，解析后返回结构化数据。
 *
 * @param {string} diffContent - 拼接后的 diff 内容
 * @param {string} sourceBranch - 源分支名
 * @param {string} targetBranch - 目标分支名
 * @returns {Promise<Object[]>} 结构化的审查建议列表，每项包含 score/file/line/title/reason/suggestion
 */
async function callAIReview(diffContent, sourceBranch, targetBranch) {
  const config = loadConfig();
  const apiKey = getApiKey(config);

  if (!apiKey) {
    throw new Error('未配置 AI API Key，请设置环境变量 OPENAI_API_KEY 或在 .sgcrc.json 中配置 apiKey');
  }

  // 动态引入 https 模块
  const https = require('https');

  const baseUrl = new URL(config.aiBaseUrl);
  const pathname = baseUrl.pathname.replace(/\/$/, '') + '/chat/completions';
  const url = new URL(pathname, baseUrl.origin);

  const messages = buildReviewPrompt(diffContent, sourceBranch, targetBranch);

  const body = JSON.stringify({
    model: config.aiModel,
    messages,
    temperature: 0.3,   // 降低温度，让 JSON 输出更稳定
    max_tokens: 8000,    // 增加 token，确保 JSON 数组完整
  });

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

  const rawContent = response.choices?.[0]?.message?.content?.trim() || '[]';

  console.log(`\n${colors.gray}========== AI 原始输出 ==========${colors.reset}`);
  console.log(rawContent);
  console.log(`${colors.gray}==================================${colors.reset}\n`);

  // 解析 AI 返回的 JSON，处理可能被 markdown 代码块包裹的情况
  let jsonStr = rawContent;
  // 用贪婪匹配 .* 确保匹配到最后一个 ```，因为 suggestion 字段内可能也包含 markdown 代码块
  const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  // 修复 AI 返回 JSON 中未正确转义的换行符
  jsonStr = fixJsonNewlines(jsonStr);

  try {
    const suggestions = JSON.parse(jsonStr);
    if (!Array.isArray(suggestions)) {
      return [];
    }
    return suggestions;
  } catch (e) {
    // 解析失败时返回空数组
    console.error('解析 AI 返回的 JSON 失败，将使用原始文本格式');
    return [{ _raw: rawContent }];
  }
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
 * 支持两种数据格式：
 * 1. 结构化 JSON 数组（新格式，推荐）：每条建议包含 score/file/line/title/reason/suggestion
 * 2. 原始文本（旧格式兼容）：直接用 AI 返回的原始文本
 *
 * @param {Array<{batchIndex: number, files: string[], review: string|Object[]}>} results
 * @param {string} sourceBranch - 源分支
 * @param {string} targetBranch - 目标分支
 * @param {Array} allFiles - 所有文件
 * @returns {string} 带 ANSI 颜色的格式化的报告文本
 */
function formatReviewReport(results, sourceBranch, targetBranch, allFiles) {
  const totalAdditions = allFiles.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = allFiles.reduce((sum, f) => sum + f.deletions, 0);

  const header = [
    `${colors.cyan}${'='.repeat(60)}${colors.reset}`,
    `${colors.bold}${colors.cyan}代码审查报告${colors.reset}`,
    `${colors.cyan}${'='.repeat(60)}${colors.reset}`,
    ``,
    `源分支：${colors.yellow}${sourceBranch}${colors.reset}`,
    `目标分支：${colors.yellow}${targetBranch}${colors.reset}`,
    `变更文件：${colors.bold}${allFiles.length}${colors.reset} 个`,
    `变更行数：${colors.green}+${totalAdditions}${colors.reset} / ${colors.red}-${totalDeletions}${colors.reset}`,
    ``,
    `${colors.gray}${'─'.repeat(60)}${colors.reset}`,
    ``,
  ].join('\n');

  const levelIcon = { critical: '🔴', warning: '🟡', suggestion: '💡' };
  const levelLabel = { critical: '严重问题', warning: '一般问题', suggestion: '优化建议' };

  // 收集所有审查建议
  const allSuggestions = [];
  for (const result of results) {
    const reviewData = result.review;

    // 如果已经是结构化数组（新格式）
    if (Array.isArray(reviewData)) {
      for (const item of reviewData) {
        if (item._raw) {
          // 解析失败的回退原始文本
          allSuggestions.push({ _raw: item._raw, batchIndex: result.batchIndex, files: result.files });
        } else {
          allSuggestions.push({ ...item, batchIndex: result.batchIndex, files: result.files });
        }
      }
    }
    // 如果还是原始文本（旧格式兼容）
    else if (typeof reviewData === 'string') {
      allSuggestions.push({ _raw: reviewData, batchIndex: result.batchIndex, files: result.files });
    }
  }

  // 按评分从高到低排序
  allSuggestions.sort((a, b) => (b.score || 0) - (a.score || 0));

  if (allSuggestions.length === 0) {
    return header + `${colors.green}✨ 未发现需要优化的代码问题，代码质量良好！${colors.reset}\n` +
      `\n${colors.cyan}${'='.repeat(60)}${colors.reset}\n审查完成 ✅`;
  }

  // 格式化每条建议
  const sections = allSuggestions.map((item, index) => {
    if (item._raw) {
      // 旧格式：直接输出原始文本
      return item._raw;
    }

    // 新格式：结构化渲染
    const icon = levelIcon[item.level] || '💡';
    const label = levelLabel[item.level] || '建议';
    const lineInfo = item.endLine && item.endLine !== item.line
      ? `${item.line}-${item.endLine}`
      : `${item.line}`;

    return [
      `${colors.cyan}${'─'.repeat(50)}${colors.reset}`,
      `${icon} ${colors.bold}【评分 ${item.score}/10】${label}${colors.reset}`,
      `${colors.yellow}📁 ${item.file}:${lineInfo}${colors.reset}`,
      ``,
      `${colors.bold}问题：${colors.reset}${item.title || ''}`,
      `${colors.gray}原因：${colors.reset}${item.reason || ''}`,
      ``,
      item.suggestion
        ? `${colors.bold}优化建议：${colors.reset}\n${item.suggestion}`
        : '',
    ].join('\n');
  });

  const footer = [
    ``,
    `${colors.gray}${'─'.repeat(60)}${colors.reset}`,
    ``,
    `${colors.bold}📊 统计：${colors.reset}`,
    `  - 变更文件：${colors.bold}${allFiles.length}${colors.reset} 个`,
    `  - 新增行数：${colors.green}+${totalAdditions}${colors.reset}`,
    `  - 删除行数：${colors.red}-${totalDeletions}${colors.reset}`,
    `  - 审查建议：${colors.bold}${allSuggestions.length}${colors.reset} 条`,
    ``,
    `${colors.cyan}${'='.repeat(60)}${colors.reset}`,
    `${colors.green}审查完成 ✅${colors.reset}`,
  ].join('\n');

  return header + sections.join('\n\n') + footer;
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
