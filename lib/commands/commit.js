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
const { colors, gradients, sectionHeader } = require('../colors');

/**
 * 执行 git commit（支持多行 message）
 * 使用临时文件方式（git commit -F），避免 shell 转义问题
 * 如果用 git commit -m "多行文本"，换行符和引号容易在 shell 中转义出错
 *
 * @param {string} message - 完整的 commit message（可含换行）
 */
function doCommit(message) {
  // 在仓库根目录的 .git 目录下创建临时文件
  const repoRoot = getRepoRoot();
  const tmpFile = path.join(repoRoot, '.git', 'COMMIT_EDITMSG_TMP');

  // 将 message 写入临时文件（UTF-8 编码）
  fs.writeFileSync(tmpFile, message, 'utf-8');

  try {
    // git commit -F <文件> 从文件读取 commit message
    runGit(`commit -F "${tmpFile}"`);
    return true;
  } finally {
    // 无论提交成功还是失败，都清理临时文件
    try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }
  }
}

/**
 * 处理 commit 命令（也是默认命令）
 * @param {string[]} args - 命令行参数
 */
async function handleCommit(args) {
  // 解析命令行选项
  const autoCommit = args.includes('--auto') || args.includes('-a');   // 自动提交模式
  const dryRun = args.includes('--dry-run') || args.includes('-d');    // 预览模式
  const useAI = args.includes('--ai');                                 // AI 模式

  // 验证当前目录是否在 Git 仓库中
  const repoRoot = getRepoRoot();
  if (!repoRoot) {
    console.error('❌ 当前目录不是 Git 仓库');
    process.exit(1);
  }

  // ============ 步骤 1：基本信息 ============
  console.log(gradients.sunset('📦 Smart Git Commit'));
  console.log(`${colors.dim}${'━'.repeat(50)}${colors.reset}`);

  // 显示当前分支名
  const branch = getCurrentBranch();
  console.log(`${colors.brightGreen}🌿 ${colors.bold}Branch:${colors.reset} ${colors.brightCyan}${branch}${colors.reset}`);

  // ============ 步骤 2：检查暂存区 ============
  let stagedFiles = getStagedFiles();              // 已暂存的文件
  const unstagedFiles = getUnstagedFiles();         // 已修改但未暂存的文件
  const untrackedFiles = getUntrackedFiles();       // 未跟踪的新文件

  // 暂存区为空时的处理
  if (stagedFiles.length === 0) {
    // 如果连未暂存和未跟踪都没有，说明工作区干净
    if (unstagedFiles.length === 0 && untrackedFiles.length === 0) {
      console.log(`${colors.green}✅ 没有检测到任何修改${colors.reset}`);
      process.exit(0);
    }

    console.log(`\n${colors.brightYellow}⚠️  ${colors.bold}暂存区为空${colors.reset}，检测到以下未暂存的修改：\n`);

    // 合并未暂存和未跟踪文件列表
    const allFiles = [...unstagedFiles, ...untrackedFiles];
    allFiles.forEach((f) => {
      // ?? 状态（未跟踪）用 🆕 图标，其他用 ✏️
      const statusLabel = f.status === '??' ? '🆕' : '✏️';
      console.log(`  ${statusLabel} ${f.file}`);
    });

    // 询问用户是否自动执行 git add -A
    const answer = await ask(`\n是否将所有修改添加到暂存区？${colors.gray}[y/n]${colors.reset} `);
    console.log(['y', 'yes'].includes(answer.toLowerCase()) ? 'yes' : 'no');
    if (answer.toLowerCase() === 'y') {
      runGit('add -A');                        // 添加所有文件到暂存区
      stagedFiles = getStagedFiles();           // 重新获取暂存文件列表
      console.log(`${colors.green}✅ 已添加到暂存区${colors.reset}`);
    } else {
      console.log(`${colors.red}❌ 取消操作${colors.reset}`);
      process.exit(0);
    }
  }

  // ============ 步骤 3：显示暂存文件 ============
  console.log(`\n${colors.brightCyan}📋 ${colors.bold}暂存的文件${colors.reset}${colors.brightCyan}（共 ${colors.bold}${stagedFiles.length}${colors.reset}${colors.brightCyan} 个）：${colors.reset}\n`);

  // Git 状态码到图标的映射
  const statusIcons = {
    A: '🆕', M: '✏️', D: '🗑️', R: '📝', '??': '🆕', AM: '✏️',
  };

  stagedFiles.forEach((f) => {
    const icon = statusIcons[f.status] || '📝';  // 未知状态用 📝 兜底
    console.log(`  ${icon} [${f.status}] ${f.file}`);
  });

  // ============ 步骤 4：变更统计 ============
  // git diff --cached --stat 显示每个文件的增删行数统计
  const diffStat = getStagedDiff();
  console.log(`\n${colors.brightCyan}📊 ${colors.bold}变更统计：${colors.reset}`);
  console.log(diffStat);

  // ============ 步骤 5：生成 commit message ============
  const diffDetail = getStagedDiffDetail();  // 获取完整 diff 内容（供 AI 或规则引擎分析）
  const config = loadConfig();               // 加载配置
  let message;

  // AI 模式
  if (useAI || config.useAI) {
    // 检查是否已配置 API Key（配置文件或环境变量）
    if (!config.apiKey && !process.env.OPENAI_API_KEY && !process.env.DASHSCOPE_API_KEY) {
      console.log(`\n${colors.yellow}💡 检测到 --ai 模式但未配置 API Key${colors.reset}`);
      // 让用户手动输入 Key（仅当次有效，存入 process.env）
      const inputKey = await ask(`${colors.gray}请输入 API Key（跳过则使用规则生成）: ${colors.reset}`);
      if (inputKey) {
        process.env.OPENAI_API_KEY = inputKey;  // 临时设置环境变量
      } else {
        console.log(`${colors.gray}跳过 AI 模式，使用规则生成${colors.reset}`);
      }
    }

    // 确认 Key 可用后调用 AI API
    if (config.apiKey || process.env.OPENAI_API_KEY || process.env.DASHSCOPE_API_KEY) {
      console.log(`\n${colors.brightMagenta}🤖 ${colors.bold}AI 分析中...${colors.reset}`);
      const aiMsg = await generateAICommitMessage(diffDetail, stagedFiles, branch);
      if (aiMsg) {
        message = aiMsg;
        console.log(`\n${colors.brightMagenta}🤖 ${colors.bold}AI 生成：${colors.reset}`);
        console.log(`${colors.dim}${'━'.repeat(50)}${colors.reset}`);
        console.log(message);
        console.log(`${colors.dim}${'━'.repeat(50)}${colors.reset}`);
      }
    }
  }

  // 规则生成模式（AI 未启用或 AI 生成失败时回退）
  if (!message) {
    console.log(`\n${colors.brightCyan}🔍 ${colors.bold}深度分析文件变更中...${colors.reset}`);
    const result = generateCommitMessage(stagedFiles, diffStat); // 调用规则引擎生成
    message = result.message;
    console.log(`\n${colors.brightCyan}📝 ${colors.bold}生成提交信息：${colors.reset}`);
    console.log(`${colors.dim}${'━'.repeat(50)}${colors.reset}`);
    console.log(message);
    console.log(`${colors.dim}${'━'.repeat(50)}${colors.reset}`);
  }

  // ============ 步骤 6：交互式确认 ============
  if (!autoCommit) {
    console.log(`\n${colors.brightYellow}📌 ${colors.bold}操作选项：${colors.reset}`);
    console.log(`  ${colors.bold}${colors.brightGreen}Enter${colors.reset}  ${colors.dim}- 使用此提交信息${colors.reset}`);
    console.log(`  ${colors.bold}${colors.brightBlue}e${colors.reset}     ${colors.dim}- 编辑提交信息${colors.reset}`);
    console.log(`  ${colors.bold}${colors.orange}t${colors.reset}     ${colors.dim}- 修改提交类型${colors.reset}`);
    console.log(`  ${colors.bold}${colors.purple}v${colors.reset}     ${colors.dim}- 在编辑器中查看/编辑${colors.reset}`);
    console.log(`  ${colors.bold}${colors.brightRed}q${colors.reset}     ${colors.dim}- 退出${colors.reset}`);

    const answer = await ask(`\n请选择操作: `);
    console.log(answer || 'Enter');

    if (answer === 'q') {
      console.log(`${colors.red}❌ 取消提交${colors.reset}`);
      process.exit(0);
    } else if (answer === 'e' || answer === 'v') {
      // 编辑模式：将 message 写入临时文件，用系统默认编辑器打开
      const editFile = path.join(repoRoot, '.git', 'COMMIT_EDITMSG_SGC');
      fs.writeFileSync(editFile, message, 'utf-8');  // 写入待编辑内容

      // 获取系统编辑器：优先 $EDITOR，否则 $VISUAL，最后回退 vim
      const editor = process.env.EDITOR || process.env.VISUAL || 'vim';
      const { execSync } = require('child_process'); // 动态加载（仅编辑时需要）

      console.log(`${colors.gray}正在打开编辑器: ${editor}${colors.reset}`);
      try {
        // stdio: 'inherit' 让编辑器接管终端输入输出
        execSync(`${editor} "${editFile}"`, { stdio: 'inherit' });
      } catch (e) {
        // 编辑器打开失败，回退到命令行输入
        console.log(`${colors.yellow}⚠️  无法打开编辑器，使用命令行编辑${colors.reset}`);
        const newMsg = await ask(`请输入提交信息 [${message.split('\n')[0]}]: `);
        if (newMsg) message = newMsg;
        try { fs.unlinkSync(editFile); } catch (e) { /* ignore */ }
        // 跳过文件读取，直接进入提交确认
      }

      // 编辑器关闭后，读取编辑后的内容
      if (fs.existsSync(editFile)) {
        const edited = fs.readFileSync(editFile, 'utf-8').trim(); // 读取并 trim
        if (edited) message = edited;                              // 有内容则更新 message
        try { fs.unlinkSync(editFile); } catch (e) { /* ignore */ } // 清理临时文件
      }
    } else if (answer === 't') {
      // 修改提交类型：用正则替换第一行的 type 部分
      const selectedType = await selectFromList(
        '选择提交类型：',
        config.commitTypes
      );
      if (selectedType) {
        // 正则 ^[a-z]+  匹配行首的 type 单词并替换
        message = message.replace(/^[a-z]+(\([^)]*\))?:/, `${selectedType}$1:`);
      }
    }
  }

  // ============ 步骤 7：确认并提交 ============
  console.log(`\n${colors.brightGreen}✅ ${colors.bold}最终提交信息：${colors.reset}`);
  console.log(`${colors.dim}${'━'.repeat(50)}${colors.reset}`);
  console.log(message);
  console.log(`${colors.dim}${'━'.repeat(50)}${colors.reset}`);

  // --dry-run 模式：只预览不提交
  if (dryRun) {
    console.log(`\n${colors.yellow}🔍 --dry-run 模式，不执行实际提交${colors.reset}`);
    process.exit(0);
  }

  // --auto 模式：跳过确认直接提交
  if (autoCommit) {
    doCommit(message);
    console.log(`${colors.brightGreen}🎉 ${colors.bold}提交成功！${colors.reset}`);
  } else {
    // 正常交互模式：最后一次确认
    const confirm = await ask(`确认提交？${colors.dim}[y/n]${colors.reset} `);
    console.log(['y', 'yes'].includes(confirm.toLowerCase()) ? 'yes' : 'no');
    if (confirm.toLowerCase() === 'y') {
      doCommit(message);
      console.log(`${colors.brightGreen}🎉 ${colors.bold}提交成功！${colors.reset}`);
    } else {
      console.log(`${colors.red}❌ 取消提交${colors.reset}`);
    }
  }
}

module.exports = { handleCommit };
