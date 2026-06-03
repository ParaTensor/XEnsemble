const pty = require('node-pty');

class LocalPtyExecutor {
    /**
     * 拉起一个本地 PTY 进程
     * @param {string} cmd - 命令路径名
     * @param {string[]} args - 命令参数
     * @param {Object} envs - 注入的环境变量
     * @returns {Object} node-pty 实例
     */
    spawn(cmd, args, envs) {
        return pty.spawn(cmd, args, {
            name: 'xterm-256color', // 支持丰富的终端颜色
            cols: 80,
            rows: 24,
            cwd: process.env.HOME || process.env.USERPROFILE || process.cwd(),
            env: { ...process.env, ...envs } // 合并系统环境变量与用户动态配置
        });
    }
}

module.exports = new LocalPtyExecutor();
