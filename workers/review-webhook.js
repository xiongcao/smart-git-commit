// ============ Cloudflare Worker - 代码审查 Webhook 服务 ============
// 部署在 Cloudflare Workers 上，接收 GitHub/GitLab/Gitee 的 Webhook 事件，
// 自动进行代码审查并将结果以"行内评论（Review Comment）"形式发布到 PR/MR 的 Files changed 页面。
//
// 部署步骤：
// 1. 安装 wrangler：npm install -g wrangler
// 2. 登录：wrangler login
// 3. 设置密钥：
//    wrangler secret put DASHSCOPE_API_KEY --name git-review-bot
//    wrangler secret put GITHUB_TOKEN --name git-review-bot
// 4. 部署：wrangler deploy
// 5. 在平台配置 Webhook URL: https://xxx.workers.dev

// ============ 配置常量 ============

// 单条行内评论的最大字符数
const MAX_COMMENT_LENGTH = 30000;

// ============ 平台检测 ============

function detectPlatform(request) {
  if (request.headers.get('X-GitHub-Event')) return 'github';
  if (request.headers.get('X-Gitlab-Event')) return 'gitlab';
  if (request.headers.get('X-Gitee-Event')) return 'gitee';
  return 'unknown';
}

// ============ Webhook 解析 ============

/**
 * 从 Webhook 请求体中提取 PR/MR 信息，包含 commit_id（行内评论必需）
 */
function parseWebhook(body, platform) {
  if (platform === 'github') {
    const pr = body.pull_request || {};
    return {
      action: body.action || '',
      sourceBranch: pr.head?.ref || '',
      targetBranch: pr.base?.ref || '',
      prNumber: pr.number || 0,
      prTitle: pr.title || '',
      repoFullName: body.repository?.full_name || '',
      // GitHub 行内评论需要 commit_id（PR head 的最新 commit SHA）
      commitId: pr.head?.sha || '',
    };
  }

  if (platform === 'gitlab') {
    const attrs = body.object_attributes || {};
    return {
      action: attrs.action || body.event_type || '',
      sourceBranch: attrs.source_branch || '',
      targetBranch: attrs.target_branch || '',
      prNumber: attrs.iid || 0,
      prTitle: attrs.title || '',
      repoFullName: body.project?.path_with_namespace || '',
      commitId: attrs.last_commit?.id || '',
    };
  }

  if (platform === 'gitee') {
    const pr = body.pull_request || {};
    return {
      action: body.action || '',
      sourceBranch: pr.head?.ref || '',
      targetBranch: pr.base?.ref || '',
      prNumber: pr.number || 0,
      prTitle: pr.title || '',
      repoFullName: body.repository?.full_name || '',
      commitId: pr.head?.sha || '',
    };
  }

  return null;
}

function isPREvent(action, platform) {
  if (platform === 'github') {
    return action === 'opened' || action === 'synchronize';
  }
  if (platform === 'gitlab') {
    return action === 'open' || action === 'update' || action === 'reopen';
  }
  if (platform === 'gitee') {
    return action === 'open' || action === 'update';
  }
  return false;
}

// ============ JSON 修复工具 ============

/**
 * 修复 AI 返回的 JSON 中未正确转义的换行符
 *
 * 问题：AI 有时会在 suggestion 等字段中输出实际换行而非 \\n 转义序列，
 * 导致 JSON.parse 报 "Bad control character" 错误。
 *
 * 解决：在 JSON 字符串值内部（引号之间），将裸换行符替换为 \\n 转义序列。
 * 通过状态机区分 JSON 结构字符（{, }, [, ], :, ,）和字符串内容。
 *
 * @param {string} jsonStr - 可能有未转义换行的 JSON 字符串
 * @returns {string} 修复后的 JSON 字符串
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

    // 在 JSON 字符串内部，将裸换行和回车替换为转义序列
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

/**
 * 修复被截断的 JSON 数组
 *
 * AI 输出可能因为 max_tokens 限制被截断，导致 JSON 不完整。
 * 找到最后一个完整的对象，截掉不完整的部分。
 *
 * 注意：此函数处理的是 fixJsonNewlines() 之后的 JSON（换行已转义）。
 *
 * @param {string} jsonStr - 可能被截断的 JSON 数组字符串（换行已转义）
 * @returns {string|null} 修复后的 JSON 字符串，无法修复返回 null
 */
