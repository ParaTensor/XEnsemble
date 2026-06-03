const pty = require('node-pty');
const path = require('path');
const fs = require('fs');

class LocalPtyExecutor {
    /**
     * 拉起一个本地 PTY 进程
     * @param {string} cmd - 命令路径名
     * @param {string[]} args - 命令参数
     * @param {Object} envs - 注入的环境变量
     * @param {string} userId - 用户ID，用于隔离工作目录
     * @returns {Object} node-pty 实例
     */
    spawn(cmd, args, envs, userId) {
        // 隔离工作目录 (Workspace Jail)
        const workspaceDir = path.join('/tmp/agent-workspaces', userId || 'default');
        if (!fs.existsSync(workspaceDir)) {
            fs.mkdirSync(workspaceDir, { recursive: true });
        }

        // 降权运行 (De-escalation) 的预留位置
        // 在生产环境中，可以将 cmd 替换为 'sudo', args 替换为 ['-u', 'low_priv_user', cmd, ...args]
        // 这里为了兼容开发环境先采用直接拉起，但 CWD 被严格限制
        
        return pty.spawn(cmd, args, {
            name: 'xterm-256color', // 支持丰富的终端颜色
            cols: 80,
            rows: 24,
            cwd: workspaceDir,
            env: { ...process.env, ...envs } // 合并系统环境变量与用户动态配置
        });
    }
}

module.exports = new LocalPtyExecutor();
