import { describe, it, expect } from 'vitest';
import { pickDefaultRootFile } from '@/lib/workspaceFileTree';

describe('pickDefaultRootFile', () => {
  it('prefers README.md over other root files', () => {
    const picked = pickDefaultRootFile([
      { name: 'main.py', path: 'main.py', type: 'file' },
      { name: 'README.md', path: 'README.md', type: 'file' },
      { name: 'src', path: 'src', type: 'directory' },
    ]);
    expect(picked.path).toBe('README.md');
  });

  it('matches readme case-insensitively', () => {
    const picked = pickDefaultRootFile([
      { name: 'readme.txt', path: 'readme.txt', type: 'file' },
      { name: 'app.js', path: 'app.js', type: 'file' },
    ]);
    expect(picked.path).toBe('readme.txt');
  });

  it('falls back to a root markdown/text doc when no readme', () => {
    const picked = pickDefaultRootFile([
      { name: 'main.py', path: 'main.py', type: 'file' },
      { name: 'notes.md', path: 'notes.md', type: 'file' },
    ]);
    expect(picked.path).toBe('notes.md');
  });

  it('ignores nested files and returns null when empty', () => {
    expect(pickDefaultRootFile([
      { name: 'README.md', path: 'docs/README.md', type: 'file' },
      { name: 'src', path: 'src', type: 'directory' },
    ])).toBeNull();
    expect(pickDefaultRootFile([])).toBeNull();
  });
});
