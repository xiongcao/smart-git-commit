// ============ ANSI 颜色工具 ============
// 终端（命令行）不支持 CSS 颜色，而是使用 ANSI 转义码来控制颜色和样式
// 格式：\x1b[参数m    其中 \x1b 是 ESC 字符（ASCII 27），参数控制颜色/样式
// 例如：\x1b[31m 红色  \x1b[0m 重置  使用时需要拼接：`\x1b[31m文本\x1b[0m`

const colors = {
  // 样式码
  reset: '\x1b[0m',   // 重置所有样式，恢复到默认颜色
  bold: '\x1b[1m',    // 加粗文字
  dim: '\x1b[2m',     // 暗淡文字
  italic: '\x1b[3m',  // 斜体文字
  underline: '\x1b[4m', // 下划线

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
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',

  // 256 色调色板（部分精选色）
  orange: '\x1b[38;5;208m',   // 橙色
  gold: '\x1b[38;5;220m',     // 金色
  pink: '\x1b[38;5;205m',     // 粉色
  purple: '\x1b[38;5;129m',   // 紫色
  lime: '\x1b[38;5;118m',     // 青柠色
  teal: '\x1b[38;5;43m',      // 蓝绿色
  skyBlue: '\x1b[38;5;39m',   // 天蓝色
  salmon: '\x1b[38;5;209m',   // 鲑鱼色
  violet: '\x1b[38;5;177m',   // 紫罗兰色
  mint: '\x1b[38;5;121m',     // 薄荷绿

  // 背景色（40-47）
  bgRed: '\x1b[41m',    // 红色背景
  bgGreen: '\x1b[42m',  // 绿色背景
  bgYellow: '\x1b[43m', // 黄色背景
  bgBlue: '\x1b[44m',   // 蓝色背景
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
};

// ============ 渐变色工具 ============

/**
 * 生成渐变色文本（用于标题等需要突出的场景）
 * 在两种颜色之间线性插值
 * @param {string} text - 要渲染的文本
 * @param {number[]} fromRGB - 起始色 [r, g, b]，如 [255, 100, 50]
 * @param {number[]} toRGB - 结束色 [r, g, b]，如 [50, 100, 255]
 * @returns {string} 渐变色文本
 */
function gradientText(text, fromRGB, toRGB) {
  if (text.length === 0) return '';
  const chars = [...text]; // 正确处理 Unicode 多字节字符
  const result = [];
  const steps = chars.length - 1 || 1;

  for (let i = 0; i < chars.length; i++) {
    const ratio = i / steps;
    const r = Math.round(fromRGB[0] + (toRGB[0] - fromRGB[0]) * ratio);
    const g = Math.round(fromRGB[1] + (toRGB[1] - fromRGB[1]) * ratio);
    const b = Math.round(fromRGB[2] + (toRGB[2] - fromRGB[2]) * ratio);
    result.push(`\x1b[38;2;${r};${g};${b}m${chars[i]}`);
  }

  return result.join('') + colors.reset;
}

/**
 * 预设渐变色方案
 * @param {string} text - 文本
 * @returns {string} 渐变色文本
 */
const gradients = {
  sunset: (text) => gradientText(text, [255, 94, 77], [255, 195, 0]),    // 日落橙→金
  ocean: (text) => gradientText(text, [0, 150, 255], [0, 255, 200]),     // 海洋蓝→青
  forest: (text) => gradientText(text, [34, 193, 195], [52, 220, 145]),  // 森林绿
  berry: (text) => gradientText(text, [255, 0, 128], [128, 0, 255]),     // 浆果粉→紫
  fire: (text) => gradientText(text, [255, 69, 0], [255, 215, 0]),       // 火焰红→金
};

// ============ Commit Type 颜色映射 ============
// 不同提交类型用不同颜色，方便在终端中快速区分
const typeColors = {
  feat: colors.green,     // 新功能 → 绿色
  fix: colors.red,        // 修复 → 红色
  docs: colors.blue,      // 文档 → 蓝色
  style: colors.magenta,  // 样式 → 洋红
  refactor: colors.orange,// 重构 → 橙色
  perf: colors.teal,      // 性能 → 蓝绿色
  test: colors.lime,      // 测试 → 青柠色
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
  const c = typeColors[type] || colors.white;  // 如果类型不在映射表中，用白色兜底
  return `${c}${type}${colors.reset}`;          // 颜色码 + 文本 + 重置码（防止颜色泄漏到后续输出）
}

/**
 * 给 scope 添加颜色（统一用青色）
 * 例如：colorScope('auth') → "\x1b[36mauth\x1b[0m"
 */
function colorScope(scope) {
  return `${colors.cyan}${scope}${colors.reset}`; // 青色 scope + 重置
}

/**
 * 打印带图标和颜色的分隔线
 * @param {string} icon - 图标字符
 * @param {string} title - 标题文字
 * @param {string} [color] - 颜色码，默认 cyan
 */
function sectionHeader(icon, title, color = colors.brightCyan) {
  return `${color}${icon} ${title}${colors.reset}`;
}

module.exports = { colors, typeColors, colorType, colorScope, gradientText, gradients, sectionHeader };
