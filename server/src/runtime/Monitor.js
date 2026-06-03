const { exec } = require('child_process');

function getProcessStats(pid) {
    return new Promise((resolve) => {
        if (!pid || process.platform === 'win32') {
            return resolve({ cpu: 0, memory: 0 });
        }
        
        // Use standard UNIX ps command to get CPU percentage and RSS (memory in KB)
        exec(`ps -p ${pid} -o %cpu,rss | tail -n 1`, (err, stdout) => {
            if (err || !stdout.trim()) {
                return resolve({ cpu: 0, memory: 0 });
            }
            const parts = stdout.trim().split(/\s+/);
            resolve({
                cpu: parseFloat(parts[0]) || 0,
                memory: (parseInt(parts[1], 10) || 0) * 1024 // Convert KB to Bytes
            });
        });
    });
}

module.exports = { getProcessStats };
