/**
 * 向后兼容 shim — 新代码应通过 runtime/registry.js 获取 ExecAdapter。
 * 此文件保留以防外部代码仍 require('./runtime/Executor')。
 */
const LocalExecAdapter = require('./LocalExecAdapter');
const { AgentSpawnError } = require('./interfaces');

const instance = new LocalExecAdapter();

module.exports = instance;
module.exports.AgentSpawnError = AgentSpawnError;
