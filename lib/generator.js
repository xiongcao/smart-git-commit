// ============ Commit Message 生成器（业务语义版）============
// 核心思路：基于 diff 内容，生成描述「实际业务需求」的 commit message，
// 而不是列举技术细节（如「引入 xxx 模块」「新增函数 xxx()」）。
//
// 示例输出：
// feat(商城): 优化商品详情页加载性能，新增骨架屏
//
// - 商品详情页：新增骨架屏组件，替代空白 loading 状态
// - 图片列表：实现懒加载，仅加载可视区域内的图片
// - 网络请求：增加接口超时重试机制（最多 3 次）
// - 购物车：修复商品数量为 0 时仍可下单的校验问题
// - README：补充环境变量配置说明

const path = require('path');
const { loadConfig } = require('./config');
const { runGit } = require('./git');

// ============ 多语言词库 ============
const i18n = {
  zh: {
    status: { A: '新增', M: '修改', D: '删除', R: '重命名', unknown: '变更' },
    fallback: {
      addedLines: (n) => `新增了 ${n} 行`,
      removedLines: (n) => `移除了 ${n} 行`,
      adjustedLines: (add, del) => `调整了 ${add} 行，移除了 ${del} 行`,
    },
    style: {
      display: '调整显示方式', position: '调整定位方式', width: '调整宽度',
      height: '调整高度', margin: '调整外边距', padding: '调整内边距',
      color: '调整颜色', background: '调整背景', 'font-size': '调整字体大小',
      'font-weight': '调整字体粗细', border: '调整边框', 'border-radius': '调整圆角',
      'box-shadow': '添加阴影效果', opacity: '调整透明度', transform: '添加变换效果',
      transition: '添加过渡动画', animation: '添加动画效果', flex: '调整弹性布局',
      grid: '调整网格布局', 'z-index': '调整层级', overflow: '调整溢出处理',
      cursor: '调整鼠标样式', visibility: '调整可见性', 'text-align': '调整文字对齐',
      'line-height': '调整行高',
      moreSuffix: '等', removedStyles: '移除了部分样式', adjustedStyles: '调整了样式',
    },
    config: {
      set: (key, val) => `配置 ${key} 设为 ${val}`,
      remove: (key) => `移除配置 ${key}`,
      updated: (name) => `${name}: 更新配置`,
    },
    json: {
      addDep: (name, ver) => `安装依赖：${name} ${ver}`,
      removeDep: (name) => `移除依赖：${name}`,
      setProp: (domain, key, val) => `${domain}: ${key} 设为 ${val}`,
      removeProp: (domain, key) => `${domain}: 移除配置 ${key}`,
      adjusted: (domain) => `${domain}: 调整了配置`,
    },
    markdown: {
      addHeading: (name, headings) => `${name}: 新增章节「${headings.join('」、「')}」`,
      removeHeading: (name, headings) => `${name}: 移除章节「${headings.join('」、「')}」`,
      updated: (name) => `${name}: 更新文档内容`,
    },
    code: {
      newStrings: (strings) => `更新文案：${strings.slice(0, 2).join('、')}${strings.length > 2 ? '等' : ''}`,
      removedStrings: (strings) => `移除文案：${strings.slice(0, 2).join('、')}${strings.length > 2 ? '等' : ''}`,
      newExports: (exports) => `新增功能：${exports.join('、')}`,
      removedExports: (exports) => `移除功能：${exports.join('、')}`,
    },
    summary: {
      fixFiles: (n) => `修复了 ${n} 个文件`,
      updateFiles: (n) => `更新了 ${n} 个文件`,
    },
    domain: {
      components: '组件', pages: '页面', views: '视图', layouts: '布局',
      hooks: '钩子逻辑', utils: '工具函数', services: '服务层', api: 'API 接口',
      store: '状态管理', models: '数据模型', routes: '路由', router: '路由',
      middleware: '中间件', controllers: '控制器', config: '配置', constants: '常量',
      types: '类型定义', assets: '静态资源', styles: '样式', test: '测试',
      tests: '测试', spec: '测试', commands: '命令模块', lib: '核心库',
      scripts: '脚本', docs: '文档', migrations: '数据库迁移', seeds: '数据填充',
      validators: '校验逻辑', helpers: '辅助函数', mixins: '混入逻辑', plugins: '插件',
      modules: '模块', templates: '模板', public: '公共资源', src: '源码',
    },
    filePatterns: {
      'login|signin|sign-in': '登录', 'register|signup|sign-up': '注册',
      'user|profile|account': '用户', 'order|cart|checkout': '订单/购物车',
      'product|goods|item': '商品', 'pay|payment|billing': '支付',
      'auth|token|session|permission': '认证授权', 'upload|download|file': '文件处理',
      'search|filter|sort': '搜索/筛选', 'notify|notification|message|msg': '消息通知',
      'setting|config|option': '设置', 'dashboard|admin|manage': '管理后台',
      'home|index|main': '首页', 'detail|info': '详情页', 'list|table|grid': '列表/表格',
      'form|input|editor': '表单/编辑器', 'error|404|500|exception': '错误处理',
      'log|logger|track': '日志/埋点', 'cache|redis|storage': '缓存/存储',
      'db|database|sql|query': '数据库', 'http|request|fetch|axios|api': '网络请求',
      'router|route|nav': '路由导航', 'layout|header|footer|sidebar': '页面布局',
      'button|modal|dialog|toast|alert': 'UI 组件', 'validate|check|verify': '数据校验',
      'format|parse|transform|convert': '数据转换', 'export|import|excel|csv': '数据导入导出',
      'chart|graph|echart|d3': '图表', 'i18n|locale|lang|zh|en': '国际化',
      'theme|dark|light|color': '主题样式', 'test|spec|mock': '测试',
      'readme|changelog': '文档', 'package\\.json': '项目依赖',
      'docker|nginx|deploy': '部署', 'ci|cd|jenkins|github': 'CI/CD',
      'commit|hook|git': 'Git 工具',
    },
  },
  en: {
    status: { A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed', unknown: 'Changed' },
    fallback: {
      addedLines: (n) => `Added ${n} line(s)`,
      removedLines: (n) => `Removed ${n} line(s)`,
      adjustedLines: (add, del) => `Added ${add} line(s), removed ${del} line(s)`,
    },
    style: {
      display: 'Adjust display', position: 'Adjust positioning', width: 'Adjust width',
      height: 'Adjust height', margin: 'Adjust margin', padding: 'Adjust padding',
      color: 'Adjust color', background: 'Adjust background', 'font-size': 'Adjust font size',
      'font-weight': 'Adjust font weight', border: 'Adjust border', 'border-radius': 'Adjust border radius',
      'box-shadow': 'Add shadow effect', opacity: 'Adjust opacity', transform: 'Add transform effect',
      transition: 'Add transition', animation: 'Add animation', flex: 'Adjust flex layout',
      grid: 'Adjust grid layout', 'z-index': 'Adjust z-index', overflow: 'Adjust overflow',
      cursor: 'Adjust cursor style', visibility: 'Adjust visibility', 'text-align': 'Adjust text alignment',
      'line-height': 'Adjust line height',
      moreSuffix: 'and more', removedStyles: 'Removed some styles', adjustedStyles: 'Adjusted styles',
    },
    config: {
      set: (key, val) => `Set config ${key} to ${val}`,
      remove: (key) => `Removed config ${key}`,
      updated: (name) => `${name}: Updated config`,
    },
    json: {
      addDep: (name, ver) => `Install dependency: ${name} ${ver}`,
      removeDep: (name) => `Remove dependency: ${name}`,
      setProp: (domain, key, val) => `${domain}: Set ${key} to ${val}`,
      removeProp: (domain, key) => `${domain}: Removed config ${key}`,
      adjusted: (domain) => `${domain}: Adjusted config`,
    },
    markdown: {
      addHeading: (name, headings) => `${name}: Added section "${headings.join('", "')}"`,
      removeHeading: (name, headings) => `${name}: Removed section "${headings.join('", "')}"`,
      updated: (name) => `${name}: Updated documentation`,
    },
    code: {
      newStrings: (strings) => `Updated text: ${strings.slice(0, 2).join(', ')}${strings.length > 2 ? ' etc' : ''}`,
      removedStrings: (strings) => `Removed text: ${strings.slice(0, 2).join(', ')}${strings.length > 2 ? ' etc' : ''}`,
      newExports: (exports) => `Added feature: ${exports.join(', ')}`,
      removedExports: (exports) => `Removed feature: ${exports.join(', ')}`,
    },
    summary: {
      fixFiles: (n) => `Fixed ${n} file(s)`,
      updateFiles: (n) => `Updated ${n} file(s)`,
    },
    domain: {
      components: 'Components', pages: 'Pages', views: 'Views', layouts: 'Layouts',
      hooks: 'Hooks', utils: 'Utils', services: 'Services', api: 'API',
      store: 'State', models: 'Models', routes: 'Routes', router: 'Router',
      middleware: 'Middleware', controllers: 'Controllers', config: 'Config', constants: 'Constants',
      types: 'Types', assets: 'Assets', styles: 'Styles', test: 'Tests',
      tests: 'Tests', spec: 'Tests', commands: 'Commands', lib: 'Core lib',
      scripts: 'Scripts', docs: 'Docs', migrations: 'Migrations', seeds: 'Seeds',
      validators: 'Validators', helpers: 'Helpers', mixins: 'Mixins', plugins: 'Plugins',
      modules: 'Modules', templates: 'Templates', public: 'Public', src: 'Source',
    },
    filePatterns: {
      'login|signin|sign-in': 'Login', 'register|signup|sign-up': 'Register',
      'user|profile|account': 'User', 'order|cart|checkout': 'Order/Cart',
      'product|goods|item': 'Product', 'pay|payment|billing': 'Payment',
      'auth|token|session|permission': 'Auth', 'upload|download|file': 'File',
      'search|filter|sort': 'Search/Filter', 'notify|notification|message|msg': 'Notification',
      'setting|config|option': 'Settings', 'dashboard|admin|manage': 'Dashboard',
      'home|index|main': 'Home', 'detail|info': 'Detail', 'list|table|grid': 'List/Table',
      'form|input|editor': 'Form/Editor', 'error|404|500|exception': 'Error handling',
      'log|logger|track': 'Logging', 'cache|redis|storage': 'Cache/Storage',
      'db|database|sql|query': 'Database', 'http|request|fetch|axios|api': 'Network',
      'router|route|nav': 'Routing', 'layout|header|footer|sidebar': 'Layout',
      'button|modal|dialog|toast|alert': 'UI Components', 'validate|check|verify': 'Validation',
      'format|parse|transform|convert': 'Data transform', 'export|import|excel|csv': 'Import/Export',
      'chart|graph|echart|d3': 'Charts', 'i18n|locale|lang|zh|en': 'i18n',
      'theme|dark|light|color': 'Theme', 'test|spec|mock': 'Tests',
      'readme|changelog': 'Docs', 'package\\.json': 'Dependencies',
      'docker|nginx|deploy': 'Deploy', 'ci|cd|jenkins|github': 'CI/CD',
      'commit|hook|git': 'Git tools',
    },
  },
};

/**
 * 获取当前语言词库
 * @returns {Object} 对应语言的词库对象
 */
function getI18n() {
  const config = loadConfig();
  const lang = config.language || 'zh';
  return i18n[lang] || i18n.zh;
}

/**
 * 获取单个文件的详细 diff
 * @param {string} file - 文件路径
 * @param {boolean} staged - 是否仅暂存区（true=--cached，false=工作区）
 * @returns {string} diff 内容
 */
function getFileDiff(file, staged = true) {
  const flag = staged ? '--cached' : '';       // 暂存区加 --cached 参数
  return runGit(`diff ${flag} -- "${file}"`);   // -- "file" 避免文件名含特殊字符时出错
}

/**
 * 分析单个文件的 diff，生成业务语义描述
 *
 * 不再用正则去匹配函数名、类名等技术细节，
 * 而是根据文件类型、目录路径、变更模式来推断业务含义。
 *
 * @param {string} filePath - 文件路径
 * @param {string} diff - diff 内容
 * @returns {string[]} 业务语义描述列表
 */
function analyzeFileDiff(filePath, diff) {
  const lines = diff.split('\n');              // 将 diff 按行分割
  const fileName = path.basename(filePath);     // 提取文件名（不含路径）
  const ext = path.extname(filePath).toLowerCase(); // 提取扩展名（如 .js）
  const dirName = path.dirname(filePath).split('/').pop() || ''; // 提取父目录名

  // 解析新增行：以 + 开头但不是 +++ 的行（+++ 是 diff 头部信息）
  const addedLines = lines
    .filter(l => l.startsWith('+') && !l.startsWith('+++'))
    .map(l => l.slice(1).trim())               // 去掉行首的 + 符号
    .filter(Boolean);                           // 过滤空行

  // 解析删除行：以 - 开头但不是 --- 的行（--- 是 diff 头部信息）
  const deletedLines = lines
    .filter(l => l.startsWith('-') && !l.startsWith('---'))
    .map(l => l.slice(1).trim())               // 去掉行首的 - 符号
    .filter(Boolean);                           // 过滤空行

  // 获取上下文行（用于理解代码块的用途）
  const contextBefore = new Set();              // 用 Set 去重
  const contextAfter = new Set();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 新增行：找它前面最近的上下文行
    if (line.startsWith('+') && !line.startsWith('+++')) {
      for (let j = i - 1; j >= 0; j--) {
        if (lines[j].startsWith(' ') || lines[j].startsWith('-')) {
          const ctx = lines[j].slice(1).trim(); // 去掉行首空格或 - 符号
          if (ctx && !ctx.startsWith('//')) contextBefore.add(ctx); // 排除注释行
          break;                                 // 只取最近的上下文行
        }
      }
    }
    // 删除行：找它后面最近的上下文行
    if (line.startsWith('-') && !line.startsWith('---')) {
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].startsWith(' ') || lines[j].startsWith('+')) {
          const ctx = lines[j].slice(1).trim();
          if (ctx && !ctx.startsWith('//')) contextAfter.add(ctx);
          break;
        }
      }
    }
  }

  const descriptions = [];

  // ====== 提取注释中的业务语义（注释通常直接描述了意图）======
  const commentDescriptions = extractCommentDescriptions(addedLines);
  for (const d of commentDescriptions) {
    descriptions.push(d);
  }

  // ====== 根据文件路径和扩展名推断业务语义 ======
  const fileTypeDescriptions = getFileTypeDescriptions(filePath, fileName, ext, dirName, addedLines, deletedLines);
  for (const d of fileTypeDescriptions) {
    descriptions.push(d);
  }

  // ====== 兜底：用变更行数和文件名生成基础描述 ======
  // 当以上分析都没有产出描述时，用最简单的信息兜底
  if (descriptions.length === 0) {
    const t = getI18n();
    if (addedLines.length > 0 && deletedLines.length > 0) {
      descriptions.push(`${fileName}: ${t.fallback.adjustedLines(addedLines.length, deletedLines.length)}`);
    } else if (addedLines.length > 0) {
      descriptions.push(`${fileName}: ${t.fallback.addedLines(addedLines.length)}`);
    } else if (deletedLines.length > 0) {
      descriptions.push(`${fileName}: ${t.fallback.removedLines(deletedLines.length)}`);
    }
  }

  return descriptions;
}

