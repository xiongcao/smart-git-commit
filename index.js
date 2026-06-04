#!/usr/bin/env node
// ↑ Shebang 行：告诉操作系统用 node 来执行这个文件
// 当全局安装后，终端输入 sgc 时，操作系统通过这行知道用 node 执行

// ============ 主入口 - 命令路由 ============
// 这是 sgc 命令的入口文件，负责：
// 1. 解析用户输入的子命令（log/status/branch/commit 等）
// 2. 将请求分发到对应的命令处理器
// 3. 提供 help 帮助信息

const { handleCommit } = require('./lib/commands/commit');    // commit 命令处理器
const { handleLog } = require('./lib/commands/log');          // log 命令处理器
const { handleStatus } = require('./lib/commands/status');    // status 命令处理器
const { handleBranch } = require('./lib/commands/branch');    // branch 命令处理器
const { handleHook } = require('./lib/commands/hook');        // hook 命令处理器
const { handleInit } = require('./lib/commands/init');        // init 命令处理器
const { colors } = require('./lib/colors');                   // 终端颜色工具
const { execSync } = require('child_process');                // 用于透传 git 命令

// 从 package.json 读取版本号
const { version } = require('./package.json');

// ============ 帮助信息 ============
// 当用户输入 sgc help / sgc --help / sgc -h 时展示
function showHelp() {
  console.log(`
${colors.cyan}${colors.bold}📦 Smart Git Commit (sgc)${colors.reset} - 智能 Git 提交助手

${colors.yellow}用法：${colors.reset}
  sgc                    ${colors.gray}默认：交互式生成 commit message 并提交${colors.reset}
  sgc commit             ${colors.gray}同上${colors.reset}
  sgc log                ${colors.gray}查看美化后的提交历史${colors.reset}
  sgc log --graph        ${colors.gray}图形化提交历史${colors.reset}
  sgc log 20             ${colors.gray}查看最近 20 条记录${colors.reset}
  sgc status             ${colors.gray}查看仓库状态（增强版）${colors.reset}
  sgc branch             ${colors.gray}查看分支列表${colors.reset}
  sgc branch create      ${colors.gray}创建带规范前缀的分支${colors.reset}
  sgc branch switch      ${colors.gray}交互式切换分支${colors.reset}
  sgc branch delete      ${colors.gray}交互式删除分支${colors.reset}
  sgc init               ${colors.gray}初始化项目配置文件 (.sgcrc.json)${colors.reset}
  sgc hook install       ${colors.gray}安装 commit-msg 校验 hook${colors.reset}
  sgc hook uninstall     ${colors.gray}卸载 hook${colors.reset}
  sgc hook check         ${colors.gray}检查 hook 状态${colors.reset}

${colors.yellow}Commit 选项：${colors.reset}
  --auto, -a             ${colors.gray}跳过交互确认，直接提交${colors.reset}
  --dry-run, -d          ${colors.gray}预览模式，不实际提交${colors.reset}
  --ai                   ${colors.gray}使用 AI 生成 commit message${colors.reset}

${colors.yellow}示例：${colors.reset}
  sgc                    ${colors.gray}# 启动交互式提交${colors.reset}
  sgc --ai               ${colors.gray}# AI 模式生成提交信息${colors.reset}
  sgc --auto             ${colors.gray}# 一键自动提交${colors.reset}
  sgc log --graph        ${colors.gray}# 图形化提交历史${colors.reset}
  sgc status             ${colors.gray}# 查看仓库状态${colors.reset}
  sgc branch create      ${colors.gray}# 创建 feat/xxx 等规范分支${colors.reset}
  sgc init               ${colors.gray}# 初始化配置文件${colors.reset}
  sgc hook install       ${colors.gray}# 安装提交校验 hook${colors.reset}

${colors.yellow}AI 模式：${colors.reset}
  方式一：设置环境变量
    export OPENAI_API_KEY="your-key"      # OpenAI
    export DASHSCOPE_API_KEY="your-key"   # 阿里通义千问
  方式二：在 .sgcrc.json 中配置 "apiKey" 字段
  方式三：直接运行 sgc --ai，会提示输入 Key

${colors.yellow}配置文件：${colors.reset}
  项目级: .sgcrc.json
  全局级: ~/.sgcrc.json
`);
}

// ============ 主函数 - 命令路由 ============
async function main() {
  // process.argv 是 Node.js 的命令行参数数组
  // process.argv[0] = node 可执行文件路径
  // process.argv[1] = 当前脚本路径（index.js）
  // process.argv[2+] = 用户输入的参数
  const args = process.argv.slice(2);  // 去掉前两个，拿到用户参数
  const command = args[0];              // 第一个参数就是子命令名

  // 如果用户输入 help / --help / -h，显示帮助信息
  if (command === 'help' || command === '--help' || command === '-h') {
    showHelp();
    return;
  }

  // 如果用户输入 --version / -V / -v / version，显示版本号
  if (command === '--version' || command === '-V' || command === '-v' || command === 'version') {
    console.log(`v${version}`);
    return;
  }

  // 根据子命令分发到对应的处理器
  // 已知的 sgc 命令会被拦截，其他命令透传给 git
  const knownCommands = ['log', 'status', 'branch', 'hook', 'init', 'commit'];

  // 如果用户没有输入子命令（如 sgc --ai、sgc --auto），默认走 commit
  // 或者子命令以 -- 开头（如 sgc --ai），也走 commit
  if (!command || command.startsWith('-')) {
    await handleCommit(args);
    return;
  }

  // 如果命令是已知的 sgc 命令，走 sgc 的处理器
  if (knownCommands.includes(command)) {
    switch (command) {
      case 'log':
        handleLog(args.slice(1));
        break;
      case 'status':
        handleStatus();
        break;
      case 'branch':
        await handleBranch(args.slice(1));
        break;
      case 'hook':
        handleHook(args.slice(1));
        break;
      case 'init':
        await handleInit();
        break;
      case 'commit':
        await handleCommit(args.slice(1));
        break;
    }
  } else {
    // 未知命令：透传给 git（如 sgc add、sgc diff、sgc push 等）
    try {
      execSync(`git ${args.join(' ')}`, { stdio: 'inherit' });
    } catch (e) {
      process.exit(e.status || 1);
    }
  }
}

// 启动主函数，捕获未处理的异步错误
main().catch(console.error);
