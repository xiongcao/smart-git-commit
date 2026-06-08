// ============ 配置管理 ============
// 负责加载和合并配置，优先级：项目配置 > 全局配置 > 默认配置
// 配置文件位置：
//   全局：~/.sgcrc.json（用户目录下，所有项目通用）
//   项目：<仓库根目录>/.sgcrc.json（仅当前项目生效）

const fs = require('fs');
const path = require('path');
const { getRepoRoot } = require('./git');

// ============ 默认配置 ============
// 所有可配置项的默认值，用户可通过 .sgcrc.json 覆盖
const DEFAULT_CONFIG = {
  // AI 模式开关：true 时默认使用 AI 生成 commit message
  useAI: false,

  // API Key：AI 服务的认证密钥
  // 留空则从环境变量读取（OPENAI_API_KEY / DASHSCOPE_API_KEY 等）
  apiKey: '',

  // AI 模型名称：如 gpt-4o-mini、qwen-turbo 等
  aiModel: 'qwen-turbo',

  // AI API 地址：OpenAI 兼容接口的 base URL
  aiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',

  // 默认 commit 类型：当规则匹配不到时使用
  defaultType: 'feat',

  // commit 类型匹配规则：通过正则匹配文件路径/变更内容，自动推断类型
  // pattern 可以是正则字符串（会被 new RegExp 转换）或 RegExp 对象
  typeRules: [
    { pattern: 'fix|bug|patch|hotfix', type: 'fix', desc: '修复缺陷' },
    { pattern: 'feature|feat|add', type: 'feat', desc: '新功能' },
    { pattern: 'style|css|scss|less|sass', type: 'style', desc: '代码样式' },
    { pattern: 'doc|readme|md$', type: 'docs', desc: '文档变更' },
    { pattern: 'refactor|restructure', type: 'refactor', desc: '重构' },
    { pattern: 'test|spec', type: 'test', desc: '测试' },
    { pattern: 'chore|config|eslint|prettier|babel|vite|webpack', type: 'chore', desc: '构建/工具' },
    { pattern: 'perf|optimize', type: 'perf', desc: '性能优化' },
  ],

  // commit 类型列表：在交互式选择时展示的选项
  // value = 实际使用的 type，name = 展示的标签
  commitTypes: [
    { value: 'feat', name: 'feat:     新功能' },
    { value: 'fix', name: 'fix:      修复缺陷' },
    { value: 'docs', name: 'docs:     文档变更' },
    { value: 'style', name: 'style:    代码样式(不影响代码运行)' },
    { value: 'refactor', name: 'refactor: 重构(既不是新功能也不是修复)' },
    { value: 'perf', name: 'perf:     性能优化' },
    { value: 'test', name: 'test:     增加测试' },
    { value: 'chore', name: 'chore:    构建过程或辅助工具变动' },
    { value: 'revert', name: 'revert:   回退' },
    { value: 'build', name: 'build:    打包' },
  ],

  // 分支类型前缀映射
  // sgc branch create 时，根据选中的 type 自动添加前缀（如 feat/xxx、fix/xxx）
  branchPrefixes: {
    feat: 'feat',
    fix: 'fix',
    docs: 'docs',
    refactor: 'refactor',
    perf: 'perf',
    test: 'test',
    chore: 'chore',
  },

  // Git Hook 配置
  hooks: {
    commitMsg: true,  // 是否启用 commit-msg 校验 hook
  },

  // 生成 commit message 的语言
  // 可选值：'zh'（中文）、'en'（英文）、'ja'（日文）等
  // AI 模式会在 prompt 中指定语言，规则生成模式会使用对应的描述模板
  language: 'zh',

  // 多平台推送配置
  // sgc push 会同时推送到所有配置的远程仓库
  // 留空则自动检测当前仓库的远程列表并全部推送
  pushRemotes: [],
};

// ============ 配置加载 ============

/**
 * 加载并合并配置
 * 加载顺序：默认配置 → 全局配置 → 项目配置（后者覆盖前者）
 * @returns {Object} 合并后的配置对象
 */
function loadConfig() {
  // 1. 从默认配置开始（展开运算符做浅拷贝，避免修改原对象）
  const config = { ...DEFAULT_CONFIG };

  // 2. 尝试加载全局配置 ~/.sgcrc.json
  const globalConfigPath = path.join(
    process.env.HOME || process.env.USERPROFILE || '~',  // 跨平台获取用户目录（Unix: HOME, Win: USERPROFILE）
    '.sgcrc.json'
  );
  if (fs.existsSync(globalConfigPath)) {                 // 检查全局配置文件是否存在
    try {
      const globalConfig = JSON.parse(fs.readFileSync(globalConfigPath, 'utf-8')); // 读取并解析 JSON
      Object.assign(config, globalConfig);               // 全局配置覆盖默认值（浅合并）
    } catch (e) {
      // JSON 解析失败时忽略，使用默认值继续（避免因格式错误导致工具不可用）
    }
  }

  // 3. 尝试加载项目级配置 .sgcrc.json
  try {
    const repoRoot = getRepoRoot();                      // 获取 Git 仓库根目录
    if (repoRoot) {
      const projectConfigPath = path.join(repoRoot, '.sgcrc.json'); // 项目配置路径
      if (fs.existsSync(projectConfigPath)) {                       // 检查项目配置文件是否存在
        const projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf-8')); // 读取并解析
        Object.assign(config, projectConfig);            // 项目配置覆盖全局和默认值

        // typeRules 特殊处理：项目配置的规则追加到默认规则之后（而不是替换）
        // 追加方式让用户自定义的规则匹配优先级更高（遍历时排在后面，后匹配先命中）
        if (projectConfig.typeRules) {
          config.typeRules = [...config.typeRules, ...projectConfig.typeRules];
        }
      }
    }
  } catch (e) {
    // 忽略加载错误（如不在 Git 仓库中、文件格式错误等）
  }

  // 4. 将 typeRules 中的字符串 pattern 转换为 RegExp 对象
  // 配置文件中只能用字符串表示正则，这里统一转为真正的 RegExp 方便后续匹配
  config.typeRules = config.typeRules.map((rule) => ({
    ...rule,
    pattern: typeof rule.pattern === 'string'
      ? new RegExp(rule.pattern, 'i')    // 字符串 → RegExp，'i' 表示不区分大小写
      : rule.pattern,                     // 已经是 RegExp 对象则保持不变
  }));

  return config;
}

/**
 * 生成默认配置文件的 JSON 字符串
 * 用于 sgc init 命令，在项目中创建 .sgcrc.json
 * JSON.stringify 第三个参数 2 表示缩进 2 空格，方便用户阅读和编辑
 * @returns {string} 格式化的 JSON 字符串
 */
function generateConfigFile() {
  return JSON.stringify(DEFAULT_CONFIG, null, 2);
}

module.exports = { loadConfig, generateConfigFile, DEFAULT_CONFIG };