/**
 * 从新增行的注释中提取业务描述
 * 注释通常包含开发者写下的意图说明，是业务语义的最佳来源
 *
 * @param {string[]} lines - 新增的代码行
 * @returns {string[]} 从注释中提取的描述列表
 */
function extractCommentDescriptions(lines) {
  const descriptions = [];

  for (const line of lines) {
    // 单行注释 // ... ：提取注释内容
    const commentMatch = line.match(/^\s*\/\/\s*(.+)/);
    if (commentMatch) {
      const comment = commentMatch[1].trim();
      // 过滤太短的注释（<3字符）和标记类注释（TODO/FIXME/eslint 等无业务含义）
      if (comment && comment.length > 3 && !/^(TODO|FIXME|HACK|eslint|prettier)/i.test(comment)) {
        descriptions.push(comment);
      }
    }
    // 多行注释 /* ... */ ：提取块注释内容
    const blockMatch = line.match(/^\s*\/\*\*?\s*(.+?)\s*\*\/?$/);
    if (blockMatch) {
      const comment = blockMatch[1].trim();
      if (comment && comment.length > 3) {
        descriptions.push(comment);
      }
    }
  }

  return descriptions;
}

/**
 * 根据文件类型和路径生成业务语义描述
 * 不同类型的文件有不同的分析策略
 *
 * @param {string} filePath - 文件完整路径
 * @param {string} fileName - 文件名
 * @param {string} ext - 扩展名
 * @param {string} dirName - 父目录名
 * @param {string[]} addedLines - 新增行
 * @param {string[]} deletedLines - 删除行
 * @returns {string[]} 描述列表
 */
