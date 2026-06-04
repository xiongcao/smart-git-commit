// ============ log 命令 - 美化提交历史 ============
// 展示最近 N 条提交记录，带颜色标签和类型统计图表
// 支持 --graph 参数显示 ASCII 图形化分支历史

const { getRecentCommits, getCommitTypeStats, getGraphLog } = require('../git');
const { colors, colorType } = require('../colors');

/**
 * 处理 log 命令
 * @param {string[]} args - 命令行参数
 *   支持 --graph/-g（图形化显示）
 *   支持数字参数（指定显示条数，如 sgc log 20）
 */
function handleLog(args) {
  // 解析参数
  const useGraph = args.includes('--graph') || args.includes('-g');  // 图形化模式

  // 从参数中找纯数字作为显示条数，找不到默认 10
  const count = parseInt(args.find((a) => /^\d+$/.test(a))) || 10;

  console.log(`${colors.cyan}📜 最近 ${count} 条提交记录${colors.reset}`);
  console.log(`${colors.gray}━${colors.reset}`.repeat(40));

  // 图形化模式：直接输出 git 原生的 graph 日志
  if (useGraph) {
    console.log(getGraphLog(count));
    return;
  }

  // 普通模式：获取提交记录，格式为 "%h %s"（短哈希 + 提交信息）
  const commits = getRecentCommits(count, '%h %s');

  // 逐条解析并美化输出
  commits.forEach((line) => {
    // 正则提取：短哈希 + 剩余内容
    // 如 "abc1234 feat(auth): 新增登录功能"
    const match = line.match(/^(\S+)\s+(.+)/);
    if (match) {
      const hash = match[1];  // 短哈希
      const msg = match[2];   // 提交信息

      // 解析 Conventional Commits 格式：type(scope): description
      const typeMatch = msg.match(/^(\w+)(\([^)]*\))?:\s*(.+)/);
      if (typeMatch) {
        const type = typeMatch[1];       // feat
        const scope = typeMatch[2] || '';// (auth) 或空
        const desc = typeMatch[3] || ''; // 新增登录功能

        // type 带颜色，如红色 fix、绿色 feat
        const typeLabel = colorType(type);

        // scope 带颜色，去掉外层括号 (auth) → auth
        const scopeLabel = scope
          ? `(${colors.cyan}${scope.slice(1, -1)}${colors.reset})`
          : '';

        // 最终输出：灰色哈希  彩色type(青色scope) 描述
        console.log(
          `  ${colors.gray}${hash}${colors.reset}  ${typeLabel}${scopeLabel} ${desc}`
        );
      } else {
        // 不满足 Conventional Commits 格式的，直接原样输出
        console.log(`  ${colors.gray}${hash}${colors.reset}  ${msg}`);
      }
    }
  });

  // ============ 类型统计图表 ============
  console.log(`\n${colors.cyan}📊 提交类型统计${colors.reset}`);
  console.log(`${colors.gray}━${colors.reset}`.repeat(40));

  // 获取最近 50 条的类型统计
  const stats = getCommitTypeStats(50);
  const total = Object.values(stats).reduce((a, b) => a + b, 0);  // 总数

  // 按数量降序排列
  const sorted = Object.entries(stats).sort((a, b) => b[1] - a[1]);

  // 画柱状图
  sorted.forEach(([type, count]) => {
    // 用 █ 画柱子，最长 30 个字符，至少 1 个
    const bar = '█'.repeat(Math.max(1, Math.round((count / total) * 30)));

    // 百分比，保留 1 位小数
    const pct = ((count / total) * 100).toFixed(1);

    // 输出：彩色类型 + 柱子 + 数量 + 百分比
    console.log(`  ${colorType(type.padEnd(12))} ${bar} ${count} (${pct}%)`);
  });

  console.log();
}

module.exports = { handleLog };
