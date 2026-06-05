// ============ Cloudflare Worker - 代码审查 Webhook 服务 ============
// 部署在 Cloudflare Workers 上，接收 GitHub/GitLab/Gitee 的 Webhook 事件，
// 自动进行代码审查并将结果以评论形式发布到 PR/MR 页面。
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

// 审查报告的最大字符数（防止评论过长被平台拒绝）
const MAX_REPORT_LENGTH = 60000;

// ============ 平台检测 ============

/**
 * 根据 Webhook 请求头判断平台
 * @param {Request} request
 * @returns {string} 'github' | 'gitlab' | 'gitee' | 'unknown'
 */
function detectPlatform(request) {
  if (request.headers.get('X-GitHub-Event')) return 'github';
  if (request.headers.get('X-Gitlab-Event')) return 'gitlab';
  if (request.headers.get('X-Gitee-Event')) return 'gitee';
  return 'unknown';
}

// ============ Webhook 解析 ============

/**
 * 从 Webhook 请求体中提取 PR/MR 信息
 * 统一不同平台的数据结构为通用格式
 */
function parseWebhook(body, platform) {
  if (platform === 'github') {
    const pr = body.pull_request || {};
    return {
      action: body.action || '',
      sourceBranch: pr.head?.ref || '',
      targetBranch: pr.base?.ref || '',
      cloneUrl: body.repository?.clone_url || '',
      prNumber: pr.number || 0,
      prTitle: pr.title || '',
      repoFullName: body.repository?.full_name || '',
    };
  }

  if (platform === 'gitlab') {
    const attrs = body.object_attributes || {};
    return {
      action: attrs.action || body.event_type || '',
      sourceBranch: attrs.source_branch || '',
      targetBranch: attrs.target_branch || '',
      cloneUrl: body.project?.git_http_url || '',
      prNumber: attrs.iid || 0,
      prTitle: attrs.title || '',
      repoFullName: body.project?.path_with_namespace || '',
    };
  }

  if (platform === 'gitee') {
    const pr = body.pull_request || {};
    return {
      action: body.action || '',
      sourceBranch: pr.head?.ref || '',
      targetBranch: pr.base?.ref || '',
      cloneUrl: body.repository?.git_http_url || '',
      prNumber: pr.number || 0,
      prTitle: pr.title || '',
      repoFullName: body.repository?.full_name || '',
    };
  }

  return null;
}

/**
 * 判断是否是 PR/MR 打开或更新的 Webhook 事件
 * 只有 PR 创建或新提交推送时才触发审查
 */
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

// ============ AI 审查调用 ============

/**
 * 调用 AI API 进行代码审查
 *
 * @param {string} diffContent - 代码差异内容
 * @param {Object} prInfo - PR/MR 信息
 * @param {Object} env - Cloudflare Worker 环境变量（包含密钥和配置）
 * @returns {Promise<string>} AI 审查建议
 */
