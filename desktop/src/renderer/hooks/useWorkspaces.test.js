import { describe, it } from 'node:test';
import assert from 'node:assert';
import { useWorkspaces } from './useWorkspaces.js';

describe('useWorkspaces module', () => {
  it('exports useWorkspaces function', () => {
    assert.strictEqual(typeof useWorkspaces, 'function');
  });
});
