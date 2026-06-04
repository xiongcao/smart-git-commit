// ============ hook 命令 - Git Hook 管理 ============
// Git Hook 是 Git 提供的钩子机制，在特定事件发生时自动执行脚本
// 这里的 commit-msg hook 会在 git commit 时自动校验提交信息格式
//
// Hook 工作原理：
// 1. 安装：在 .git/hooks/commit-msg 写入校验脚本
// 2. 触发：每次 git commit 时，Git 自动执行该脚本
// 3. 校验：脚本检查 commit message 是否符合 Conventional Commits 格式
// 4. 拦截：不符合格式则拒绝提交（exit 1）

const fs = require('fs');
const path = require('path');
const { getRepoRoot } = require('../git');
const { colors } = require('../colors');

// ============ commit-msg Hook 脚本内容 ============
// 这是一个 Shell 脚本，会被写入 .git/hooks/commit-msg
const COMMIT_MSG_HOOK = `#!/bin/sh
# Smart Git Commit - Commit Message Hook
# 校验 commit message 是否符合 Conventional Commits 规范
# Git 在 commit 时自动传入 commit message 文件路径作为第一个参数

COMMIT_MSG_FILE=$1                              # Git 传入的 commit message 临时文件路径
COMMIT_MSG=$(cat "$COMMIT_MSG_FILE")            # 读取 commit message 内容

# 允许 merge commit（合并提交），不校验格式
# Merge commit 格式如 "Merge branch 'feat/xxx' into main"
if echo "$COMMIT_MSG" | grep -qE '^Merge'; then
  exit 0                                        # 退出码 0 表示通过
fi

# 校验格式：type(scope): description
# type 必须是列出的类型之一
# scope 可选，括号包裹
# description 必须有内容
if ! echo "$COMMIT_MSG" | grep -qE '^(feat|fix|docs|style|refactor|perf|test|chore|revert|build)(\\\\([^)]+\\\\))?: .+'; then
  echo ""
  echo "❌ Commit message 格式不符合规范！"
  echo ""
  echo "要求的格式：type(scope): description"
  echo ""
  echo "示例："
  echo "  feat: 添加用户登录功能"
  echo "  fix(auth): 修复token过期问题"
  echo "  docs: 更新API文档"
  echo ""
  echo "可用类型：feat, fix, docs, style, refactor, perf, test, chore, revert, build"
  echo ""
  exit 1                                        # 退出码 1 表示拒绝提交
fi
`;

/**
 * 处理 hook 命令，根据子命令分发
 * @param {string[]} args - 子命令参数
 */
function handleHook(args) {
  if (args.includes('install')) {
    installHook();        // 安装 hook
  } else if (args.includes('uninstall')) {
    uninstallHook();      // 卸载 hook
  } else if (args.includes('check')) {
    checkHook();          // 检查 hook 状态
  } else {
    showHookHelp();       // 显示帮助
  }
}

/**
 * 安装 commit-msg hook
 * 1. 检查是否在 Git 仓库中
 * 2. 如果已有 hook，备份原文件
 * 3. 写入校验脚本，设置可执行权限
 */
function installHook() {
  const repoRoot = getRepoRoot();
  if (!repoRoot) {
    console.error(`${colors.red}❌ 当前目录不是 Git 仓库${colors.reset}`);
    process.exit(1);
  }

  // Git hooks 目录：<仓库根>/.git/hooks/
  const hooksDir = path.join(repoRoot, '.git', 'hooks');
  const hookPath = path.join(hooksDir, 'commit-msg');

  // 检查是否已安装
  if (fs.existsSync(hookPath)) {
    const existingContent = fs.readFileSync(hookPath, 'utf-8');

    // 如果已包含 sgc 的标记，说明已经安装过了
    if (existingContent.includes('Smart Git Commit')) {
      console.log(`${colors.yellow}⚠️  commit-msg hook 已安装${colors.reset}`);
      return;
    }

    // 已有其他 hook，备份原文件（追加 .backup 后缀）
    const backupPath = hookPath + '.backup';
    fs.copyFileSync(hookPath, backupPath);
    console.log(`${colors.yellow}⚠️  检测到已有 hook，已备份到 commit-msg.backup${colors.reset}`);
  }

  // 写入 hook 脚本，设置权限为 755（rwxr-xr-x）
  // 0o755 = 用户可读写执行，组和其他用户可读执行
  fs.writeFileSync(hookPath, COMMIT_MSG_HOOK, { mode: 0o755 });
  console.log(`${colors.green}✅ commit-msg hook 已安装${colors.reset}`);
  console.log(`${colors.gray}   现在每次提交时都会自动校验 commit message 格式${colors.reset}`);
}

/**
 * 卸载 commit-msg hook
 * 1. 如果之前有备份，恢复原文件
 * 2. 如果没有备份，直接删除 hook 文件
 */
function uninstallHook() {
  const repoRoot = getRepoRoot();
  if (!repoRoot) {
    console.error(`${colors.red}❌ 当前目录不是 Git 仓库${colors.reset}`);
    process.exit(1);
  }

  const hookPath = path.join(repoRoot, '.git', 'hooks', 'commit-msg');

  if (!fs.existsSync(hookPath)) {
    console.log(`${colors.yellow}⚠️  未找到 commit-msg hook${colors.reset}`);
    return;
  }

  // 如果有备份文件，恢复原 hook
  const backupPath = hookPath + '.backup';
  if (fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, hookPath);  // 恢复备份
    fs.unlinkSync(backupPath);              // 删除备份文件
    console.log(`${colors.green}✅ 已恢复原始 hook${colors.reset}`);
  } else {
    fs.unlinkSync(hookPath);                // 直接删除
    console.log(`${colors.green}✅ commit-msg hook 已移除${colors.reset}`);
  }
}

/**
 * 检查 hook 安装状态
 * 判断 hook 文件是否存在、是否由 sgc 安装
 */
function checkHook() {
  const repoRoot = getRepoRoot();
  if (!repoRoot) {
    console.error(`${colors.red}❌ 当前目录不是 Git 仓库${colors.reset}`);
    process.exit(1);
  }

  const hookPath = path.join(repoRoot, '.git', 'hooks', 'commit-msg');

  if (fs.existsSync(hookPath)) {
    const content = fs.readFileSync(hookPath, 'utf-8');

    // 检查内容是否包含 sgc 标记
    if (content.includes('Smart Git Commit')) {
      console.log(`${colors.green}✅ commit-msg hook 已安装且由 sgc 管理${colors.reset}`);
    } else {
      console.log(`${colors.yellow}⚠️  存在 commit-msg hook，但不是由 sgc 安装的${colors.reset}`);
    }
  } else {
    console.log(`${colors.yellow}⚠️  未安装 commit-msg hook${colors.reset}`);
    console.log(`${colors.gray}   运行 sgc hook install 安装${colors.reset}`);
  }
}

/**
 * 显示 hook 帮助信息
 */
function showHookHelp() {
  console.log(`${colors.cyan}🔧 Git Hook 管理${colors.reset}`);
  console.log(`${colors.gray}━${colors.reset}`.repeat(40));
  console.log();
  console.log(`  sgc hook install    ${colors.gray}安装 commit-msg 校验 hook${colors.reset}`);
  console.log(`  sgc hook uninstall  ${colors.gray}卸载 hook${colors.reset}`);
  console.log(`  sgc hook check      ${colors.gray}检查 hook 状态${colors.reset}`);
  console.log();
}

module.exports = { handleHook };