async function callAIReview(diffContent, prInfo, env) {
  // 从环境变量中获取 AI API Key（支持多种 AI 服务）
  const apiKey = env.DASHSCOPE_API_KEY || env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY || env.DEEPSEEK_API_KEY || '';

  if (!apiKey) {
    throw new Error('未配置 AI API Key，请通过 wrangler secret put 设置 DASHSCOPE_API_KEY 或 OPENAI_API_KEY');
  }

  // 获取 AI 配置（从 wrangler.toml 的 [vars] 或环境变量中读取）
  const aiBaseUrl = env.AI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const aiModel = env.AI_MODEL || 'qwen-turbo';

  // 截断 diff 内容（AI 上下文窗口有限）
  const truncatedDiff = diffContent.slice(0, 30000);

  const messages = [
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
      content: `请审查以下 PR/MR 的代码变更：

PR 标题：${prInfo.prTitle}
源分支：${prInfo.sourceBranch}
目标分支：${prInfo.targetBranch}

代码差异：
\`\`\`diff
${truncatedDiff}
\`\`\`

请逐文件分析，对每个问题给出评分（0-10分），并给出具体的代码修改建议，用 + 标记新增代码、- 标记删除代码、= 标记上下文代码。`,
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
      temperature: 0.5,
      max_tokens: 2500,
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

  return data.choices?.[0]?.message?.content?.trim() || '未获取到审查结果';
}

// ============ 获取 diff 内容 ============

/**
 * 通过平台 API 获取 PR/MR 的 diff 内容
 *
 * 为什么不直接在 Worker 中 clone 仓库？
 * - Cloudflare Workers 没有持久文件系统
 * - 大仓库 clone 耗时太长，可能超出 Worker 的执行时间限制
 * - 通过 API 获取 diff 更快更可靠
 *
 * @param {Object} prInfo - PR/MR 信息
 * @param {string} platform - 平台标识
 * @param {Object} env - Cloudflare Worker 环境变量
 * @returns {Promise<string>} diff 内容
 */
async function fetchPRDiff(prInfo, platform, env) {
  // 从环境变量中获取对应平台的 Token
  const tokens = {
    github: env.GITHUB_TOKEN || '',
    gitlab: env.GITLAB_TOKEN || '',
    gitee: env.GITEE_TOKEN || '',
  };
  const token = tokens[platform];

  if (!token) {
    throw new Error(`未配置 ${platform} API Token，请通过 wrangler secret put ${platform.toUpperCase()}_TOKEN --name git-review-bot 设置`);
  }

  let apiUrl, headers;

  if (platform === 'github') {
    apiUrl = `https://api.github.com/repos/${prInfo.repoFullName}/pulls/${prInfo.prNumber}`;
    headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3.diff',
      'User-Agent': 'git-review-bot',
    };
  } else if (platform === 'gitlab') {
    const projectId = encodeURIComponent(prInfo.repoFullName);
    apiUrl = `https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${prInfo.prNumber}/changes`;
    headers = {
      Authorization: `Bearer ${token}`,
    };
  } else if (platform === 'gitee') {
    apiUrl = `https://gitee.com/api/v5/repos/${prInfo.repoFullName}/pulls/${prInfo.prNumber}`;
    headers = {
      Authorization: `Bearer ${token}`,
    };
  } else {
    throw new Error(`不支持的平台: ${platform}`);
  }

  const response = await fetch(apiUrl, { headers });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`获取 diff 失败 HTTP ${response.status}: ${errorText.slice(0, 200)}`);
  }

  if (platform === 'github') {
    return await response.text();
  } else if (platform === 'gitlab') {
    const data = await response.json();
    if (data.changes && Array.isArray(data.changes)) {
      return data.changes
        .map((change) => `diff --git a/${change.old_path} b/${change.new_path}\n${change.diff || ''}`)
        .join('\n');
    }
    return '';
  } else if (platform === 'gitee') {
    const data = await response.json();
    if (data.files && Array.isArray(data.files)) {
      return data.files
        .map((file) => `diff --git a/${file.filename} b/${file.filename}\n${file.patch || ''}`)
        .join('\n');
    }
    return '';
  }

  return '';
}

// ============ 发布评论 ============

/**
 * 将审查报告以评论形式发布到 PR/MR 页面
 *
 * @param {Object} prInfo - PR/MR 信息
 * @param {string} platform - 平台标识
 * @param {string} report - 审查报告
 * @param {Object} env - Cloudflare Worker 环境变量
 * @returns {Promise<boolean>} 是否发布成功
 */
