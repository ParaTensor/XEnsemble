import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

const { apiFetch } = await import('@/lib/api');

let useWorkspaceFiles;
beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('@/hooks/useWorkspaceFiles');
  useWorkspaceFiles = mod.useWorkspaceFiles;
});

describe('listFiles', () => {
  it('calls GET /api/v1/workspace/files with project_id, path, depth', async () => {
    const mockFiles = [{ name: 'index.js', path: 'index.js', type: 'file', size: 100 }];
    apiFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockFiles) });

    const { result } = renderHook(() => useWorkspaceFiles());
    let files;
    await act(async () => {
      files = await result.current.listFiles('proj1', 'src', 'single');
    });

    expect(apiFetch).toHaveBeenCalledWith('/api/v1/workspace/files?project_id=proj1&path=src&depth=single', {});
    expect(files).toEqual(mockFiles);
  });

  it('returns recursive list when depth is not provided', async () => {
    const mockFiles = [{ name: 'a.js', path: 'src/a.js', type: 'file' }];
    apiFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockFiles) });

    const { result } = renderHook(() => useWorkspaceFiles());
    await act(async () => {
      await result.current.listFiles('proj1', '.');
    });

    expect(apiFetch).toHaveBeenCalledWith('/api/v1/workspace/files?project_id=proj1&path=.', {});
  });
});

describe('readFile', () => {
  it('calls GET /api/v1/workspace/file and returns content', async () => {
    apiFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ content: 'hello world', isBinary: false }),
    });

    const { result } = renderHook(() => useWorkspaceFiles());
    let data;
    await act(async () => {
      data = await result.current.readFile('proj1', 'src/index.js');
    });

    expect(apiFetch).toHaveBeenCalledWith('/api/v1/workspace/file?project_id=proj1&path=src%2Findex.js', {});
    expect(data).toEqual({ content: 'hello world', isBinary: false });
  });

  it('sets isBinary:true and returns empty content for binary files', async () => {
    apiFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ content: 'base64data', isBinary: true }),
    });

    const { result } = renderHook(() => useWorkspaceFiles());
    let data;
    await act(async () => {
      data = await result.current.readFile('proj1', 'img.png');
    });

    expect(data).toEqual({ content: '', isBinary: true });
  });
});

describe('writeFile', () => {
  it('calls PUT /api/v1/workspace/file with query params and JSON body', async () => {
    apiFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true, path: 'src/new.js', size: 42 }),
    });

    const { result } = renderHook(() => useWorkspaceFiles());
    let data;
    await act(async () => {
      data = await result.current.writeFile('proj1', 'src/new.js', 'console.log(1)');
    });

    expect(apiFetch).toHaveBeenCalledWith('/api/v1/workspace/file?project_id=proj1&path=src%2Fnew.js', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'console.log(1)' }),
    });
    expect(data).toEqual({ ok: true, path: 'src/new.js', size: 42 });
  });

  it('sends If-Unmodified-Since header when loadedAt is provided', async () => {
    apiFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });

    const { result } = renderHook(() => useWorkspaceFiles());
    const loadedAt = Date.now();
    await act(async () => {
      await result.current.writeFile('proj1', 'a.js', 'x', { loadedAt });
    });

    const callArgs = apiFetch.mock.calls[0][1];
    expect(callArgs.headers['If-Unmodified-Since']).toBeDefined();
    // toUTCString() 截断毫秒，容差 1 秒
    const headerTime = new Date(callArgs.headers['If-Unmodified-Since']).getTime();
    expect(Math.abs(headerTime - loadedAt)).toBeLessThan(1000);
  });
});

describe('deleteFile', () => {
  it('calls DELETE /api/v1/workspace/file', async () => {
    apiFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });

    const { result } = renderHook(() => useWorkspaceFiles());
    await act(async () => {
      await result.current.deleteFile('proj1', 'src/old.js');
    });

    expect(apiFetch).toHaveBeenCalledWith('/api/v1/workspace/file?project_id=proj1&path=src%2Fold.js', {
      method: 'DELETE',
    });
  });
});

describe('createDir', () => {
  it('calls POST /api/v1/workspace/dir with query param and body', async () => {
    apiFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });

    const { result } = renderHook(() => useWorkspaceFiles());
    await act(async () => {
      await result.current.createDir('proj1', 'src/newdir');
    });

    expect(apiFetch).toHaveBeenCalledWith('/api/v1/workspace/dir?project_id=proj1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'src/newdir' }),
    });
  });
});

describe('deleteDir', () => {
  it('calls DELETE /api/v1/workspace/dir', async () => {
    apiFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });

    const { result } = renderHook(() => useWorkspaceFiles());
    await act(async () => {
      await result.current.deleteDir('proj1', 'src/olddir');
    });

    expect(apiFetch).toHaveBeenCalledWith('/api/v1/workspace/dir?project_id=proj1&path=src%2Folddir', {
      method: 'DELETE',
    });
  });
});

describe('moveFile', () => {
  it('calls POST /api/v1/workspace/move with query param and body', async () => {
    apiFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });

    const { result } = renderHook(() => useWorkspaceFiles());
    await act(async () => {
      await result.current.moveFile('proj1', 'src/a.js', 'src/b.js');
    });

    expect(apiFetch).toHaveBeenCalledWith('/api/v1/workspace/move?project_id=proj1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'src/a.js', to: 'src/b.js' }),
    });
  });
});

describe('error handling', () => {
  it('throws on non-ok response with error message', async () => {
    apiFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: 'Not found' }),
    });

    const { result } = renderHook(() => useWorkspaceFiles());
    await expect(result.current.readFile('proj1', 'nonexistent.js')).rejects.toThrow('Not found');
  });

  it('throws on network error', async () => {
    apiFetch.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useWorkspaceFiles());
    await expect(result.current.readFile('proj1', 'a.js')).rejects.toThrow('Network error');
  });
});
