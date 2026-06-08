// ============ status 命令 - 增强版仓库状态 ============
// 比 git status 更友好：
// 1. 显示分支 ahead/behind 信息
// 2. 显示变更行数统计
// 3. 彩色分组展示（暂存/未暂存/未跟踪）
// 4. 图标标注文件状态

const { getBranchInfo, getStatusSummary } = require('../git');
const { colors } = require('../colors');

/**
 * 处理 status 命令
 */
function handleStatus() {
  // 获取分支信息（含 ahead/behind）
  const info = getBranchInfo();

  // 获取完整工作区状态（暂存/未暂存/未跟踪文件 + 行数统计）
  const summary = getStatusSummary();

  console.log(`${colors.cyan}📋 仓库状态${colors.reset}`);
  console.log(`${colors.gray}━${colors.reset}`.repeat(40));

  // ============ 分支信息 ============
  let branchStr = `${colors.green}🌿 当前分支: ${colors.bold}${info.branch}${colors.reset}`;

  // ahead：本地领先远程的提交数（绿色 ↑ 箭头）
  if (info.ahead > 0) {
    branchStr += ` ${colors.green}↑${info.ahead}${colors.reset}`;
  }

  // behind：本地落后远程的提交数（红色 ↓ 箭头）
  if (info.behind > 0) {
    branchStr += ` ${colors.red}↓${info.behind}${colors.reset}`;
  }

  console.log(branchStr);

  // 显示远程跟踪分支（如 origin/main）
  if (info.remote) {
    console.log(`   ${colors.gray}远程跟踪: ${info.remote}${colors.reset}`);
  }

  // ============ 暂存区（绿色分组） ============
  if (summary.staged.length > 0) {
    console.log(`\n${colors.green}✅ 暂存区 (${summary.staged.length} 个文件)${colors.reset}`);

    // 显示暂存区行数统计：+新增行数 -删除行数
    console.log(`   ${colors.gray}+${summary.stagedLines.additions} -${summary.stagedLines.deletions}${colors.reset}`);

    summary.staged.forEach((f) => {
      const icon = getStatusIcon(f.status);         // 根据状态获取图标
      const label = getStatusLabel(f.status);       // 根据状态获取中文标签
      console.log(`   ${icon} ${label} ${f.file}`);
    });
  }

  // ============ 未暂存（黄色分组） ============
  if (summary.unstaged.length > 0) {
    console.log(`\n${colors.yellow}✏️  未暂存 (${summary.unstaged.length} 个文件)${colors.reset}`);
    console.log(`   ${colors.gray}+${summary.unstagedLines.additions} -${summary.unstagedLines.deletions}${colors.reset}`);

    summary.unstaged.forEach((f) => {
      // 未暂存文件统一用 ✏️ 图标，黄色状态码
      console.log(`   ✏️  ${colors.yellow}${f.status}${colors.reset} ${f.file}`);
    });
  }

  // ============ 未跟踪（洋红分组） ============
  if (summary.untracked.length > 0) {
    console.log(`\n${colors.magenta}🆕 未跟踪 (${summary.untracked.length} 个文件)${colors.reset}`);

    summary.untracked.forEach((f) => {
      console.log(`   🆕  ${f.file}`);
    });
  }

  // ============ 干净状态 ============
  // 三个区域都为空时，表示工作区完全干净
  if (summary.staged.length === 0 && summary.unstaged.length === 0 && summary.untracked.length === 0) {
    console.log(`\n${colors.green}✅ 工作区干净${colors.reset}`);
  }

  console.log();
}

/**
 * 根据 Git 状态码返回对应图标
 * A=新增, M=修改, D=删除, R=重命名
 * @param {string} status - Git 状态码
 * @returns {string} 图标字符
 */
function getStatusIcon(status) {
  const icons = {
    A: '🆕',     // Added：新增
    M: '✏️',     // Modified：修改
    D: '🗑️',     // Deleted：删除
    R: '📝',     // Renamed：重命名
    AM: '✏️',    // 新增后又修改
  };
  return icons[status] || '📝';  // 未知状态用 📝 兜底
}

/**
 * 根据 Git 状态码返回中文标签
 * @param {string} status - Git 状态码
 * @returns {string} 中文标签
 */
function getStatusLabel(status) {
  const labels = {
    A: '新增',
    M: '修改',
    D: '删除',
    R: '重命名',
    AM: '修改',
  };
  return labels[status] || status;  // 未知状态直接返回原状态码
}

module.exports = { handleStatus };
