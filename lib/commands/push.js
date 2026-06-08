// ============ push 命令 - 多平台推送 ============
// 自动检测远程仓库列表，一键推送到所有平台（如 GitHub + Gitee）
// 支持通过 .sgcrc.json 的 pushRemotes 字段预设远程名称

const { execSync } = require('child_process');
const { getRemotes, getCurrentBranch, getRepoName } = require('../git');
const { loadConfig } = require('../config');
const { colors } = require('../colors');

/**
 * 处理 push 命令
 * @param {string[]} args - 剩余参数（如 --force）
 */
function handlePush(args = []) {
  // 获取当前分支
  const branch = getCurrentBranch();
  if (!branch) {
    console.error(`${colors.red}❌ 无法获取当前分支${colors.reset}`);
    process.exit(1);
  }

  // 加载配置
  const config = loadConfig();

  // 获取远程仓库列表
  let remotes;
  if (config.pushRemotes && config.pushRemotes.length > 0) {
    // 使用配置中预设的远程名称
    const allRemotes = getRemotes();
    const remoteNameSet = new Set(config.pushRemotes);
    remotes = allRemotes.filter((r) => remoteNameSet.has(r.name));

    // 检查配置的远程是否都存在
    const foundNames = new Set(remotes.map((r) => r.name));
    config.pushRemotes.forEach((name) => {
      if (!foundNames.has(name)) {
        console.error(
          `${colors.red}❌ 配置的远程仓库 "${name}" 不存在${colors.reset}`
        );
      }
    });

    if (remotes.length === 0) {
      console.error(`${colors.red}❌ 没有找到有效的远程仓库${colors.reset}`);
      process.exit(1);
    }
  } else {
    // 未配置则自动检测，过滤掉不属于当前仓库的 remote（通过 URL 中的仓库名匹配）
    remotes = getRemotes();
    const repoName = getRepoName();
    if (repoName) {
      remotes = remotes.filter((r) => {
        // 从 URL 中提取仓库名，如 https://github.com/user/repo.git → repo
        const urlMatch = r.url.match(/\/([^/]+?)(?:\.git)?$/);
        return urlMatch && urlMatch[1] === repoName;
      });
    }

    if (remotes.length === 0) {
      console.error(
        `${colors.red}❌ 当前仓库没有配置远程仓库\n` +
          `${colors.gray}请先使用 git remote add <名称> <地址> 添加远程仓库${colors.reset}`
      );
      process.exit(1);
    }
  }

  // 构建 push 参数
  const extraArgs = args.join(' ');

  // 显示推送信息
  console.log(`\n${colors.brightCyan}🚀 开始推送${colors.reset}`);
  console.log(`${colors.dim}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(
    `  ${colors.gray}分支: ${colors.bold}${branch}${colors.reset}`
  );
  console.log(
    `  ${colors.gray}目标: ${remotes.map((r) => `${colors.brightBlue}${r.name}${colors.reset} ${colors.dim}(${r.url})${colors.reset}`).join(', ')}${colors.reset}`
  );
  console.log(`${colors.dim}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

  // 依次推送到每个远程仓库
  let successCount = 0;
  let failCount = 0;

  remotes.forEach((remote, index) => {
    const label = `${remote.name}/${branch}`;
    console.log(
      `${colors.yellow}[${index + 1}/${remotes.length}]${colors.reset} 推送到 ${colors.bold}${label}${colors.reset} ...`
    );

    try {
      const cmd = `git push ${remote.name} ${branch}${extraArgs ? ' ' + extraArgs : ''}`;
      execSync(cmd, { stdio: 'inherit' });
      successCount++;
    } catch (e) {
      failCount++;
      console.error(
        `${colors.red}  ⚠️  推送到 ${remote.name} 失败${colors.reset}`
      );
    }
  });

  // 汇总结果
  console.log(`\n${colors.dim}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  if (failCount === 0) {
    console.log(
      `${colors.green}✅ 推送成功${colors.reset} ${colors.dim}(全部 ${successCount} 个远程仓库)${colors.reset}\n`
    );
  } else if (successCount > 0) {
    console.log(
      `${colors.yellow}⚠️  部分推送成功${colors.reset} ${colors.dim}(${successCount}/${remotes.length} 个)${colors.reset}\n`
    );
  } else {
    console.error(`${colors.red}❌ 所有推送均失败${colors.reset}\n`);
    process.exit(1);
  }
}

module.exports = { handlePush };
