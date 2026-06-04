// ============ ANSI 颜色工具 ============
// 终端（命令行）不支持 CSS 颜色，而是使用 ANSI 转义码来控制颜色和样式
// 格式：\x1b[参数m    其中 \x1b 是 ESC 字符（ASCII 27），参数控制颜色/样式
// 例如：\x1b[31m 红色  \x1b[0m 重置  使用时需要拼接：`\x1b[31m文本\x1b[0m`

const colors = {
  // 样式码
  reset: '\x1b[0m',   // 重置所有样式，恢复到默认颜色
  bold: '\x1b[1m',    // 加粗文字
  dim: '\x1b[2m',     // 暗淡文字

  // 标准前景色（30-37）
  red: '\x1b[31m',      // 红色文字
  green: '\x1b[32m',    // 绿色文字
  yellow: '\x1b[33m',   // 黄色文字
  blue: '\x1b[34m',     // 蓝色文字
  magenta: '\x1b[35m',  // 洋红色文字
  cyan: '\x1b[36m',     // 青色文字
  white: '\x1b[37m',    // 白色文字

  // 高亮前景色（90-97），比标准色更亮
  gray: '\x1b[90m',     // 灰色/亮黑色文字

  // 背景色（40-47）
  bgRed: '\x1b[41m',    // 红色背景
  bgGreen: '\x1b[42m',  // 绿色背景
  bgYellow: '\x1b[43m', // 黄色背景
  bgBlue: '\x1b[44m',   // 蓝色背景
};

// ============ Commit Type 颜色映射 ============
// 不同提交类型用不同颜色，方便在终端中快速区分
const typeColors = {
  feat: colors.green,     // 新功能 → 绿色
  fix: colors.red,        // 修复 → 红色
  docs: colors.blue,      // 文档 → 蓝色
  style: colors.magenta,  // 样式 → 洋红
  refactor: colors.yellow,// 重构 → 黄色
  perf: colors.cyan,      // 性能 → 青色
  test: colors.green,     // 测试 → 绿色
  chore: colors.gray,     // 杂务 → 灰色
  revert: colors.red,     // 回退 → 红色
  build: colors.yellow,   // 构建 → 黄色
};

/**
 * 给 commit type 添加颜色
 * 例如：colorType('fix') → "\x1b[31mfix\x1b[0m"（红色 fix）
 * @param {string} type - commit 类型，如 'feat', 'fix'
 * @returns {string} 带颜色码的字符串
 */
function colorType(type) {
  const c = typeColors[type] || colors.white;  // 如果类型不在映射表中，用白色
  return `${c}${type}${colors.reset}`;          // 颜色 + 文本 + 重置
}

/**
 * 给 scope 添加颜色（统一用青色）
 * 例如：colorScope('auth') → "\x1b[36mauth\x1b[0m"
 */
function colorScope(scope) {
  return `${colors.cyan}${scope}${colors.reset}`;
}

module.exports = { colors, typeColors, colorType, colorScope };