function getFileTypeDescriptions(filePath, fileName, ext, dirName, addedLines, deletedLines) {
  const descriptions = [];

  // ---- JSON 文件 ----
  if (ext === '.json') {
    return analyzeJsonFile(filePath, fileName, addedLines, deletedLines);
  }

  // ---- Markdown 文件 ----
  if (ext === '.md') {
    return analyzeMarkdownFile(fileName, addedLines, deletedLines);
  }

  // ---- 样式文件 ----
  if (['.css', '.scss', '.less', '.sass'].includes(ext)) {
    return analyzeStyleFile(filePath, fileName, dirName, addedLines, deletedLines);
  }

  // ---- .env / 配置文件 ----
  if (fileName.startsWith('.env') || fileName.endsWith('.conf') || fileName.endsWith('.config')) {
    return analyzeConfigFile(fileName, addedLines, deletedLines);
  }

  // ---- 代码文件：根据目录/文件名推断功能域 ----
  const domain = inferDomain(filePath, dirName, fileName); // 推断业务功能域

  // 检测字符串文本变更（通常包含用户可见的文案）
  const stringChanges = detectStringChanges(addedLines, deletedLines);
  if (stringChanges.length > 0) {
    descriptions.push(`${domain}: ${stringChanges.join('；')}`);
  }

  // 检测新增/删除的导出内容（通常是新增的功能模块）
  const exportChanges = detectExportChanges(addedLines, deletedLines);
  if (exportChanges.length > 0) {
    descriptions.push(`${domain}: ${exportChanges.join('；')}`);
  }

  // 如果提取到了描述就直接返回，否则用文件级兜底
  if (descriptions.length > 0) {
    return descriptions;
  }

  // 兜底：当以上所有分析都无法提取有意义描述时
  const t = getI18n();
  const changes = [];
  if (addedLines.length > 0) changes.push(t.fallback.addedLines(addedLines.length));
  if (deletedLines.length > 0) changes.push(t.fallback.removedLines(deletedLines.length));
  if (changes.length > 0) {
    descriptions.push(`${domain}: ${changes.join(t === i18n.zh ? '，' : ', ')}`);
  }

  return descriptions;
}

