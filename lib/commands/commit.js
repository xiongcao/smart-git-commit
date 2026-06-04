// ============ commit 命令 - 交互式提交（支持多行 message）============
// 核心命令，负责整个提交流程：
// 1. 检查 Git 仓库和工作区状态
// 2. 自动或手动添加文件到暂存区
// 3. 深度分析 diff，生成详细的多行 commit message
// 4. 交互式确认/编辑/修改类型
// 5. 通过临时文件执行 git commit（支持多行 message）

const fs = require('fs');
const path = require('path');
const {
  getRepoRoot, getCurrentBranch, getStagedFiles, getUnstagedFiles,
  getUntrackedFiles, getStagedDiff, getStagedDiffDetail, runGit
} = require('../git');
const { generateCommitMessage } = require('../generator');
const { generateAICommitMessage } = require('../ai');
const { loadConfig } = require('../config');
const { ask, selectFromList } = require('../prompt');
const { colors } = require('../colors');

/**
 * 执行 git commit（支持多行 message）
 * 使用临时文件方式（git commit -F），避免 shell 转义问题
 *
 * @param {string} message - 完整的 commit message（可含换行）
 */
function doCommit(message) {
  // 在仓库根目录创建临时文件
  const repoRoot = getRepoRoot();
  const tmpFile = path.join(repoRoot, '.git', 'COMMIT_EDITMSG_TMP');

  fs.writeFileSync(tmpFile, message, 'utf-8');

  try {
    runGit(`commit -F "${tmpFile}"`);
    return true;
  } finally {
    // 无论成功失败都清理临时文件
    try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }
  }
}

/**
 * 处理 commit 命令（也是默认命令）
 * @param {string[]} args - 命令行参数
 */
