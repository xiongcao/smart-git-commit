// ============ Git 操作封装 ============
// 封装所有 Git 命令调用，对外提供干净的 API
// 所有函数底层通过 child_process.execSync 执行 git 命令

const { execSync } = require('child_process');  // Node.js 内置模块，用于执行 shell 命令
const path = require('path');                    // Node.js 内置模块，用于处理文件路径

/**
 * 执行 Git 命令的基础函数
 * @param {string} args - git 命令的参数，如 'status'、'diff --cached'
 * @param {string} [cwd] - 工作目录，默认为当前目录
 * @returns {string} 命令输出（已 trim），出错时返回空字符串
 */
function runGit(args, cwd) {
  try {
    return execSync(`git ${args}`, {
      encoding: 'utf-8',                         // 返回 UTF-8 字符串而非 Buffer
      cwd: cwd || process.cwd(),                 // 指定执行目录，默认当前工作目录
      maxBuffer: 10 * 1024 * 1024,              // 最大输出缓冲区 10MB，防止大 diff 溢出
    }).trim();                                   // 去掉首尾空白
  } catch (e) {
    return '';                                   // 命令执行失败时返回空字符串（如不在 Git 仓库中）
  }
}

// ============ 仓库信息 ============

/**
 * 获取 Git 仓库根目录路径
 * git rev-parse --show-toplevel 返回 .git 所在的最顶层目录
 * @returns {string} 仓库根目录绝对路径，不在仓库中返回空字符串
 */
function getRepoRoot() {
  return runGit('rev-parse --show-toplevel');
}

/**
 * 获取当前分支名
 * git rev-parse --abbrev-ref HEAD 返回当前 HEAD 指向的分支名（如 'main'、'feat/xxx'）
 * @returns {string} 当前分支名
 */
function getCurrentBranch() {
  return runGit('rev-parse --abbrev-ref HEAD');
}

// ============ 文件状态 ============

/**
 * 获取暂存区（staged）的文件列表
 * git diff --cached --name-status 显示暂存区和上次提交的差异
 * 输出格式：M\tfile.js  (M=修改, A=新增, D=删除, R=重命名)
 * @returns {Array<{status: string, file: string}>} 暂存文件数组
 */
function getStagedFiles() {
  const output = runGit('diff --cached --name-status');
  return parseFileStatus(output);
}

/**
 * 获取未暂存（unstaged）的文件列表
 * git diff --name-status 显示工作区和暂存区的差异
 * @returns {Array<{status: string, file: string}>} 未暂存文件数组
 */
function getUnstagedFiles() {
  const output = runGit('diff --name-status');
  return parseFileStatus(output);
}

/**
 * 获取未跟踪（untracked）的文件列表
 * git ls-files --others --exclude-standard 列出未被 Git 跟踪的新文件
 * 这些文件的状态统一标记为 '??'
 * @returns {Array<{status: string, file: string}>} 未跟踪文件数组
 */
function getUntrackedFiles() {
  const output = runGit('ls-files --others --exclude-standard');
  return output
    .split('\n')           // 按行分割
    .filter(Boolean)       // 过滤空行
    .map((f) => ({ status: '??', file: f }));  // 统一标记为 ?? 状态
}

// ============ Diff 信息 ============

/**
 * 获取暂存区变更统计
 * git diff --cached --stat 显示每个文件的增删行数
 * @returns {string} 如 "file.js | 10 +++---"
 */
function getStagedDiff() {
  return runGit('diff --cached --stat');
}

/**
 * 获取暂存区详细变更内容（用于 AI 分析）
 * git diff --cached --unified=3 显示完整 diff，上下文 3 行
 * @returns {string} 完整的 diff 内容
 */
function getStagedDiffDetail() {
  return runGit('diff --cached --unified=3');
}

/**
 * 解析 git diff --name-status 的输出
 * 输入："M\tfile.js\nA\tnew.js"
 * 输出：[{status: 'M', file: 'file.js'}, {status: 'A', file: 'new.js'}]
 * @param {string} output - git diff 的 name-status 输出
 * @returns {Array<{status: string, file: string}>}
 */
function parseFileStatus(output) {
  if (!output) return [];                        // 空输出返回空数组
  return output
    .split('\n')                                 // 按行分割
    .filter(Boolean)                             // 去掉空行
    .map((line) => {
      const parts = line.split('\t');            // git 输出用 tab 分隔：状态\t文件名
      return {
        status: parts[0]?.trim() || '',          // 文件状态：A/M/D/R
        file: parts[1]?.trim() || '',            // 文件路径
      };
    });
}

// ============ 行数统计 ============

/**
 * 获取变更行数统计
 * git diff --numstat 输出格式：新增行数\t删除行数\t文件名
 * @param {boolean} stagedOnly - true=仅暂存区，false=工作区
 * @returns {{additions: number, deletions: number}} 增删行数
 */