/**
 * 根据文件路径和目录名推断业务功能域
 * 优先级：文件名模式匹配 > 目录名匹配 > 文件名本身
 *
 * @param {string} filePath - 文件完整路径
 * @param {string} dirName - 父目录名
 * @param {string} fileName - 文件名
 * @returns {string} 功能域名称
 */
function inferDomain(filePath, dirName, fileName) {
  const t = getI18n();
  // 去掉扩展名得到基础文件名
  const baseName = fileName.replace(/\.[^.]+$/, '');

  // 目录名到功能域的映射
  const dirDomainMap = t.domain;

  // 文件名模式到功能域的映射（通过正则匹配文件名关键词推断业务领域）
  const fileNamePatterns = Object.entries(t.filePatterns).map(([pattern, domain]) => ({
    pattern: new RegExp(pattern, 'i'),
    domain,
  }));

  // 优先用文件名匹配（更精确）
  for (const { pattern, domain } of fileNamePatterns) {
    if (pattern.test(baseName) || pattern.test(fileName)) {
      return domain;
    }
  }

  // 其次用目录名匹配（次精确）
  if (dirDomainMap[dirName]) {
    return dirDomainMap[dirName];
  }

  // 兜底：直接用文件名本身（去掉扩展名）
  return baseName || fileName;
}