function repairTruncatedJson(jsonStr) {
  if (!jsonStr.startsWith('[')) return null;

  // 关键：找到所有完整闭合的对象。
  // 对象结束的标志是：在 inString=false 时遇到 } 且 depth 变为 0。
  // 如果字符串未闭合（inString=true 到结尾），该对象不算完整。

  let inString = false;
  let escape = false;
  let depth = 0;
  let objDepth = 0;
  let lastCompleteObjectEnd = -1;

  for (let i = 0; i < jsonStr.length; i++) {
    const ch = jsonStr[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\') {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (ch === '{') {
        objDepth++;
        if (objDepth === 1) {
          depth = 0; // 新对象开始
        }
      }
      if (ch === '}') {
        if (objDepth > 0) {
          objDepth--;
          if (objDepth === 0) {
            lastCompleteObjectEnd = i;
          }
        }
      }
    }
  }

  if (lastCompleteObjectEnd > 0) {
    const repaired = jsonStr.slice(0, lastCompleteObjectEnd + 1) + ']';
    return repaired;
  }

  return null;
}

// ============ AI 审查调用 ============

/**
 * 调用 AI API 进行代码审查
 *
 * AI 返回 JSON 数组格式，每条建议包含：
 * - score: 评分 0-10
 * - level: "critical" | "warning" | "suggestion"
 * - file: 文件路径
 * - line: 起始行号
 * - endLine: 结束行号（可选）
 * - title: 问题标题
 * - reason: 问题原因
 * - suggestion: 优化后的代码（markdown 代码块格式）
 *
 * @returns {Promise<Object[]>} 结构化的审查建议列表
 */
async function callAIReview(diffContent, prInfo, env) {
  const apiKey = env.DASHSCOPE_API_KEY || env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY || env.DEEPSEEK_API_KEY || '';

  if (!apiKey) {
    throw new Error('未配置 AI API Key');
  }

  const aiBaseUrl = env.AI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const aiModel = env.AI_MODEL || 'qwen-turbo';

  const truncatedDiff = diffContent.slice(0, 30000);

  const messages = [
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
- suggestion 字段中的代码建议用 markdown 代码块包裹，指定语言（如 \`\`\`javascript）
- 如果没有值得提出的问题，返回空数组 []
- 每个问题必须给出行号`,
    },
    {
      role: 'user',
      content: `请审查以下 PR 的代码变更：

PR 标题：${prInfo.prTitle}
源分支：${prInfo.sourceBranch}
目标分支：${prInfo.targetBranch}

代码差异：
\`\`\`diff
${truncatedDiff}
\`\`\`

请逐文件分析，返回 JSON 数组。`,
    },
  ];

  const url = new URL(aiBaseUrl);
  url.pathname = url.pathname.replace(/\/$/, '') + '/chat/completions';

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: aiModel,
      messages,
      temperature: 0.3,   // 降低温度，让 JSON 输出更稳定
      max_tokens: 8000,    // 增加 token，确保 JSON 数组完整
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI API 错误 HTTP ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || 'AI API 请求失败');
  }

  const rawContent = data.choices?.[0]?.message?.content?.trim() || '[]';

  console.log('========== AI 原始输出 ==========');
  console.log(rawContent);
  console.log('==================================');

  // 解析 AI 返回的 JSON，处理可能被 markdown 代码块包裹的情况
  let jsonStr = rawContent;
  // 去掉可能的 markdown 代码块包裹
  // 用贪婪匹配 .* 确保匹配到最后一个 ```，因为 suggestion 字段内可能也包含 markdown 代码块
  const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  // 修复 AI 返回 JSON 中未正确转义的换行符
  // AI 有时会在 JSON 字符串值中输出实际换行而不是 \\n，导致 JSON.parse 失败
  const fixedJsonStr = fixJsonNewlines(jsonStr);
  if (fixedJsonStr !== jsonStr) {
    console.log('修复了 JSON 中的未转义换行符');
  }

  try {
    const suggestions = JSON.parse(fixedJsonStr);
    if (!Array.isArray(suggestions)) {
      console.error('AI 返回的不是数组:', fixedJsonStr.slice(0, 200));
      return [];
    }
    console.log(`AI 返回 ${suggestions.length} 条建议`);
    return suggestions;
  } catch (e) {
    // 如果完整 JSON 解析失败，尝试修复被截断的 JSON
    // AI 输出可能因为 max_tokens 限制被截断，导致最后一个元素不完整
    console.error('完整 JSON 解析失败，尝试修复截断:', e.message);
    const repairedJson = repairTruncatedJson(fixedJsonStr);
    if (repairedJson) {
      try {
        const suggestions = JSON.parse(repairedJson);
        if (Array.isArray(suggestions) && suggestions.length > 0) {
          console.log(`截断修复成功，恢复 ${suggestions.length} 条建议`);
          return suggestions;
        }
      } catch (e2) {
        console.error('截断修复也失败:', e2.message);
        console.error('修复后 JSON 尾部:', repairedJson.slice(-200));
      }
    } else {
      console.error('repairTruncatedJson 返回 null，无法修复');
    }

    console.error('解析 AI 返回的 JSON 失败，修复后内容:', fixedJsonStr.slice(0, 400));
    console.error('原始内容长度:', rawContent.length);
    console.error('原始内容长度:', rawContent.length);
    return [];
  }
}

