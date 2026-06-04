// ============ 交互界面工具 ============
// 封装命令行交互功能：提问、列表选择
// 使用 Node.js 内置的 readline 模块，无需第三方依赖

const readline = require('readline');

/**
 * 向用户提问并获取回答
 * 创建 readline 接口 → 提问 → 等待用户输入 → 关闭接口 → 返回结果
 *
 * @param {string} question - 提问内容，会直接显示在终端
 * @param {string} [defaultValue] - 默认值，用户直接按 Enter 时返回此值
 * @returns {Promise<string>} 用户输入的内容（已 trim），空输入返回 defaultValue
 *
 * 使用示例：
 *   const name = await ask('请输入你的名字: ');
 *   const confirm = await ask('确认？[Y/n] ', 'y');
 */
function ask(question, defaultValue) {
  // 创建 readline 接口，绑定标准输入输出
  const rl = readline.createInterface({
    input: process.stdin,    // 从标准输入（键盘）读取
    output: process.stdout,  // 输出到标准输出（终端屏幕）
  });

  // 用 Promise 包装回调式 API，配合 async/await 使用
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();                    // 关闭 readline 接口，释放资源
      const trimmed = answer.trim(); // 去除首尾空格
      // 如果用户直接按 Enter（空输入）且有默认值，返回默认值；否则返回空字符串
      resolve(trimmed || (defaultValue !== undefined ? defaultValue : ''));
    });
  });
}

/**
 * 显示列表让用户选择
 * 先打印编号列表，再让用户输入数字选择
 *
 * @param {string} question - 标题文字
 * @param {Array<{value: string, name: string}>} options - 选项列表
 * @returns {Promise<string|null>} 选中项的 value，无效选择返回 null
 *
 * 使用示例：
 *   const type = await selectFromList('选择类型：', [
 *     { value: 'feat', name: 'feat: 新功能' },
 *     { value: 'fix',  name: 'fix:  修复' },
 *   ]);
 */
function selectFromList(question, options) {
  // 先打印选项列表，每个选项带编号（从 1 开始）
  console.log(`\n${question}`);
  options.forEach((opt, i) => {
    // 优先显示 name（带说明的标签），没有则显示 value
    console.log(`  ${i + 1}. ${opt.name || opt.value}`);
  });

  // 让用户输入编号，返回对应的 value
  return ask(`请选择 [1-${options.length}]: `).then((answer) => {
    const idx = parseInt(answer, 10) - 1;  // 用户输入 1 对应数组索引 0
    if (idx >= 0 && idx < options.length) {
      return options[idx].value;           // 返回选中项的 value
    }
    return null;                           // 无效输入返回 null，由调用方处理
  });
}

module.exports = { ask, selectFromList };