/**
 * 检测字符串文本变更（用户可见文案的修改）
 * 通过正则匹配中文内容判断是否为文案变更
 *
 * @param {string[]} addedLines - 新增行
 * @param {string[]} deletedLines - 删除行
 * @returns {string[]} 文案变更描述列表
 */
function detectStringChanges(addedLines, deletedLines) {
  const t = getI18n();
  const changes = [];

  // 检测新增的中文文案
  const newStrings = [];
  for (const line of addedLines) {
    // 匹配引号包裹的包含中文的字符串
    const strMatch = line.match(/['"`]([^'"`]*[\u4e00-\u9fa5][^'"`]*)['"`]/);
    if (strMatch) {
      newStrings.push(strMatch[1]);              // 提取字符串内容
    }
  }
  if (newStrings.length > 0) {
    changes.push(t.code.newStrings(newStrings));
  }

  // 检测删除的中文文案
  const delStrings = [];
  for (const line of deletedLines) {
    const strMatch = line.match(/['"`]([^'"`]*[\u4e00-\u9fa5][^'"`]*)['"`]/);
    if (strMatch) {
      delStrings.push(strMatch[1]);
    }
  }
  // 只有删除没有新增时，才报告「移除文案」
  if (delStrings.length > 0 && newStrings.length === 0) {
    changes.push(t.code.removedStrings(delStrings));
  }

  return changes;
}

/**
 * 检测导出内容的变化（新增/移除的功能模块）
 * 通过匹配 export 语句和 module.exports 判断模块级变更
 *
 * @param {string[]} addedLines - 新增行
 * @param {string[]} deletedLines - 删除行
 * @returns {string[]} 导出变更描述列表
 */
function detectExportChanges(addedLines, deletedLines) {
  const t = getI18n();
  const changes = [];

  // 检测新增的导出
  const newExports = [];
  for (const line of addedLines) {
    // ES6 export：export default/const/let/var/function/class/enum/interface/type
    const expMatch = line.match(/export\s+(default\s+)?(?:const|let|var|function|class|enum|interface|type)?\s*(\w+)/);
    if (expMatch) {
      newExports.push(expMatch[2]);              // 提取导出名
    }
    // CommonJS：module.exports = xxx
    const modExp = line.match(/module\.exports\s*=\s*(\w+)/);
    if (modExp) {
      newExports.push(modExp[1]);
    }
  }
  if (newExports.length > 0) {
    changes.push(t.code.newExports(newExports));
  }

  // 检测删除的导出
  const delExports = [];
  for (const line of deletedLines) {
    const expMatch = line.match(/export\s+(default\s+)?(?:const|let|var|function|class)\s+(\w+)/);
    if (expMatch) {
      delExports.push(expMatch[2]);
    }
  }
  if (delExports.length > 0) {
    changes.push(t.code.removedExports(delExports));
  }

  return changes;
}

