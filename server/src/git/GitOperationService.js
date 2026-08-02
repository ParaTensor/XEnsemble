/**
 * Canonical Git workspace operations live in github/GitOperationService.js
 * (generic credentials + mutation locks + diff limits). This module re-exports
 * that implementation so callers under server/src/git/* stay provider-neutral.
 */
module.exports = require('../github/GitOperationService');
