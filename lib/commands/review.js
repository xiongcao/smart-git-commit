// ============ review 命令 - 代码审查 ============
// 用法：
//   sgc review <target-branch>                    # 审查当前分支相对于目标分支的变更
//   sgc review <source-branch> --target <target>  # 审查指定两个分支之间的差异
//   sgc review --help                             # 显示帮助信息
//
// 示例：
//   sgc review main                    # 审查当前分支合并到 main 的改动
//   sgc review feat-login --target main # 审查 feat-login 合并到 main 的改动

const { getRepoRoot, getCurrentBranch, runGit } = require('../git');
const { loadConfig } = require('../config');
const { reviewCode } = require('../reviewer');
const { colors } = require('../colors');

/**
 * 显示 review 命令的帮助信息
 */
function showReviewHelp() {
  console.log(`
${colors.cyan}${colors.bold}📋 sgc review - 代码审查工具${colors.reset}

${colors.yellow}用法：${colors.reset}
  sgc review <目标分支>                   ${colors.gray}# 审查当前分支 → 目标分支的变更${colors.reset}
  sgc review <源分支> --target <目标分支>  ${colors.gray}# 审查指定源分支 → 目标分支的变更${colors.reset}
  sgc review --help                       ${colors.gray}# 显示此帮助信息${colors.reset}

${colors.yellow}示例：${colors.reset}
  sgc review main                          ${colors.gray}# 审查当前分支 vs main${colors.reset}
  sgc review feat-login --target main       ${colors.gray}# 审查 feat-login vs main${colors.reset}
  sgc review feature --target develop       ${colors.gray}# 审查 feature vs develop${colors.reset}

${colors.yellow}说明：${colors.reset}
  通过 AI 分析两个分支之间的代码差异，输出优化建议报告。
  审查内容包括：逻辑错误、安全漏洞、性能问题、代码可维护性等。

${colors.yellow}前置条件：${colors.reset}
  1. 需要在 Git 仓库中运行
  2. 需要配置 AI API Key（环境变量 OPENAI_API_KEY 或在 .sgcrc.json 中配置）
`);
}

/**
 * 验证参数是否合法
 * @param {string} sourceBranch - 源分支
 * @param {string} targetBranch - 目标分支
 * @returns {string|null} 错误信息，合法返回 null
 */
function validateBranches(sourceBranch, targetBranch) {
  // 检查分支名不为空
  if (!sourceBranch || !targetBranch) {
    return '源分支和目标分支都不能为空';
  }

  // 检查分支名不含危险字符（防止命令注入）
  const dangerousChars = /[;&|`$(){}[\]!<>\\]/;
  if (dangerousChars.test(sourceBranch) || dangerousChars.test(targetBranch)) {
    return '分支名包含非法字符';
  }

  // 检查两个分支不同
  if (sourceBranch === targetBranch) {
    return `源分支和目标分支相同（都是 ${sourceBranch}），无需审查`;
  }

  return null;
}

/**
 * 检查分支是否存在
 * @param {string} branch - 分支名
 * @returns {boolean} 分支是否存在
 */
function branchExists(branch) {
  // git rev-parse --verify 检查引用是否有效
  // --quiet 选项：不输出任何内容，仅通过退出码表示结果
  const result = runGit(`rev-parse --verify --quiet ${branch}`);
  return result !== null && result !== undefined;
}

/**
 * 处理 review 命令
 *
 * 支持的参数格式：
 * - sgc review <target>              → 审查当前分支 vs target
 * - sgc review <source> --target <t> → 审查 source vs target
 *
 * @param {string[]} args - 命令行参数数组
 */
async function handleReview(args) {
  // ============ 处理帮助请求 ============
  if (args.includes('--help') || args.includes('-h')) {
    showReviewHelp();
    return;
  }

  // ============ 解析参数 ============
  let sourceBranch = null;
  let targetBranch = null;

  // 查找 --target 参数的位置
  const targetIndex = args.indexOf('--target');
  if (targetIndex !== -1) {
    // 格式：sgc review <source> --target <target>
    // args[0] 是源分支，args[targetIndex + 1] 是目标分支
    if (targetIndex > 0) {
      sourceBranch = args[targetIndex - 1];
    }
    targetBranch = args[targetIndex + 1];
  } else {
    // 格式：sgc review <target>
    // 只有一个分支参数，作为目标分支，源分支用当前分支
    targetBranch = args[0];
  }

  // ============ 检查仓库状态 ============
  const repoRoot = getRepoRoot();
  if (!repoRoot) {
    console.log(`${colors.red}❌ 错误：不在 Git 仓库中${colors.reset}`);
    console.log(`${colors.gray}   请在 Git 仓库目录下运行此命令${colors.reset}`);
    return;
  }

  // ============ 确定源分支和目标分支 ============
  // 如果源分支未指定（用户只给了一个目标分支），使用当前分支
  if (!sourceBranch) {
    sourceBranch = getCurrentBranch();
    if (!sourceBranch) {
      console.log(`${colors.red}❌ 错误：无法获取当前分支名${colors.reset}`);
      return;
    }
    console.log(`${colors.gray}  当前分支：${colors.yellow}${sourceBranch}${colors.reset}`);
  }

  // 检查目标分支是否指定
  if (!targetBranch) {
    console.log(`${colors.red}❌ 错误：未指定目标分支${colors.reset}`);
    console.log(`${colors.gray}  用法：sgc review <目标分支>${colors.reset}`);
    console.log(`${colors.gray}  示例：sgc review main${colors.reset}`);
    return;
  }

  // ============ 参数验证 ============
  const validationError = validateBranches(sourceBranch, targetBranch);
  if (validationError) {
    console.log(`${colors.red}❌ ${validationError}${colors.reset}`);
    return;
  }

  // ============ 检查分支是否存在 ============
  // 源分支就是当前分支时不用检查（肯定存在）
  const currentBranch = getCurrentBranch();
  if (sourceBranch !== currentBranch && !branchExists(sourceBranch)) {
    console.log(`${colors.red}❌ 源分支不存在：${sourceBranch}${colors.reset}`);
    return;
  }
  if (!branchExists(targetBranch)) {
    console.log(`${colors.red}❌ 目标分支不存在：${targetBranch}${colors.reset}`);
    return;
  }

  // ============ 检查 AI 配置 ============
  const config = loadConfig();
  const apiKey = config.apiKey
    || process.env['OPENAI_API_KEY']
    || process.env['DASHSCOPE_API_KEY']
    || process.env['ANTHROPIC_API_KEY']
    || process.env['DEEPSEEK_API_KEY'];

  if (!apiKey) {
    console.log(`\n${colors.yellow}⚠️  未配置 AI API Key，无法进行代码审查${colors.reset}`);
    console.log(`${colors.gray}   配置方式：${colors.reset}`);
    console.log(`   1. 环境变量：export OPENAI_API_KEY="your-key"`);
    console.log(`   2. 配置文件：在 .sgcrc.json 中设置 "apiKey" 字段`);
    console.log(`   3. 终端运行时：sgc --ai 会自动提示输入\n`);
    return;
  }

  // ============ 执行审查 ============
  console.log(``);
  try {
    const result = await reviewCode({
      sourceBranch,
      targetBranch,
      cwd: repoRoot,
    });

    // 输出审查报告
    console.log(`\n${result.report}`);
  } catch (e) {
    console.log(`\n${colors.red}❌ 审查失败：${e.message}${colors.reset}`);
    if (e.stack) {
      console.log(`${colors.gray}${e.stack}${colors.reset}`);
    }
  }
}

module.exports = { handleReview, showReviewHelp };