// ============ 获取 diff 和文件信息 ============

/**
 * 获取 PR 的 diff 内容（同时获取 PR 的 files 信息用于行内评论）
 *
 * 返回 { diffContent, files }，其中 files 包含每个变更文件的详细信息
 */
async function fetchPRDiff(prInfo, platform, env) {
  const tokens = {
    github: env.GITHUB_TOKEN || '',
    gitlab: env.GITLAB_TOKEN || '',
    gitee: env.GITEE_TOKEN || '',
  };
  const token = tokens[platform];

  if (!token) {
    throw new Error(`未配置 ${platform} API Token`);
  }

  if (platform === 'github') {
    // 同时获取 diff 文本和文件列表
    const [diffResponse, filesResponse] = await Promise.all([
      fetch(`https://api.github.com/repos/${prInfo.repoFullName}/pulls/${prInfo.prNumber}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3.diff',
          'User-Agent': 'git-review-bot',
        },
      }),
      fetch(`https://api.github.com/repos/${prInfo.repoFullName}/pulls/${prInfo.prNumber}/files`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'git-review-bot',
        },
      }),
    ]);

    if (!diffResponse.ok) {
      const err = await diffResponse.text();
      throw new Error(`获取 diff 失败 HTTP ${diffResponse.status}: ${err.slice(0, 200)}`);
    }

    const diffContent = await diffResponse.text();
    const files = filesResponse.ok ? await filesResponse.json() : [];

    return { diffContent, files };
  }

  // GitLab
  if (platform === 'gitlab') {
    const projectId = encodeURIComponent(prInfo.repoFullName);
    const response = await fetch(
      `https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${prInfo.prNumber}/changes`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`获取 diff 失败 HTTP ${response.status}: ${err.slice(0, 200)}`);
    }

    const data = await response.json();
    const changes = data.changes || [];
    const diffContent = changes
      .map((c) => `diff --git a/${c.old_path} b/${c.new_path}\n${c.diff || ''}`)
      .join('\n');
    const files = changes.map((c) => ({
      filename: c.new_path,
      patch: c.diff || '',
      additions: 0,
      deletions: 0,
      changes: 0,
    }));

    return { diffContent, files };
  }

  // Gitee
  if (platform === 'gitee') {
    const response = await fetch(
      `https://gitee.com/api/v5/repos/${prInfo.repoFullName}/pulls/${prInfo.prNumber}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`获取 diff 失败 HTTP ${response.status}: ${err.slice(0, 200)}`);
    }

    const data = await response.json();
    const files = data.files || [];
    const diffContent = files
      .map((f) => `diff --git a/${f.filename} b/${f.filename}\n${f.patch || ''}`)
      .join('\n');

    return { diffContent, files };
  }

  throw new Error(`不支持的平台: ${platform}`);
}

// ============ 行内评论 ============

/**
 * 从 git diff 的 patch 中计算新文件的实际行号
 *
 * AI 返回的 line 通常是 diff 中变更行的序号（第几个 "+" 行或上下文行）。
 * 此函数遍历 diff hunk，找到对应位置在新文件中的真实行号。
 *
 * Git diff hunk header 格式：@@ -oldStart,oldCount +newStart,newCount @@
 * "+" 开头或空格开头的上下文行：新文件行号递增
 * "-" 开头：删除行，新文件行号不变
 *
 * @param {string} patch - 单个文件的 diff patch
 * @param {number} targetLine - AI 返回的 line 值
 * @returns {number} 新文件中的真实行号
 */
function resolveLineNumber(patch, targetLine) {
  if (!patch || targetLine <= 0) return targetLine;

  const lines = patch.split('\n');
  // 收集所有在新文件中存在的行号映射：[{ diffIndex, fileLine }]
  const fileLineMap = [];
  let inHunk = false;
  let fileLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 跳过 diff 头部行
    if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      continue;
    }

    // 匹配 hunk header
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      fileLine = parseInt(hunkMatch[1], 10);
      inHunk = true;
      // hunk header 本身不映射到文件行，跳过
      continue;
    }

    if (!inHunk) continue;

    // "+" 开头：新增行，文件行号递增
    if (line.startsWith('+') && !line.startsWith('+++')) {
      fileLineMap.push({ diffIndex: i, fileLine });
      fileLine++;
    }
    // "-" 开头：删除行，新文件行号不变
    else if (line.startsWith('-') && !line.startsWith('---')) {
      // 不加入映射，也不递增文件行号
    }
    // 上下文行（空格开头或其他）：文件行号递增
    else if (line.startsWith(' ') || (!line.startsWith('@@') && line.trim() !== '')) {
      fileLineMap.push({ diffIndex: i, fileLine });
      fileLine++;
    }
    // 空行也是上下文
    else if (line === '') {
      fileLineMap.push({ diffIndex: i, fileLine });
      fileLine++;
    }
  }

  // targetLine 作为序号索引（从 1 开始），从映射中获取真实文件行号
  if (fileLineMap.length > 0 && targetLine <= fileLineMap.length) {
    return fileLineMap[targetLine - 1].fileLine;
  }

  // 如果找不到映射，回退：返回 targetLine（可能是 AI 已经给了正确行号的情况）
  return targetLine;
}

/**
 * 从 git diff 的 patch 中计算 Gitee 需要的 diff position
 *
 * Gitee 的 position 参数表示 diff hunk 内的位置偏移量（从 1 开始），不是文件行号。
 * AI 返回的 line 作为 diff 中变更行的序号，对应到 position。
 *
 * @param {string} patch - 单个文件的 diff patch
 * @param {number} targetLine - AI 返回的 line 值（diff 中变更行的序号，从 1 开始）
 * @returns {number} Gitee API 需要的 diff position（从 1 开始）
 */
function resolveGiteePosition(patch, targetLine) {
  if (!patch || targetLine <= 0) return targetLine;

  const lines = patch.split('\n');
  let position = 0;

  for (const line of lines) {
    // 跳过 diff 头部行（这些不计入 position）
    if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      continue;
    }

    // hunk header 计入 position
    position++;

    // 如果当前 position 等于 targetLine，返回
    if (position === targetLine) return position;
  }

  return targetLine;
}

/**
 * 将审查建议发布为行内评论（Review Comment），挂在具体代码行上
 *
 * GitHub API: POST /repos/{owner}/{repo}/pulls/{pr}/comments
 * 需要: body, commit_id, path, line, side
 *
 * @param {Object} prInfo - PR 信息（含 commitId）
 * @param {string} platform - 平台标识
 * @param {Object[]} suggestions - AI 审查建议列表
 * @param {Object[]} files - PR 变更文件列表（含 patch 用于计算行号）
 * @param {Object} env - 环境变量
 */
async function postReviewComments(prInfo, platform, suggestions, files, env) {
  const tokens = {
    github: env.GITHUB_TOKEN || '',
    gitlab: env.GITLAB_TOKEN || '',
    gitee: env.GITEE_TOKEN || '',
  };
  const token = tokens[platform];

  if (!token) {
    throw new Error(`未配置 ${platform} API Token`);
  }

  if (!suggestions || suggestions.length === 0) {
    console.log('没有审查建议需要发布');
    return { posted: 0, total: 0 };
  }

  const levelIcon = {
    critical: '🔴',
    warning: '🟡',
    suggestion: '💡',
  };

  const levelLabel = {
    critical: '严重问题',
    warning: '一般问题',
    suggestion: '优化建议',
  };

  let postedCount = 0;
  const totalCount = suggestions.length;

  for (const item of suggestions) {
    const score = item.score || 0;
    const file = item.file || '';
    const line = item.line || 1;
    const endLine = item.endLine || line;
    const title = item.title || '';
    const reason = item.reason || '';
    const rawSuggestion = item.suggestion || '';
    const icon = levelIcon[item.level] || '💡';
    const label = levelLabel[item.level] || '建议';

    // 将 suggestion 中的 markdown 代码块替换为 4 空格缩进，避免破坏评论外层格式
    const cleanedSuggestion = rawSuggestion.replace(
      /```(\w*)\n([\s\S]*?)```/g,
      (_, lang, code) => `\n    ${code.replace(/\n/g, '\n    ')}\n`
    );

    // 找到对应文件的 patch，用于将 AI 的行号转为真实文件行号
    const fileInfo = files.find(
      (f) => f.filename === file || f.filename?.endsWith(file)
    );
    const patch = fileInfo?.patch || '';

    // AI 返回的 line 是 diff 中变更行的序号，通过 patch 计算真实文件行号
    const resolvedLine = resolveLineNumber(patch, line);
    const resolvedEndLine = endLine > line ? resolveLineNumber(patch, endLine) : resolvedLine;

    // 构建行内评论内容（markdown 格式）
    const commentBody = [
      `**${icon} ${label} · 评分 ${score}/10**`,
      '',
      `**${title}**`,
      '',
      `> ${reason}`,
      '',
      cleanedSuggestion ? `**优化建议：**\n${cleanedSuggestion}` : '',
    ].filter(Boolean).join('\n');

    // 截断过长内容
    const truncatedBody = commentBody.length > MAX_COMMENT_LENGTH
      ? commentBody.slice(0, MAX_COMMENT_LENGTH) + '\n\n...（内容过长，已截断）'
      : commentBody;

    try {
      if (platform === 'github') {
        const apiUrl = `https://api.github.com/repos/${prInfo.repoFullName}/pulls/${prInfo.prNumber}/comments`;
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'User-Agent': 'git-review-bot',
            // 使用 GraphQL 或 REST API 都需要 Accept
            Accept: 'application/vnd.github.v3+json',
          },
          body: JSON.stringify({
            body: truncatedBody,
            commit_id: prInfo.commitId,
            path: file,
            line: resolvedLine,          // 通过 patch 计算的真实文件行号
            side: 'RIGHT',    // RIGHT = 新代码侧（PR 变更后）
            // 如果是多行评论，添加 start_line
            ...(resolvedEndLine > resolvedLine ? {
              start_line: resolvedLine,
              start_side: 'RIGHT',
            } : {}),
          }),
        });

        if (response.ok) {
          postedCount++;
          console.log(`✅ 行内评论已发布: ${file}:${resolvedLine} "${title}"`);
        } else {
          const err = await response.text();
          console.error(`❌ 发布行内评论失败: ${file}:${resolvedLine} HTTP ${response.status} ${err.slice(0, 200)}`);
        }
      } else if (platform === 'gitlab') {
        // GitLab 行内评论 API
        const projectId = encodeURIComponent(prInfo.repoFullName);
        const apiUrl = `https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${prInfo.prNumber}/discussions`;
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            body: truncatedBody,
            position: {
              base_sha: prInfo.commitId,
              start_sha: prInfo.commitId,
              head_sha: prInfo.commitId,
              position_type: 'text',
              new_path: file,
              new_line: resolvedLine,    // 通过 patch 计算的真实文件行号
            },
          }),
        });

        if (response.ok) {
          postedCount++;
          console.log(`✅ GitLab 行内评论已发布: ${file}:${resolvedLine}`);
        } else {
          const err = await response.text();
          console.error(`❌ GitLab 行内评论失败: ${file}:${resolvedLine} HTTP ${response.status}`);
        }
      } else if (platform === 'gitee') {
        // Gitee 行内评论 API
        // Gitee 的 position 参数表示 diff 中的位置偏移量（从 1 开始），不是文件行号
        const fileInfo = files.find(
          (f) => f.filename === file || f.filename?.endsWith(file)
        );
        const giteePosition = resolveGiteePosition(fileInfo?.patch || '', line);
        const apiUrl = `https://gitee.com/api/v5/repos/${prInfo.repoFullName}/pulls/${prInfo.prNumber}/comments`;
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            body: truncatedBody,
            path: file,
            position: giteePosition,
          }),
        });

        if (response.ok) {
          postedCount++;
          console.log(`✅ Gitee 行内评论已发布: ${file}:${resolvedLine}`);
        } else {
          const err = await response.text();
          console.error(`❌ Gitee 行内评论失败: ${file}:${resolvedLine} HTTP ${response.status}`);
        }
      }
    } catch (e) {
      console.error(`发布行内评论异常: ${file}:${line} - ${e.message}`);
    }
  }

  return { posted: postedCount, total: totalCount };
}

