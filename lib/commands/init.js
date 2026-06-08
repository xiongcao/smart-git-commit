// ============ init 命令 - 初始化配置 ============
// 在当前 Git 仓库根目录创建 .sgcrc.json 配置文件
// 用户可以通过编辑该文件自定义工具行为

const fs = require('fs');
const path = require('path');
const { getRepoRoot } = require('../git');
const { generateConfigFile } = require('../config');
const { ask } = require('../prompt');
const { colors } = require('../colors');

/**
 * 处理 init 命令
 * 1. 验证当前在 Git 仓库中
 * 2. 检查是否已有配置文件，提示是否覆盖
 * 3. 生成 .sgcrc.json 并打印配置项说明
 */
async function handleInit() {
  // 验证 Git 仓库
  const repoRoot = getRepoRoot();               // 获取 Git 仓库根目录
  if (!repoRoot) {
    console.error(`${colors.red}❌ 当前目录不是 Git 仓库${colors.reset}`);
    process.exit(1);
  }

  // 配置文件路径：<仓库根>/.sgcrc.json
  const configPath = path.join(repoRoot, '.sgcrc.json');

  // 如果已存在，询问是否覆盖（防止误操作覆盖用户自定义配置）
  if (fs.existsSync(configPath)) {
    const answer = await ask(
      `${colors.yellow}⚠️  配置文件 .sgcrc.json 已存在，是否覆盖？[y/n]${colors.reset} `
    );
    if (answer.toLowerCase() !== 'y') {
      console.log(`${colors.yellow}❌ 取消操作${colors.reset}`);
      process.exit(0);
    }
  }

  // 写入默认配置（JSON.stringify 生成格式化 JSON，2 空格缩进）
  fs.writeFileSync(configPath, generateConfigFile());
  console.log(`${colors.green}✅ 配置文件已创建: .sgcrc.json${colors.reset}`);

  // 打印配置项说明，帮助用户了解可配置内容
  console.log(`\n${colors.cyan}📋 配置项说明：${colors.reset}`);
  console.log(`  useAI           - 是否默认启用 AI 模式`);
  console.log(`  aiModel         - AI 模型名称`);
  console.log(`  aiBaseUrl       - AI API 地址`);
  console.log(`  language        - 生成信息语言（zh/en/ja 等）`);
  console.log(`  defaultType     - 默认 commit 类型`);
  console.log(`  typeRules       - 文件匹配规则（正则 → type 映射）`);
  console.log(`  commitTypes     - 可选 commit 类型列表`);
  console.log(`  branchPrefixes  - 分支前缀映射`);
  console.log(`  pushRemotes     - 多平台推送的远程仓库列表`);
  console.log(`\n${colors.gray}编辑 .sgcrc.json 自定义你的配置${colors.reset}`);
}

module.exports = { handleInit };
