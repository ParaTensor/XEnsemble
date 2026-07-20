import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

let useSaveFile;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('@/hooks/useSaveFile');
  useSaveFile = mod.useSaveFile;
});

describe('useSaveFile', () => {
  it('saves successfully, clears dirty, shows success toast', async () => {
    const writeFile = vi.fn().mockResolvedValue({ ok: true, path: 'src/a.js', size: 42 });
    const onSaved = vi.fn();
    const showToast = vi.fn();

    const { result } = renderHook(() =>
      useSaveFile({ projectId: 'proj1', writeFile, onSaved, showToast })
    );

    let success;
    await act(async () => {
      success = await result.current.save('src/a.js', 'new content');
    });

    expect(success).toBe(true);
    expect(writeFile).toHaveBeenCalledWith('proj1', 'src/a.js', 'new content');
    expect(showToast).toHaveBeenCalledWith('success', 'Saved');
    expect(onSaved).toHaveBeenCalledWith('src/a.js', 'new content');
  });

  it('shows error toast on save failure, keeps dirty', async () => {
    const writeFile = vi.fn().mockRejectedValue(new Error('Network error'));
    const onSaved = vi.fn();
    const showToast = vi.fn();

    const { result } = renderHook(() =>
      useSaveFile({ projectId: 'proj1', writeFile, onSaved, showToast })
    );

    let success;
    await act(async () => {
      success = await result.current.save('src/a.js', 'content');
    });

    expect(success).toBe(false);
    expect(showToast).toHaveBeenCalledWith('error', expect.stringContaining('Network error'));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('handles 409 conflict by entering conflict state', async () => {
    const err = new Error('Conflict');
    err.status = 409;
    const writeFile = vi.fn().mockRejectedValue(err);
    const onSaved = vi.fn();
    const showToast = vi.fn();

    const { result } = renderHook(() =>
      useSaveFile({ projectId: 'proj1', writeFile, onSaved, showToast })
    );

    await act(async () => {
      await result.current.save('src/a.js', 'my content');
    });

    expect(result.current.conflict).toEqual({
      path: 'src/a.js',
      content: 'my content',
    });
    expect(showToast).toHaveBeenCalledWith('error', expect.stringContaining('Conflict'));
  });

  it('save enters saving state', async () => {
    let resolveWrite;
    const writeFile = vi.fn().mockImplementation(() => new Promise((r) => { resolveWrite = r; }));
    const showToast = vi.fn();

    const { result } = renderHook(() =>
      useSaveFile({ projectId: 'proj1', writeFile, showToast })
    );

    act(() => {
      result.current.save('src/a.js', 'content');
    });

    expect(result.current.saving).toBe(true);

    await act(async () => {
      resolveWrite({ ok: true, path: 'src/a.js', size: 10 });
    });

    expect(result.current.saving).toBe(false);
  });
});