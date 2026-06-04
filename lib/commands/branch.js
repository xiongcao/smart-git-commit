// ============ branch 命令 - 分支管理 ============
// 提供分支的查看、创建、切换、删除功能
// 创建分支时自动添加规范前缀（feat/、fix/、docs/ 等）

const { getBranches, runGit, getCurrentBranch } = require('../git');
const { loadConfig } = require('../config');
const { ask, selectFromList } = require('../prompt');
const { colors } = require('../colors');

/**
 * 处理 branch 命令，根据子命令分发
 * @param {string[]} args - 子命令参数
 */
async function handleBranch(args) {
  const config = loadConfig();

  // 创建分支
  if (args.includes('create') || args.includes('-c')) {
    await createBranch(args, config);
    return;
  }

  // 切换分支
  if (args.includes('switch') || args.includes('-s')) {
    await switchBranch();
    return;
  }

  // 删除分支
  if (args.includes('delete') || args.includes('-d')) {
    await deleteBranch(args);
    return;
  }

  // 默认：列出所有分支
  listBranches();
}

/**
 * 创建新分支
 * 流程：选择前缀 → 输入分支名 → 创建并切换
 *
 * 例如：选择 feat → 输入 login → 创建 feat/login
 */
async function createBranch(args, config) {
  const prefixes = config.branchPrefixes;

  console.log(`${colors.cyan}🌿 创建新分支${colors.reset}`);
  console.log(`${colors.gray}━${colors.reset}`.repeat(40));

  // 构建前缀选项列表，如 "feat         → feat/"
  const prefixList = Object.entries(prefixes).map(([type, prefix]) => ({
    value: prefix,
    name: `${type.padEnd(12)} → ${prefix}/`,  // padEnd 对齐排版
  }));

  // 让用户选择前缀
  const selectedPrefix = await selectFromList('选择分支前缀：', prefixList);
  if (!selectedPrefix) {
    console.log(`${colors.red}❌ 取消创建${colors.reset}`);
    process.exit(0);
  }

  // 让用户输入分支名
  const name = await ask(`分支名（${selectedPrefix}/）: `);
  if (!name) {
    console.log(`${colors.red}❌ 分支名不能为空${colors.reset}`);
    process.exit(0);
  }

  // 拼接完整分支名并创建
  const fullName = `${selectedPrefix}/${name}`;
  runGit(`checkout -b ${fullName}`);  // git checkout -b feat/login
  console.log(`${colors.green}✅ 已创建并切换到分支: ${fullName}${colors.reset}`);
}

/**
 * 交互式切换分支
 * 列出所有分支，让用户选择切换
 */
async function switchBranch() {
  const branches = getBranches();

  if (branches.length === 0) {
    console.log(`${colors.red}❌ 没有可用的分支${colors.reset}`);
    return;
  }

  // 构建选项，当前分支用绿色 ● 标记
  const options = branches.map((b) => ({
    value: b.name,
    name: b.isCurrent
      ? `${colors.green}● ${b.name}${colors.reset}`  // 当前分支高亮
      : `  ${b.name}`,                                // 普通分支
  }));

  const selected = await selectFromList('选择要切换的分支：', options);
  if (!selected) {
    console.log(`${colors.red}❌ 取消切换${colors.reset}`);
    return;
  }

  runGit(`checkout ${selected}`);
  console.log(`${colors.green}✅ 已切换到分支: ${selected}${colors.reset}`);
}

/**
 * 交互式删除分支
 * 排除当前分支，支持 --force 强制删除
 */
async function deleteBranch(args) {
  // 过滤掉当前分支（不能删除当前所在分支）
  const branches = getBranches().filter((b) => !b.isCurrent);

  if (branches.length === 0) {
    console.log(`${colors.yellow}⚠️  没有可删除的分支${colors.reset}`);
    return;
  }

  const options = branches.map((b) => ({
    value: b.name,
    name: b.name,
  }));

  const selected = await selectFromList('选择要删除的分支：', options);
  if (!selected) {
    console.log(`${colors.red}❌ 取消删除${colors.reset}`);
    return;
  }

  // --force 或 -f 参数：使用 -D 强制删除（即使未合并）
  const force = args.includes('--force') || args.includes('-f');
  const flag = force ? '-D' : '-d';  // -d 安全删除（仅已合并），-D 强制删除

  try {
    runGit(`branch ${flag} ${selected}`);
    console.log(`${colors.green}✅ 已删除分支: ${selected}${colors.reset}`);
  } catch (e) {
    // 非强制模式删除失败（可能未合并），提示用户是否强制删除
    if (!force) {
      const confirm = await ask(`${colors.yellow}分支可能未合并，强制删除？[y/N]${colors.reset} `);
      if (confirm.toLowerCase() === 'y') {
        runGit(`branch -D ${selected}`);
        console.log(`${colors.green}✅ 已强制删除分支: ${selected}${colors.reset}`);
      }
    }
  }
}

/**
 * 列出所有分支
 * 当前分支用 ● 标记，其他分支缩进显示
 */
function listBranches() {
  const branches = getBranches();
  const currentBranch = getCurrentBranch();

  console.log(`${colors.cyan}🌿 分支列表${colors.reset}`);
  console.log(`${colors.gray}━${colors.reset}`.repeat(40));

  branches.forEach((b) => {
    if (b.isCurrent) {
      // 当前分支：绿色 ● + 加粗 + (当前) 标签
      console.log(`${colors.green}  ● ${colors.bold}${b.name}${colors.reset} ${colors.gray}(当前)${colors.reset}`);
    } else {
      console.log(`    ${b.name}`);
    }
  });

  // 底部操作提示
  console.log(`\n${colors.gray}命令：${colors.reset}`);
  console.log(`  sgc branch create   ${colors.gray}创建新分支${colors.reset}`);
  console.log(`  sgc branch switch   ${colors.gray}切换分支${colors.reset}`);
  console.log(`  sgc branch delete   ${colors.gray}删除分支${colors.reset}`);
  console.log();
}

module.exports = { handleBranch };
