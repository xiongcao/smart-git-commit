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

/**
 * 获取单个文件的详细 diff
 */
function getFileDiff(file, staged = true) {
  const flag = staged ? '--cached' : '';
  return runGit(`diff ${flag} -- "${file}"`);
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
  const lines = diff.split('\n');
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const dirName = path.dirname(filePath).split('/').pop() || '';

  // 解析新增行和删除行
  const addedLines = lines
    .filter(l => l.startsWith('+') && !l.startsWith('+++'))
    .map(l => l.slice(1).trim())
    .filter(Boolean);

  const deletedLines = lines
    .filter(l => l.startsWith('-') && !l.startsWith('---'))
    .map(l => l.slice(1).trim())
    .filter(Boolean);

  // 获取上下文行（用于理解代码块的目的）
  const contextBefore = new Set();
  const contextAfter = new Set();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('+') && !line.startsWith('+++')) {
      // 找前面的上下文行
      for (let j = i - 1; j >= 0; j--) {
        if (lines[j].startsWith(' ') || lines[j].startsWith('-')) {
          const ctx = lines[j].slice(1).trim();
          if (ctx && !ctx.startsWith('//')) contextBefore.add(ctx);
          break;
        }
      }
    }
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
  if (descriptions.length === 0) {
    if (addedLines.length > 0 && deletedLines.length > 0) {
      descriptions.push(`${fileName}: 调整了 ${addedLines.length} 行，移除了 ${deletedLines.length} 行`);
    } else if (addedLines.length > 0) {
      descriptions.push(`${fileName}: 新增了 ${addedLines.length} 行`);
    } else if (deletedLines.length > 0) {
      descriptions.push(`${fileName}: 移除了 ${deletedLines.length} 行`);
    }
  }

  return descriptions;
}

/**
 * 从新增行的注释中提取业务描述
 */
