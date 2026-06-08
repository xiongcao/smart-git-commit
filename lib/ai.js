// ============ AI 生成模式 ============
// 通过 OpenAI 兼容接口调用 AI 模型，自动生成更智能的 commit message
// 支持 OpenAI、阿里通义千问、DeepSeek 等兼容接口

const { loadConfig } = require('./config');
const { ask } = require('./prompt');
const { colors } = require('./colors');

// 支持的 API Key 环境变量名（按检测顺序排列）
// 用户只需设置其中任意一个环境变量即可
const API_KEY_ENV_NAMES = [
  'OPENAI_API_KEY',      // OpenAI 官方
  'DASHSCOPE_API_KEY',   // 阿里通义千问
  'ANTHROPIC_API_KEY',   // Anthropic Claude
  'DEEPSEEK_API_KEY',    // DeepSeek
];

/**
 * 获取 API Key
 * 优先级：配置文件 apiKey 字段 > 环境变量
 *
 * @param {Object} config - 加载后的配置对象
 * @returns {string|null} API Key，未配置返回 null
 */
function getApiKey(config) {
  // 1. 优先从配置文件读取（.sgcrc.json 中的 apiKey 字段）
  if (config.apiKey) {
    return config.apiKey;
  }

  // 2. 依次检查各个环境变量名，返回第一个找到的
  for (const name of API_KEY_ENV_NAMES) {
    if (process.env[name]) {
      return process.env[name];
    }
  }

  return null;  // 都没有返回 null，表示未配置
}

/**
 * 调用 AI API 生成 commit message
 *
 * 工作流程：
 * 1. 加载配置，获取 API Key
 * 2. 如果没有 Key，打印配置指引并返回 null
 * 3. 构建请求体（system prompt + user prompt + diff 内容）
 * 4. 发送 HTTPS POST 请求到 AI API
 * 5. 解析响应，提取 commit message
 * 6. 出错则返回 null，上层降级为规则生成
 *
 * @param {string} diffDetail - 完整的 diff 内容（用于 AI 分析变更）
 * @param {Array} files - 变更文件列表
 * @param {string} branch - 当前分支名
 * @returns {Promise<string|null>} AI 生成的 commit message，失败返回 null
 */
async function generateAICommitMessage(diffDetail, files, branch) {
  const config = loadConfig();         // 加载合并后的配置
  const apiKey = getApiKey(config);    // 获取 API Key（配置文件或环境变量）
  const language = config.language || 'zh'; // 生成语言配置

  // 语言名称映射
  const languageNames = { zh: '中文', en: 'English', ja: '日本語', ko: '한국어', fr: 'Français' };
  const languageName = languageNames[language] || language;

  // 没有配置 Key：打印三种配置方式指引
  if (!apiKey) {
    console.log(`\n${colors.yellow}⚠️  未配置 AI API Key，无法使用 AI 模式${colors.reset}`);
    console.log(`${colors.gray}   配置方式：${colors.reset}`);
    console.log(`   1. 环境变量：export OPENAI_API_KEY="your-key"`);
    console.log(`   2. 配置文件：在 .sgcrc.json 中设置 "apiKey" 字段`);
    console.log(`   3. 终端运行时：sgc --ai 会自动提示输入\n`);
    return null;
  }

  try {
    const https = require('https');  // 在 try 块内动态加载，仅在需要 AI 时才引入

    // 构建请求 URL：config.aiBaseUrl + /chat/completions
    // 如 https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
    const baseUrl = new URL(config.aiBaseUrl);           // 解析基础 URL
    // 手动拼接 pathname，避免 new URL(path, base) 覆盖 base 的路径部分
    const pathname = baseUrl.pathname.replace(/\/$/, '') + '/chat/completions';
    const url = new URL(pathname, baseUrl.origin);       // 用 origin + 拼接后的 pathname 构建最终 URL

    // diff 内容截断到 16000 字符，控制请求体大小，同时给 AI 足够上下文
    const truncatedDiff = diffDetail.slice(0, 16000);

    // 构建请求体（OpenAI Chat Completions 格式）
    const body = JSON.stringify({
      model: config.aiModel,       // AI 模型名称，如 gpt-4o-mini、qwen-turbo
      messages: [
        {
          role: 'system',          // system 角色：定义 AI 的行为规则和输出格式
          content: `你是一个专业的 Git 提交信息生成器。根据代码变更内容，生成 Conventional Commits 格式的提交信息。
            格式要求：
            type(scope): 变更摘要

            - 具体改动项 1（说明改了什么功能）
            - 具体改动项 2
            - 具体改动项 3

            规则：
            1. 第一行是标题：type(scope): 变更摘要（必须使用${languageName}，不超过 72 字符）
            2. 空一行
            3. 用 "- " 列出每项具体改动，每项都要描述改了什么功能、为什么改
            4. 所有输出内容必须使用${languageName}
            5. type 必须从以下选择：feat, fix, docs, style, refactor, perf, test, chore, revert, build
            6. 不要出现文件名、文件路径、函数名、变量名等代码符号
            7. 用自然语言描述功能层面的变化，而非代码层面的变化
            8. 只返回提交信息，不要其他解释。`,
        },
        {
          role: 'user',            // user 角色：提供需要分析的实际上下文
          content: `当前分支：${branch}\n\n变更详情（diff）：\n${truncatedDiff}`,
        },
      ],
      temperature: 0.3,            // 温度参数：越低输出越稳定一致（范围 0-2）
      max_tokens: 800,             // 最大输出 token 数，支持详细的多行 commit message
    });

    // 发送 HTTPS POST 请求
    const response = await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: url.hostname,  // API 服务器地址
          port: 443,               // HTTPS 默认端口
          path: url.pathname + url.search, // 请求路径 + 查询参数
          method: 'POST',          // POST 方法发送请求体
          headers: {
            'Content-Type': 'application/json',       // JSON 格式请求体
            Authorization: `Bearer ${apiKey}`,         // Bearer Token 认证
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));  // 拼接响应数据块
          res.on('end', () => {
            // 检查 HTTP 状态码，200 表示成功
            if (res.statusCode !== 200) {
              // 非 200 响应：打印错误内容的前 500 字符用于调试
              const preview = data.slice(0, 500);
              reject(new Error(`HTTP ${res.statusCode}: ${preview}`));
              return;
            }
            try {
              resolve(JSON.parse(data));  // 解析 JSON 响应
            } catch (e) {
              // JSON 解析失败：打印原始内容前 500 字符帮助定位问题
              const preview = data.slice(0, 500);
              reject(new Error(`Invalid JSON response: ${preview}`));
            }
          });
        }
      );
      req.on('error', (e) => reject(new Error(`网络请求失败: ${e.message}`))); // 网络层错误
      req.write(body);  // 写入请求体（JSON 字符串）
      req.end();        // 结束请求，开始发送
    });

    // 检查 API 是否返回了业务错误（如认证失败、模型不存在等）
    if (response.error) {
      throw new Error(response.error.message || 'API 请求失败');
    }

    // 提取 AI 回复内容：response.choices[0].message.content
    // 使用可选链 ?. 防止对象结构不匹配时的 undefined 错误
    return response.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    // AI 生成失败不中断流程，降级为规则生成模式
    console.log(`${colors.yellow}⚠️  AI 生成失败，使用规则生成: ${e.message}${colors.reset}`);
    return null;
  }
}

module.exports = { generateAICommitMessage };