async function handleCommit(args) {
  const autoCommit = args.includes('--auto') || args.includes('-a');
  const dryRun = args.includes('--dry-run') || args.includes('-d');
  const useAI = args.includes('--ai');

  // 验证 Git 仓库
  const repoRoot = getRepoRoot();
  if (!repoRoot) {
    console.error('❌ 当前目录不是 Git 仓库');
    process.exit(1);
  }

  // ============ 步骤 1：基本信息 ============
  console.log(`${colors.cyan}📦 Smart Git Commit${colors.reset}`);
  console.log(`${colors.gray}━${colors.reset}`.repeat(50));

  const branch = getCurrentBranch();
  console.log(`${colors.green}🌿 分支: ${branch}${colors.reset}`);

  // ============ 步骤 2：检查暂存区 ============
  let stagedFiles = getStagedFiles();
  const unstagedFiles = getUnstagedFiles();
  const untrackedFiles = getUntrackedFiles();

  if (stagedFiles.length === 0) {
    if (unstagedFiles.length === 0 && untrackedFiles.length === 0) {
      console.log(`${colors.green}✅ 没有检测到任何修改${colors.reset}`);
      process.exit(0);
    }

    console.log(`\n${colors.yellow}⚠️  暂存区为空，检测到以下未暂存的修改：${colors.reset}\n`);

    const allFiles = [...unstagedFiles, ...untrackedFiles];
    allFiles.forEach((f) => {
      const statusLabel = f.status === '??' ? '🆕' : '✏️';
      console.log(`  ${statusLabel} ${f.file}`);
    });

    const answer = await ask(`\n是否将所有修改添加到暂存区？${colors.gray}[y/N]${colors.reset} `);
    if (answer.toLowerCase() === 'y') {
      runGit('add -A');
      stagedFiles = getStagedFiles();
      console.log(`${colors.green}✅ 已添加到暂存区${colors.reset}`);
    } else {
      console.log(`${colors.red}❌ 取消操作${colors.reset}`);
      process.exit(0);
    }
  }

  // ============ 步骤 3：显示暂存文件 ============
  console.log(`\n${colors.cyan}📋 暂存的文件（共 ${stagedFiles.length} 个）：${colors.reset}\n`);

  const statusIcons = {
    A: '🆕', M: '✏️', D: '🗑️', R: '📝', '??': '🆕', AM: '✏️',
  };

  stagedFiles.forEach((f) => {
    const icon = statusIcons[f.status] || '📝';
    console.log(`  ${icon} [${f.status}] ${f.file}`);
  });

  // ============ 步骤 4：变更统计 ============
  const diffStat = getStagedDiff();
  console.log(`\n${colors.cyan}📊 变更统计：${colors.reset}`);
  console.log(diffStat);

  // ============ 步骤 5：生成 commit message ============
  const diffDetail = getStagedDiffDetail();
  const config = loadConfig();
  let message;

  // AI 模式
  if (useAI || config.useAI) {
    if (!config.apiKey && !process.env.OPENAI_API_KEY && !process.env.DASHSCOPE_API_KEY) {
      console.log(`\n${colors.yellow}💡 检测到 --ai 模式但未配置 API Key${colors.reset}`);
      const inputKey = await ask(`${colors.gray}请输入 API Key（跳过则使用规则生成）: ${colors.reset}`);
      if (inputKey) {
        process.env.OPENAI_API_KEY = inputKey;
      } else {
        console.log(`${colors.gray}跳过 AI 模式，使用规则生成${colors.reset}`);
      }
    }

    if (config.apiKey || process.env.OPENAI_API_KEY || process.env.DASHSCOPE_API_KEY) {
      console.log(`\n${colors.magenta}🤖 AI 分析中...${colors.reset}`);
      const aiMsg = await generateAICommitMessage(diffDetail, stagedFiles, branch);
      if (aiMsg) {
        message = aiMsg;
        console.log(`\n${colors.magenta}🤖 AI 生成：${colors.reset}`);
        console.log(`${colors.gray}━${colors.reset}`.repeat(50));
        console.log(message);
        console.log(`${colors.gray}━${colors.reset}`.repeat(50));
      }
    }
  }

  // 规则生成模式
  if (!message) {
    console.log(`\n${colors.cyan}🔍 深度分析文件变更中...${colors.reset}`);
    const result = generateCommitMessage(stagedFiles, diffStat);
    message = result.message;
    console.log(`\n${colors.cyan}📝 生成提交信息：${colors.reset}`);
    console.log(`${colors.gray}━${colors.reset}`.repeat(50));
    console.log(message);
    console.log(`${colors.gray}━${colors.reset}`.repeat(50));
  }

  // ============ 步骤 6：交互式确认 ============
  if (!autoCommit) {
    console.log(`\n${colors.yellow}操作选项：${colors.reset}`);
    console.log(`  ${colors.bold}Enter${colors.reset} - 使用此提交信息`);
    console.log(`  ${colors.bold}e${colors.reset}     - 编辑提交信息（打开系统默认编辑器）`);
    console.log(`  ${colors.bold}t${colors.reset}     - 修改提交类型`);
    console.log(`  ${colors.bold}v${colors.reset}     - 在默认编辑器中查看/编辑`);
    console.log(`  ${colors.bold}q${colors.reset}     - 退出`);

    const answer = await ask(`\n请选择操作: `);

    if (answer === 'q') {
      console.log(`${colors.red}❌ 取消提交${colors.reset}`);
      process.exit(0);
    } else if (answer === 'e' || answer === 'v') {
      // 将 message 写入临时文件，用系统默认编辑器打开
      const editFile = path.join(repoRoot, '.git', 'COMMIT_EDITMSG_SGC');
      fs.writeFileSync(editFile, message, 'utf-8');

      // 获取编辑器：优先 $EDITOR，否则用 vim/nano/notepad
      const editor = process.env.EDITOR || process.env.VISUAL || 'vim';
      const { execSync } = require('child_process');

      console.log(`${colors.gray}正在打开编辑器: ${editor}${colors.reset}`);
      try {
        execSync(`${editor} "${editFile}"`, { stdio: 'inherit' });
      } catch (e) {
        console.log(`${colors.yellow}⚠️  无法打开编辑器，使用命令行编辑${colors.reset}`);
        const newMsg = await ask(`请输入提交信息 [${message.split('\n')[0]}]: `);
        if (newMsg) message = newMsg;
        try { fs.unlinkSync(editFile); } catch (e) { /* ignore */ }
        // 跳到提交确认
      }

      // 读取编辑后的内容
      if (fs.existsSync(editFile)) {
        const edited = fs.readFileSync(editFile, 'utf-8').trim();
        if (edited) message = edited;
        try { fs.unlinkSync(editFile); } catch (e) { /* ignore */ }
      }
    } else if (answer === 't') {
      const selectedType = await selectFromList(
        '选择提交类型：',
        config.commitTypes
      );
      if (selectedType) {
        message = message.replace(/^[a-z]+(\([^)]*\))?:/, `${selectedType}$1:`);
      }
    }
  }

  // ============ 步骤 7：确认并提交 ============
  console.log(`\n${colors.green}✅ 最终提交信息：${colors.reset}`);
  console.log(`${colors.gray}━${colors.reset}`.repeat(50));
  console.log(message);
  console.log(`${colors.gray}━${colors.reset}`.repeat(50));

  if (dryRun) {
    console.log(`\n${colors.yellow}🔍 --dry-run 模式，不执行实际提交${colors.reset}`);
    process.exit(0);
  }

  if (autoCommit) {
    doCommit(message);
    console.log(`${colors.green}🎉 提交成功！${colors.reset}`);
  } else {
    const confirm = await ask(`确认提交？${colors.gray}[y/N]${colors.reset} `);
    if (confirm.toLowerCase() === 'y') {
      doCommit(message);
      console.log(`${colors.green}🎉 提交成功！${colors.reset}`);
    } else {
      console.log(`${colors.red}❌ 取消提交${colors.reset}`);
    }
  }
}

module.exports = { handleCommit };
