#!/usr/bin/env node
// Shebang 行：声明用 node 解释器执行此文件
// npm install -g 时，npm 在系统 PATH 创建 sgc 软链接指向此文件
// 终端输入 sgc 时，操作系统读取此行的 #! 前缀，用 node 执行

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
const { execSync } = require('child_process');                // 用于透传未知命令给 git

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
  // [0] = node 可执行文件路径
  // [1] = 当前脚本路径（index.js）
  // [2+] = 用户输入的参数
  const args = process.argv.slice(2);  // 去掉前两个系统参数，拿到用户参数
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

  // 已知的 sgc 命令列表：这些命令走 sgc 的自定义处理器
  const knownCommands = ['log', 'status', 'branch', 'hook', 'init', 'commit'];

  // 如果用户没有输入子命令（如 sgc、sgc --ai），默认走 commit 流程
  // 或者子命令以 -- 开头（如 sgc --ai、sgc --auto），也走 commit
  if (!command || command.startsWith('-')) {
    await handleCommit(args);  // 将整个 args（含选项参数）传给 commit 处理器
    return;
  }

  // 如果命令是已知的 sgc 命令，走 sgc 的自定义处理器
  if (knownCommands.includes(command)) {
    switch (command) {
      case 'log':
        handleLog(args.slice(1));       // args.slice(1) 去掉 'log'，只传剩余参数（如 '--graph'）
        break;
      case 'status':
        handleStatus();                  // status 不需要额外参数
        break;
      case 'branch':
        await handleBranch(args.slice(1)); // args.slice(1) 去掉 'branch'，传子命令（如 'create'）
        break;
      case 'hook':
        handleHook(args.slice(1));       // 去掉 'hook'，传子命令（如 'install'）
        break;
      case 'init':
        await handleInit();              // init 不需要额外参数
        break;
      case 'commit':
        await handleCommit(args.slice(1)); // 去掉 'commit'，传剩余参数（如 '--ai'）
        break;
    }
  } else {
    // 未知命令：透传给 git（如 sgc add、sgc diff、sgc push 等）
    // stdio: 'inherit' 让 git 的输出直接显示在终端，用户可以看到交互式输出
    try {
      execSync(`git ${args.join(' ')}`, { stdio: 'inherit' });
    } catch (e) {
      process.exit(e.status || 1);  // 透传 git 命令的退出码
    }
  }
}

// 启动主函数，.catch 捕获未处理的异步错误
main().catch(console.error);