async function postComment(prInfo, platform, report, env) {
  // 从环境变量中获取对应平台的 Token
  const tokens = {
    github: env.GITHUB_TOKEN || '',
    gitlab: env.GITLAB_TOKEN || '',
    gitee: env.GITEE_TOKEN || '',
  };
  const token = tokens[platform];

  if (!token) {
    throw new Error(`未配置 ${platform} API Token`);
  }

  // 截断过长的报告
  const truncatedReport = report.length > MAX_REPORT_LENGTH
    ? report.slice(0, MAX_REPORT_LENGTH) + '\n\n...（报告过长，已截断）'
    : report;

  // 添加机器人标识
  const commentBody = `🤖 **AI 代码审查报告**\n\n${truncatedReport}\n\n---\n*由 git-commit-gen review bot 自动生成*`;

  let apiUrl;

  if (platform === 'github') {
    apiUrl = `https://api.github.com/repos/${prInfo.repoFullName}/issues/${prInfo.prNumber}/comments`;
  } else if (platform === 'gitlab') {
    const projectId = encodeURIComponent(prInfo.repoFullName);
    apiUrl = `https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${prInfo.prNumber}/notes`;
  } else if (platform === 'gitee') {
    apiUrl = `https://gitee.com/api/v5/repos/${prInfo.repoFullName}/pulls/${prInfo.prNumber}/comments`;
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'git-review-bot',
    },
    body: JSON.stringify({ body: commentBody }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`发布评论失败 HTTP ${response.status}: ${errorText.slice(0, 200)}`);
  }

  return true;
}

// ============ Worker 入口 ============

/**
 * Cloudflare Worker 的主处理函数
 *
 * 处理流程：
 * 1. 检测请求来源平台（根据 HTTP Header）
 * 2. 解析 Webhook 数据，提取 PR/MR 信息
 * 3. 判断是否是 PR 打开/更新事件
 * 4. 获取代码 diff
 * 5. 调用 AI 审查
 * 6. 发布评论到 PR/MR 页面
 *
 * 注意：所有密钥和配置都通过 env 参数获取，不在代码中硬编码。
 * env 中的值来自：
 *   - wrangler secret put 设置的 Secrets（加密存储）
 *   - wrangler.toml 中 [vars] 定义的变量
 */
export default {
  async fetch(request, env, ctx) {
    // 只接受 POST 请求（Webhook 都是 POST）
    if (request.method !== 'POST') {
      return new Response('Webhook 服务运行中。请发送 POST 请求。', { status: 200 });
    }

    // ============ 检测平台 ============
    const platform = detectPlatform(request);
    if (platform === 'unknown') {
      return new Response('无法识别的平台', { status: 400 });
    }

    try {
      // ============ 解析 Webhook 数据 ============
      const body = await request.json();
      const prInfo = parseWebhook(body, platform);

      if (!prInfo || !prInfo.sourceBranch || !prInfo.targetBranch) {
        return new Response(`无法解析 ${platform} Webhook 数据`, { status: 400 });
      }

      // ============ 判断是否需要审查 ============
      if (!isPREvent(prInfo.action, platform)) {
        console.log(`跳过事件：${platform} ${prInfo.action}`);
        return new Response(`事件 ${prInfo.action} 不触发审查`, { status: 200 });
      }

      console.log(`收到 ${platform} PR/MR 事件：${prInfo.repoFullName}#${prInfo.prNumber}`);
      console.log(`  源分支：${prInfo.sourceBranch} → 目标分支：${prInfo.targetBranch}`);

      // ============ 获取 diff 内容 ============
      const diffContent = await fetchPRDiff(prInfo, platform, env);

      if (!diffContent || diffContent.trim().length === 0) {
        console.log('未获取到代码差异');
        return new Response('无代码差异', { status: 200 });
      }

      console.log(`获取到 diff 内容：${diffContent.length} 字符`);

      // ============ AI 审查 ============
      const reviewReport = await callAIReview(diffContent, prInfo, env);
      console.log(`AI 审查完成：${reviewReport.length} 字符`);

      // ============ 发布评论 ============
      await postComment(prInfo, platform, reviewReport, env);
      console.log('评论发布成功');

      return new Response('审查完成并已发布评论', { status: 200 });
    } catch (e) {
      console.error(`审查失败：${e.message}`);
      console.error(e.stack);
      return new Response(`审查失败：${e.message}`, { status: 500 });
    }
  },
};