// ====== JSON 文件分析 ======

/**
 * 分析 JSON 文件的变更
 * 特殊处理 package.json（依赖变更），其他 JSON 按配置变更处理
 *
 * @param {string} filePath - 文件路径
 * @param {string} fileName - 文件名
 * @param {string[]} addedLines - 新增行
 * @param {string[]} deletedLines - 删除行
 * @returns {string[]} 描述列表
 */
function analyzeJsonFile(filePath, fileName, addedLines, deletedLines) {
  const t = getI18n();
  const descriptions = [];

  // package.json 特殊处理：识别依赖变更
  if (fileName === 'package.json') {
    // 新增依赖
    for (const line of addedLines) {
      const depMatch = line.match(/"([@\w\/-]+)"\s*:\s*"([^"]+)"/); // 匹配 "包名": "版本号"
      if (depMatch) {
        descriptions.push(t.json.addDep(depMatch[1], depMatch[2]));
      }
    }
    // 删除依赖
    for (const line of deletedLines) {
      const depMatch = line.match(/"([@\w\/-]+)"\s*:\s*"([^"]+)"/);
      if (depMatch) {
        descriptions.push(t.json.removeDep(depMatch[1]));
      }
    }
    return descriptions;
  }

  // 其他 JSON 配置文件
  const domain = inferDomain(filePath, path.dirname(filePath).split('/').pop() || '', fileName);

  // 提取新增/修改的配置项
  for (const line of addedLines) {
    const match = line.match(/"(\w+)"\s*:\s*(.+)/); // 匹配 "key": value
    if (match) {
      const key = match[1];
      let value = match[2].replace(/[",]/g, '').trim(); // 去掉引号和逗号
      if (value.length > 30) value = value.slice(0, 30) + '...'; // 值太长截断显示
      descriptions.push(t.json.setProp(domain, key, value));
    }
  }
  // 提取删除的配置项
  for (const line of deletedLines) {
    const match = line.match(/"(\w+)"\s*:\s*(.+)/);
    if (match) {
      descriptions.push(t.json.removeProp(domain, match[1]));
    }
  }

  // 兜底
  if (descriptions.length === 0) {
    descriptions.push(t.json.adjusted(domain));
  }
  return descriptions;
}

// ====== Markdown 文件分析 ======

/**
 * 分析 Markdown 文件的变更
 * 主要检测标题级别的变更（新增/删除章节）
 *
 * @param {string} fileName - 文件名
 * @param {string[]} addedLines - 新增行
 * @param {string[]} deletedLines - 删除行
 * @returns {string[]} 描述列表
 */
function analyzeMarkdownFile(fileName, addedLines, deletedLines) {
  const t = getI18n();
  const descriptions = [];

  // 提取新增的标题（# 开头的行）
  const newHeadings = [];
  for (const line of addedLines) {
    const h = line.match(/^(#{1,6})\s+(.+)/);    // 匹配 1-6 级标题
    if (h) newHeadings.push(h[2]);                // 提取标题文本
  }
  // 提取删除的标题
  const delHeadings = [];
  for (const line of deletedLines) {
    const h = line.match(/^(#{1,6})\s+(.+)/);
    if (h) delHeadings.push(h[2]);
  }

  if (newHeadings.length > 0) {
    descriptions.push(t.markdown.addHeading(fileName, newHeadings));
  }
  if (delHeadings.length > 0) {
    descriptions.push(t.markdown.removeHeading(fileName, delHeadings));
  }

  // 兜底
  if (descriptions.length === 0) {
    descriptions.push(t.markdown.updated(fileName));
  }

  return descriptions;
}

// ====== 样式文件分析 ======

/**
 * 分析样式文件（CSS/SCSS/Less/Sass）的变更
 * 提取 CSS 属性变更，归类为功能描述
 *
 * @param {string} filePath - 文件路径
 * @param {string} fileName - 文件名
 * @param {string} dirName - 父目录名
 * @param {string[]} addedLines - 新增行
 * @param {string[]} deletedLines - 删除行
 * @returns {string[]} 描述列表
 */
function analyzeStyleFile(filePath, fileName, dirName, addedLines, deletedLines) {
  const t = getI18n();
  const domain = inferDomain(filePath, dirName, fileName);

  // 提取新增的 CSS 属性名
  const newProps = new Set();                      // 用 Set 自动去重
  for (const line of addedLines) {
    const m = line.match(/^\s*([\w-]+)\s*:/);     // 匹配 "属性名:" 格式
    if (m) newProps.add(m[1]);                     // 添加属性名
  }
  // 提取删除的 CSS 属性名
  const delProps = new Set();
  for (const line of deletedLines) {
    const m = line.match(/^\s*([\w-]+)\s*:/);
    if (m) delProps.add(m[1]);
  }

  const descriptions = [];

  if (newProps.size > 0) {
    // CSS 属性名到功能描述的映射（使用 i18n）
    const styleMap = t.style;

    // 过滤掉同时新增和删除的属性（可能是属性值变更，不算新增）
    const meaningful = [...newProps].filter(p => !delProps.has(p));
    if (meaningful.length > 0) {
      const humanDescs = meaningful.map(p => styleMap[p] || p).filter(d => d.length > 0);
      if (humanDescs.length > 0) {
        // 最多展示 3 种属性变更
        const suffix = humanDescs.length > 3 ? t.style.moreSuffix : '';
        descriptions.push(`${domain}: ${humanDescs.slice(0, 3).join(t === i18n.zh ? '、' : ', ')}${suffix}`);
      }
    }
  }

  // 只有删除没有新增
  if (delProps.size > 0 && descriptions.length === 0) {
    descriptions.push(`${domain}: ${t.style.removedStyles}`);
  }

  // 兜底
  if (descriptions.length === 0) {
    descriptions.push(`${domain}: ${t.style.adjustedStyles}`);
  }

  return descriptions;
}

// ====== 配置文件分析 ======

/**
 * 分析配置文件（.env、.conf、.config 等）的变更
 * 匹配 KEY=VALUE 格式的行
 *
 * @param {string} fileName - 文件名
 * @param {string[]} addedLines - 新增行
 * @param {string[]} deletedLines - 删除行
 * @returns {string[]} 描述列表
 */
function analyzeConfigFile(fileName, addedLines, deletedLines) {
  const t = getI18n();
  const descriptions = [];

  // 提取新增的配置项：KEY=VALUE 格式
  for (const line of addedLines) {
    const m = line.match(/^(\w+)\s*=\s*(.+)/);
    if (m) {
      const val = m[2].length > 30 ? m[2].slice(0, 30) + '...' : m[2]; // 值太长截断
      descriptions.push(t.config.set(m[1], val));
    }
  }
  // 提取删除的配置项
  for (const line of deletedLines) {
    const m = line.match(/^(\w+)\s*=\s*(.+)/);
    if (m) {
      descriptions.push(t.config.remove(m[1]));
    }
  }

  // 兜底
  if (descriptions.length === 0) {
    descriptions.push(t.config.updated(fileName));
  }

  return descriptions;
}

// ====== Commit 类型检测 ======

/**
 * 根据变更文件列表和 diff 内容，自动推断 commit type
 * 通过遍历配置中的 typeRules，按正则匹配文件路径和变更内容
 *
 * @param {Array} files - 暂存文件列表 [{status, file}]
 * @param {string} diffDetail - diff 内容（用于内容匹配）
 * @returns {string} 推断出的 commit type
 */
function detectCommitType(files, diffDetail) {
  const config = loadConfig();                                     // 加载配置
  // 将所有文件路径、状态和 diff 内容合并为一段文本，用于正则匹配
  const allText = files.map((f) => f.file + ' ' + f.status).join(' ') + ' ' + diffDetail;

  for (const rule of config.typeRules) {
    if (rule.pattern.test(allText)) {                              // 用配置中的正则匹配
      return rule.type;                                            // 返回匹配到的 type
    }
  }

  return config.defaultType;                                       // 没有匹配到则返回默认 type
}

// ====== Scope 提取 ======

/**
 * 从变更文件列表中提取公共路径前缀作为 scope
 * 通过找所有文件路径的最长公共前缀来实现
 *
 * @param {Array} files - 暂存文件列表 [{file: 'src/auth/login.js'}, ...]
 * @returns {string} 公共路径前缀（如 'src/auth'）
 */
function generateScope(files) {
  if (files.length === 0) return '';

  // 提取每个文件的目录路径（去掉文件名部分）
  const dirs = files
    .map((f) => {
      const parts = f.file.split('/');
      return parts.length > 1 ? parts.slice(0, -1).join('/') : ''; // 多级路径取目录部分
    })
    .filter(Boolean);                                              // 过滤空目录（根目录文件）

  if (dirs.length === 0) return '';

  // 找所有目录的最长公共前缀
  let common = dirs[0];
  for (let i = 1; i < dirs.length; i++) {
    while (!dirs[i].startsWith(common)) {
      common = common.slice(0, -1);                                // 逐字符缩短
      if (common === '') return '';                                // 没有公共前缀
    }
  }
  return common.replace(/\/$/, '');                                // 去掉末尾的 /
}

// ====== 核心函数：生成 Commit Message ======

/**
 * 生成完整的 commit message
 * 1. 检测 type（通过 typeRules 正则匹配）
 * 2. 提取 scope（文件路径的公共前缀）
 * 3. 逐文件分析 diff，生成业务语义描述
 * 4. 生成标题（摘要）+ 详细列表
 *
 * @param {Array} files - 暂存文件列表 [{status, file}]
 * @param {string} diffStat - diff --stat 输出（用于 type 检测的辅助文本）
 * @returns {{type, scope, message}} 生成的 commit message 信息
 */
function generateCommitMessage(files, diffStat) {
  const type = detectCommitType(files, diffStat);  // 自动检测 commit type
  const scope = generateScope(files);               // 自动提取 scope
  const scopeStr = scope ? `(${scope})` : '';       // 有 scope 则加括号

  // 对每个文件进行语义分析
  const fileAnalyses = [];
  for (const f of files) {
    const fileDiff = getFileDiff(f.file, true);     // 获取单文件的详细 diff
    if (fileDiff) {
      const changes = analyzeFileDiff(f.file, fileDiff); // 分析 diff 生成业务描述
      if (changes.length > 0) {
        fileAnalyses.push({ file: f.file, status: f.status, changes });
      }
    }
  }

  // 生成摘要标题（type(scope): 摘要）
  const summary = generateSummary(files, fileAnalyses, type);

  // 生成详细列表（每项 - 开头）
  const details = generateDetailList(fileAnalyses);

  // 拼接完整 message：标题 + 空行 + 详细列表
  const header = `${type}${scopeStr}: ${summary}`;
  const message = details.length > 0
    ? `${header}\n\n${details}`
    : header;                                        // 无详情时只用标题

  return { type, scope, message };
}

/**
 * 生成摘要标题
 * 取最有代表性的 1-2 条业务描述作为标题
 *
 * @param {Array} files - 文件列表
 * @param {Array} fileAnalyses - 文件分析结果
 * @param {string} type - commit type
 * @returns {string} 摘要文本
 */
function generateSummary(files, fileAnalyses, type) {
  const t = getI18n();
  // 展开所有文件的变更描述
  const allChanges = fileAnalyses.flatMap(a => a.changes);

  if (allChanges.length === 0) {
    // 无分析结果时：用文件状态 + 文件名拼接兜底标题
    const statusLabels = t.status;
    const statuses = [...new Set(files.map(f => statusLabels[f.status] || statusLabels.unknown))]; // 去重状态
    const names = files.map(f => path.basename(f.file, path.extname(f.file)));       // 文件名（无扩展名）
    const sep = t === i18n.zh ? '、' : ', ';
    return `${statuses.join(sep)} ${names.join(sep)}`;
  }

  // 取最有代表性的 1-2 条描述
  const top = allChanges.slice(0, 2)
    .map(c => c.replace(/^[^:]+:\s*/, ''))  // 去掉「文件名:」前缀，只保留描述内容
    .filter(Boolean);

  if (top.length === 0) {
    return type === 'fix' ? t.summary.fixFiles(files.length) : t.summary.updateFiles(files.length);
  }

  return top.join(t === i18n.zh ? '，' : ', ');
}

/**
 * 生成详细列表
 * 每个变更项以 "- " 开头
 * 单文件：直接列出改动
 * 多文件：按文件分组列出
 *
 * @param {Array} fileAnalyses - 文件分析结果
 * @returns {string} 详细列表文本
 */
function generateDetailList(fileAnalyses) {
  if (fileAnalyses.length === 0) return '';

  const lines = [];

  // 如果只有一个文件，直接列出改动（不带文件名前缀）
  if (fileAnalyses.length === 1) {
    for (const change of fileAnalyses[0].changes) {
      lines.push(`- ${change}`);
    }
    return lines.join('\n');
  }

  // 多个文件：按文件分组
  for (const analysis of fileAnalyses) {
    const fileName = path.basename(analysis.file); // 文件名
    const dir = path.dirname(analysis.file);       // 目录路径
    // 构建文件标识：有目录则显示 目录/文件名，否则只显示文件名
    const fileLabel = dir && dir !== '.' ? `${dir}/${fileName}` : fileName;

    if (analysis.changes.length === 1) {
      // 单个变更：直接列出
      lines.push(`- ${analysis.changes[0]}`);
    } else {
      // 多个变更：先列文件名，再缩进列出各项
      lines.push(`- ${fileLabel}`);
      for (const change of analysis.changes) {
        lines.push(`  - ${change}`);
      }
    }
  }

  return lines.join('\n');
}

module.exports = { generateCommitMessage };