function getChangedLines(stagedOnly = true) {
  const flag = stagedOnly ? '--cached' : '';     // 暂存区加 --cached 参数
  const output = runGit(`diff ${flag} --numstat`);
  if (!output) return { additions: 0, deletions: 0 };

  let additions = 0;
  let deletions = 0;
  output.split('\n').forEach((line) => {
    const parts = line.split('\t');              // numstat 用 tab 分隔
    additions += parseInt(parts[0]) || 0;         // 第一列：新增行数
    deletions += parseInt(parts[1]) || 0;         // 第二列：删除行数
  });

  return { additions, deletions };
}

// ============ 分支信息 ============

/**
 * 获取当前分支的详细信息
 * @returns {{branch: string, remote: string, ahead: number, behind: number}}
 *   ahead  = 本地领先远程的提交数
 *   behind = 本地落后远程的提交数
 */
function getBranchInfo() {
  const branch = getCurrentBranch();
  // @{u} 是 upstream 的简写，获取当前分支的远程跟踪分支
  const remote = runGit('rev-parse --abbrev-ref --symbolic-full-name @{u}');

  let ahead = 0;
  let behind = 0;
  if (remote) {
    // rev-list --left-right --count 统计两个分支之间的提交差异
    // 输出格式：ahead_count\tbehind_count
    const count = runGit(`rev-list --left-right --count ${remote}...HEAD`);
    if (count) {
      const parts = count.split('\t');
      ahead = parseInt(parts[0]) || 0;
      behind = parseInt(parts[1]) || 0;
    }
  }

  return { branch, remote, ahead, behind };
}

/**
 * 获取所有分支列表，按最近提交时间排序
 * git branch --sort=-committerdate 输出所有分支，* 标记当前分支
 * @returns {Array<{name: string, isCurrent: boolean}>}
 */
function getBranches() {
  const output = runGit('branch --sort=-committerdate');
  if (!output) return [];

  return output.split('\n').map((line) => {
    const isCurrent = line.startsWith('*');       // * 开头的是当前分支
    const name = line.replace(/^\*?\s+/, '');     // 去掉 * 和前后空格
    return { name, isCurrent };
  });
}

// ============ 提交历史 ============

/**
 * 获取最近 N 条提交记录
 * @param {number} count - 获取数量，默认 10
 * @param {string} format - 格式，默认 '%h %s'（短哈希 + 提交信息）
 * @returns {string[]} 每条记录一行
 */
function getRecentCommits(count = 10, format = '%h %s') {
  const output = runGit(`log -${count} --format="${format}"`);
  if (!output) return [];
  return output.split('\n').filter(Boolean);
}

/**
 * 按 commit type 统计提交数量
 * 通过正则匹配提交信息开头的 type（如 feat: xxx）
 * @param {number} count - 统计最近多少条，默认 50
 * @returns {Object} 如 { feat: 15, fix: 8, docs: 3 }
 */
function getCommitTypeStats(count = 50) {
  const output = runGit(`log -${count} --format="%s"`);
  if (!output) return {};

  const stats = {};
  output.split('\n').forEach((line) => {
    const match = line.match(/^(\w+)/);           // 提取行首的单词（type）
    if (match) {
      const type = match[1];
      stats[type] = (stats[type] || 0) + 1;      // 计数 +1
    }
  });

  return stats;
}

/**
 * 获取完整的工作区状态汇总
 * 合并暂存/未暂存/未跟踪文件 + 行数统计
 * @returns {{staged, unstaged, untracked, stagedLines, unstagedLines}}
 */
function getStatusSummary() {
  const staged = getStagedFiles();
  const unstaged = getUnstagedFiles();
  const untracked = getUntrackedFiles();
  const stagedLines = getChangedLines(true);       // 仅暂存区行数
  const unstagedLines = getChangedLines(false);    // 工作区行数

  return {
    staged,
    unstaged,
    untracked,
    stagedLines,
    unstagedLines,
  };
}

/**
 * 获取图形化的提交历史（树形结构显示分支合并）
 * git log --oneline --graph --decorate 用 ASCII 字符画分支图
 * @param {number} count - 显示条数，默认 20
 * @returns {string} 图形化日志
 */
function getGraphLog(count = 20) {
  return runGit(`log --oneline --graph --decorate -${count}`);
}

module.exports = {
  runGit,
  getRepoRoot,
  getCurrentBranch,
  getStagedFiles,
  getUnstagedFiles,
  getUntrackedFiles,
  getStagedDiff,
  getStagedDiffDetail,
  getChangedLines,
  getBranchInfo,
  getBranches,
  getRecentCommits,
  getCommitTypeStats,
  getStatusSummary,
  getGraphLog,
};