// ============ Worker 入口 ============

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('Webhook 服务运行中。请发送 POST 请求。', { status: 200 });
    }

    const platform = detectPlatform(request);
    if (platform === 'unknown') {
      return new Response('无法识别的平台', { status: 400 });
    }

    try {
      const body = await request.json();
      const prInfo = parseWebhook(body, platform);

      if (!prInfo || !prInfo.sourceBranch || !prInfo.targetBranch) {
        return new Response(`无法解析 ${platform} Webhook 数据`, { status: 400 });
      }

      if (!isPREvent(prInfo.action, platform)) {
        console.log(`跳过事件：${platform} ${prInfo.action}`);
        return new Response(`事件 ${prInfo.action} 不触发审查`, { status: 200 });
      }

      console.log(`收到 ${platform} PR/MR: ${prInfo.repoFullName}#${prInfo.prNumber}`);
      console.log(`  源分支: ${prInfo.sourceBranch} → 目标分支: ${prInfo.targetBranch}`);
      console.log(`  commit: ${prInfo.commitId?.slice(0, 7)}`);

      // 使用 ctx.waitUntil 让审查在后台异步执行
      // 这样 Worker 可以立即返回 200，避免 GitHub Webhook 超时（10秒）
      // 审查过程（获取 diff + AI 分析 + 发布评论）可能需要 10-30 秒
      ctx.waitUntil(
        (async () => {
          try {
            // 获取 diff 和文件列表
            const { diffContent, files } = await fetchPRDiff(prInfo, platform, env);

            if (!diffContent || diffContent.trim().length === 0) {
              console.log('未获取到代码差异，跳过审查');
              return;
            }

            console.log(`获取到 diff: ${diffContent.length} 字符, ${files.length} 个文件`);

            // AI 审查
            const suggestions = await callAIReview(diffContent, prInfo, env);
            console.log(`AI 审查完成: ${suggestions.length} 条建议`);

            // 发布行内评论
            const result = await postReviewComments(prInfo, platform, suggestions, files, env);
            console.log(`行内评论发布完成: ${result.posted}/${result.total}`);
          } catch (e) {
            console.error(`后台审查失败: ${e.message}`);
            console.error(e.stack);
          }
        })()
      );

      // 立即返回 200，告诉 GitHub Webhook 已接收
      return new Response(
        `审查任务已接收，正在后台处理: ${prInfo.repoFullName}#${prInfo.prNumber}`,
        { status: 200 }
      );
    } catch (e) {
      console.error(`审查失败: ${e.message}`);
      console.error(e.stack);
      return new Response(`审查失败: ${e.message}`, { status: 500 });
    }
  },
};