function extractCommentDescriptions(lines) {
  const descriptions = [];

  for (const line of lines) {
    // 单行注释 // TODO / FIXME / NOTE / HACK
    const commentMatch = line.match(/^\s*\/\/\s*(.+)/);
    if (commentMatch) {
      const comment = commentMatch[1].trim();
      if (comment && comment.length > 3 && !/^(TODO|FIXME|HACK|eslint|prettier)/i.test(comment)) {
        descriptions.push(comment);
      }
    }
    // 多行注释 /* ... */
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
  const domain = inferDomain(filePath, dirName, fileName);

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

  // 兜底
  const changes = [];
  if (addedLines.length > 0) changes.push(`新增 ${addedLines.length} 行`);
  if (deletedLines.length > 0) changes.push(`移除 ${deletedLines.length} 行`);
  if (changes.length > 0) {
    descriptions.push(`${domain}: ${changes.join('，')}`);
  }

  return descriptions;
}

/**
 * 根据文件路径和目录名推断业务功能域
 */
function inferDomain(filePath, dirName, fileName) {
  // 去掉扩展名
  const baseName = fileName.replace(/\.[^.]+$/, '');

  // 目录名映射
  const dirDomainMap = {
    'components': '组件',
    'pages': '页面',
    'views': '视图',
    'layouts': '布局',
    'hooks': '钩子逻辑',
    'utils': '工具函数',
    'services': '服务层',
    'api': 'API 接口',
    'store': '状态管理',
    'models': '数据模型',
    'routes': '路由',
    'router': '路由',
    'middleware': '中间件',
    'controllers': '控制器',
    'config': '配置',
    'constants': '常量',
    'types': '类型定义',
    'assets': '静态资源',
    'styles': '样式',
    'test': '测试',
    'tests': '测试',
    'spec': '测试',
    'commands': '命令模块',
    'lib': '核心库',
    'scripts': '脚本',
    'docs': '文档',
    'migrations': '数据库迁移',
    'seeds': '数据填充',
    'validators': '校验逻辑',
    'helpers': '辅助函数',
    'mixins': '混入逻辑',
    'plugins': '插件',
    'modules': '模块',
    'templates': '模板',
    'public': '公共资源',
    'src': '源码',
  };

  // 文件名模式映射
  const fileNamePatterns = [
    { pattern: /login|signin|sign-in/i, domain: '登录' },
    { pattern: /register|signup|sign-up/i, domain: '注册' },
    { pattern: /user|profile|account/i, domain: '用户' },
    { pattern: /order|cart|checkout/i, domain: '订单/购物车' },
    { pattern: /product|goods|item/i, domain: '商品' },
    { pattern: /pay|payment|billing/i, domain: '支付' },
    { pattern: /auth|token|session|permission/i, domain: '认证授权' },
    { pattern: /upload|download|file/i, domain: '文件处理' },
    { pattern: /search|filter|sort/i, domain: '搜索/筛选' },
    { pattern: /notify|notification|message|msg/i, domain: '消息通知' },
    { pattern: /setting|config|option/i, domain: '设置' },
    { pattern: /dashboard|admin|manage/i, domain: '管理后台' },
    { pattern: /home|index|main/i, domain: '首页' },
    { pattern: /detail|info/i, domain: '详情页' },
    { pattern: /list|table|grid/i, domain: '列表/表格' },
    { pattern: /form|input|editor/i, domain: '表单/编辑器' },
    { pattern: /error|404|500|exception/i, domain: '错误处理' },
    { pattern: /log|logger|track/i, domain: '日志/埋点' },
    { pattern: /cache|redis|storage/i, domain: '缓存/存储' },
    { pattern: /db|database|sql|query/i, domain: '数据库' },
    { pattern: /http|request|fetch|axios|api/i, domain: '网络请求' },
    { pattern: /router|route|nav/i, domain: '路由导航' },
    { pattern: /layout|header|footer|sidebar/i, domain: '页面布局' },
    { pattern: /button|modal|dialog|toast|alert/i, domain: 'UI 组件' },
    { pattern: /validate|check|verify/i, domain: '数据校验' },
    { pattern: /format|parse|transform|convert/i, domain: '数据转换' },
    { pattern: /export|import|excel|csv/i, domain: '数据导入导出' },
    { pattern: /chart|graph|echart|d3/i, domain: '图表' },
    { pattern: /i18n|locale|lang|zh|en/i, domain: '国际化' },
    { pattern: /theme|dark|light|color/i, domain: '主题样式' },
    { pattern: /test|spec|mock/i, domain: '测试' },
    { pattern: /readme|changelog/i, domain: '文档' },
    { pattern: /package\.json/i, domain: '项目依赖' },
    { pattern: /docker|nginx|deploy/i, domain: '部署' },
    { pattern: /ci|cd|jenkins|github/i, domain: 'CI/CD' },
    { pattern: /commit|hook|git/i, domain: 'Git 工具' },
  ];

  // 优先用文件名匹配
  for (const { pattern, domain } of fileNamePatterns) {
    if (pattern.test(baseName) || pattern.test(fileName)) {
      return domain;
    }
  }

  // 其次用目录名匹配
  if (dirDomainMap[dirName]) {
    return dirDomainMap[dirName];
  }

  // 兜底：文件名本身
  return baseName || fileName;
}

/**
 * 检测字符串文本变更（用户可见文案的修改）
 */
function detectStringChanges(addedLines, deletedLines) {
  const changes = [];

  // 检测新增的中文文案
  const newStrings = [];
  for (const line of addedLines) {
    const strMatch = line.match(/['"`]([^'"`]*[\u4e00-\u9fa5][^'"`]*)['"`]/);
    if (strMatch) {
      newStrings.push(strMatch[1]);
    }
  }
  if (newStrings.length > 0) {
    changes.push(`更新文案：${newStrings.slice(0, 2).join('、')}${newStrings.length > 2 ? '等' : ''}`);
  }

  // 检测删除的中文文案
  const delStrings = [];
  for (const line of deletedLines) {
    const strMatch = line.match(/['"`]([^'"`]*[\u4e00-\u9fa5][^'"`]*)['"`]/);
    if (strMatch) {
      delStrings.push(strMatch[1]);
    }
  }
  if (delStrings.length > 0 && newStrings.length === 0) {
    changes.push(`移除文案：${delStrings.slice(0, 2).join('、')}${delStrings.length > 2 ? '等' : ''}`);
  }

  return changes;
}

/**
 * 检测导出内容的变化（新增/移除的功能模块）
 */
function detectExportChanges(addedLines, deletedLines) {
  const changes = [];

  // 检测新增的导出
  const newExports = [];
  for (const line of addedLines) {
    const expMatch = line.match(/export\s+(default\s+)?(?:const|let|var|function|class|enum|interface|type)?\s*(\w+)/);
    if (expMatch) {
      newExports.push(expMatch[2]);
    }
    // module.exports
    const modExp = line.match(/module\.exports\s*=\s*(\w+)/);
    if (modExp) {
      newExports.push(modExp[1]);
    }
  }
  if (newExports.length > 0) {
    changes.push(`新增功能：${newExports.join('、')}`);
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
    changes.push(`移除功能：${delExports.join('、')}`);
  }

  return changes;
}

// ====== JSON 文件分析 ======

function analyzeJsonFile(filePath, fileName, addedLines, deletedLines) {
  const descriptions = [];

  if (fileName === 'package.json') {
    // 新增依赖
    for (const line of addedLines) {
      const depMatch = line.match(/"([@\w\/-]+)"\s*:\s*"([^"]+)"/);
      if (depMatch) {
        descriptions.push(`安装依赖：${depMatch[1]} ${depMatch[2]}`);
      }
    }
    // 删除依赖
    for (const line of deletedLines) {
      const depMatch = line.match(/"([@\w\/-]+)"\s*:\s*"([^"]+)"/);
      if (depMatch) {
        descriptions.push(`移除依赖：${depMatch[1]}`);
      }
    }
    return descriptions;
  }

  // 其他 JSON 配置文件
  const domain = inferDomain(filePath, path.dirname(filePath).split('/').pop() || '', fileName);

  // 提取新增/修改的配置项
  for (const line of addedLines) {
    const match = line.match(/"(\w+)"\s*:\s*(.+)/);
    if (match) {
      const key = match[1];
      let value = match[2].replace(/[",]/g, '').trim();
      if (value.length > 30) value = value.slice(0, 30) + '...';
      descriptions.push(`${domain}: ${key} 设为 ${value}`);
    }
  }
  for (const line of deletedLines) {
    const match = line.match(/"(\w+)"\s*:\s*(.+)/);
    if (match) {
      descriptions.push(`${domain}: 移除配置 ${match[1]}`);
    }
  }

  if (descriptions.length === 0) {
    descriptions.push(`${domain}: 调整了配置`);
  }
  return descriptions;
}

// ====== Markdown 文件分析 ======

function analyzeMarkdownFile(fileName, addedLines, deletedLines) {
  const descriptions = [];

  // 提取标题变更
  const newHeadings = [];
  for (const line of addedLines) {
    const h = line.match(/^(#{1,6})\s+(.+)/);
    if (h) newHeadings.push(h[2]);
  }
  const delHeadings = [];
  for (const line of deletedLines) {
    const h = line.match(/^(#{1,6})\s+(.+)/);
    if (h) delHeadings.push(h[2]);
  }

  if (newHeadings.length > 0) {
    descriptions.push(`${fileName}: 新增章节「${newHeadings.join('」、「')}」`);
  }
  if (delHeadings.length > 0) {
    descriptions.push(`${fileName}: 移除章节「${delHeadings.join('」、「')}」`);
  }

  if (descriptions.length === 0) {
    descriptions.push(`${fileName}: 更新文档内容`);
  }

  return descriptions;
}

// ====== 样式文件分析 ======

function analyzeStyleFile(filePath, fileName, dirName, addedLines, deletedLines) {
  const domain = inferDomain(filePath, dirName, fileName);

  // 提取新增的 CSS 属性
  const newProps = new Set();
  for (const line of addedLines) {
    const m = line.match(/^\s*([\w-]+)\s*:/);
    if (m) newProps.add(m[1]);
  }
  const delProps = new Set();
  for (const line of deletedLines) {
    const m = line.match(/^\s*([\w-]+)\s*:/);
    if (m) delProps.add(m[1]);
  }

  const descriptions = [];

  if (newProps.size > 0) {
    // 样式属性归类到功能描述
    const styleMap = {
      'display': '调整显示方式',
      'position': '调整定位方式',
      'width': '调整宽度',
      'height': '调整高度',
      'margin': '调整外边距',
      'padding': '调整内边距',
      'color': '调整颜色',
      'background': '调整背景',
      'font-size': '调整字体大小',
      'font-weight': '调整字体粗细',
      'border': '调整边框',
      'border-radius': '调整圆角',
      'box-shadow': '添加阴影效果',
      'opacity': '调整透明度',
      'transform': '添加变换效果',
      'transition': '添加过渡动画',
      'animation': '添加动画效果',
      'flex': '调整弹性布局',
      'grid': '调整网格布局',
      'z-index': '调整层级',
      'overflow': '调整溢出处理',
      'cursor': '调整鼠标样式',
      'visibility': '调整可见性',
      'text-align': '调整文字对齐',
      'line-height': '调整行高',
    };

    const meaningful = [...newProps].filter(p => !delProps.has(p));
    if (meaningful.length > 0) {
      const humanDescs = meaningful.map(p => styleMap[p] || p).filter(d => d.length > 0);
      if (humanDescs.length > 0) {
        descriptions.push(`${domain}: ${humanDescs.slice(0, 3).join('、')}${humanDescs.length > 3 ? '等' : ''}`);
      }
    }
  }

  if (delProps.size > 0 && descriptions.length === 0) {
    descriptions.push(`${domain}: 移除了部分样式`);
  }

  if (descriptions.length === 0) {
    descriptions.push(`${domain}: 调整了样式`);
  }

  return descriptions;
}

// ====== 配置文件分析 ======

function analyzeConfigFile(fileName, addedLines, deletedLines) {
  const descriptions = [];

  for (const line of addedLines) {
    const m = line.match(/^(\w+)\s*=\s*(.+)/);
    if (m) {
      const val = m[2].length > 30 ? m[2].slice(0, 30) + '...' : m[2];
      descriptions.push(`配置 ${m[1]} 设为 ${val}`);
    }
  }
  for (const line of deletedLines) {
    const m = line.match(/^(\w+)\s*=\s*(.+)/);
    if (m) {
      descriptions.push(`移除配置 ${m[1]}`);
    }
  }

  if (descriptions.length === 0) {
    descriptions.push(`${fileName}: 更新配置`);
  }

  return descriptions;
}

// ====== Commit 类型检测 ======

function detectCommitType(files, diffDetail) {
  const config = loadConfig();
  const allText = files.map((f) => f.file + ' ' + f.status).join(' ') + ' ' + diffDetail;

  for (const rule of config.typeRules) {
    if (rule.pattern.test(allText)) {
      return rule.type;
    }
  }

  return config.defaultType;
}

// ====== Scope 提取 ======

function generateScope(files) {
  if (files.length === 0) return '';

  const dirs = files
    .map((f) => {
      const parts = f.file.split('/');
      return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    })
    .filter(Boolean);

  if (dirs.length === 0) return '';

  let common = dirs[0];
  for (let i = 1; i < dirs.length; i++) {
    while (!dirs[i].startsWith(common)) {
      common = common.slice(0, -1);
      if (common === '') return '';
    }
  }
  return common.replace(/\/$/, '');
}

// ====== 核心函数：生成 Commit Message ======

/**
 * @param {Array} files - 暂存文件列表 [{status, file}]
 * @param {string} diffStat - diff --stat 输出
 * @returns {{type, scope, message}}
 */
function generateCommitMessage(files, diffStat) {
  const type = detectCommitType(files, diffStat);
  const scope = generateScope(files);
  const scopeStr = scope ? `(${scope})` : '';

  // 对每个文件进行语义分析
  const fileAnalyses = [];
  for (const f of files) {
    const fileDiff = getFileDiff(f.file, true);
    if (fileDiff) {
      const changes = analyzeFileDiff(f.file, fileDiff);
      if (changes.length > 0) {
        fileAnalyses.push({ file: f.file, status: f.status, changes });
      }
    }
  }

  // 生成摘要标题
  const summary = generateSummary(files, fileAnalyses, type);

  // 生成详细列表
  const details = generateDetailList(fileAnalyses);

  // 拼接
  const header = `${type}${scopeStr}: ${summary}`;
  const message = details.length > 0
    ? `${header}\n\n${details}`
    : header;

  return { type, scope, message };
}

/**
 * 生成摘要标题
 */
function generateSummary(files, fileAnalyses, type) {
  const allChanges = fileAnalyses.flatMap(a => a.changes);

  if (allChanges.length === 0) {
    const statusLabels = { A: '新增', M: '修改', D: '删除', R: '重命名' };
    const statuses = [...new Set(files.map(f => statusLabels[f.status] || '变更'))];
    const names = files.map(f => path.basename(f.file, path.extname(f.file)));
    return `${statuses.join('、')} ${names.join('、')}`;
  }

  // 取最有代表性的 1-2 条描述
  const top = allChanges.slice(0, 2)
    .map(c => c.replace(/^[^:]+:\s*/, ''))  // 去掉「文件名:」前缀
    .filter(Boolean);

  if (top.length === 0) {
    return `${type === 'fix' ? '修复' : '更新'}了 ${files.length} 个文件`;
  }

  return top.join('，');
}

/**
 * 生成详细列表
 */
function generateDetailList(fileAnalyses) {
  if (fileAnalyses.length === 0) return '';

  const lines = [];

  // 如果只有一个文件，直接列出改动
  if (fileAnalyses.length === 1) {
    for (const change of fileAnalyses[0].changes) {
      lines.push(`- ${change}`);
    }
    return lines.join('\n');
  }

  // 多个文件：按文件分组
  for (const analysis of fileAnalyses) {
    const fileName = path.basename(analysis.file);
    const dir = path.dirname(analysis.file);
    // 用相对路径作为文件标识
    const fileLabel = dir && dir !== '.' ? `${dir}/${fileName}` : fileName;

    if (analysis.changes.length === 1) {
      lines.push(`- ${analysis.changes[0]}`);
    } else {
      lines.push(`- ${fileLabel}`);
      for (const change of analysis.changes) {
        lines.push(`  - ${change}`);
      }
    }
  }

  return lines.join('\n');
}

module.exports = { generateCommitMessage };
