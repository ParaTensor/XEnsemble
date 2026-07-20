import { useState, useCallback, useRef } from 'react';
import { useWorkspaceFiles } from './useWorkspaceFiles';

export function useEditorTabs() {
  const [tabs, setTabs] = useState([]);
  const [activePath, setActivePath] = useState(null);
  const [diffView, setDiffView] = useState(null);
  const { listFiles, readFile, writeFile, createDir } = useWorkspaceFiles();
  const fetchDirLock = useRef({});

  const openFile = useCallback(async (projectId, file) => {
    if (!file || file.type !== 'file') return;
    const path = file.path;
    const existing = tabs.find((t) => t.path === path);
    if (existing) {
      setActivePath(path);
      return;
    }
    try {
      const result = await readFile(projectId, path);
      const now = Date.now();
      const newTab = {
        path,
        content: result.isBinary ? '' : (result.content || ''),
        originalContent: result.isBinary ? '' : (result.content || ''),
        isBinary: !!result.isBinary,
        loadedAt: now,
      };
      setTabs((prev) => [...prev, newTab]);
      setActivePath(path);
    } catch (err) {
      throw err;
    }
  }, [tabs, readFile]);

  const closeTab = useCallback((path) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.path === path);
      if (idx === -1) return prev;
      const next = prev.filter((t) => t.path !== path);
      if (activePath === path) {
        const newActive = next[idx] || next[idx - 1] || null;
        setActivePath(newActive ? newActive.path : null);
      }
      return next;
    });
  }, [activePath]);

  const selectTab = useCallback((path, newContent) => {
    setActivePath(path);
    if (newContent !== undefined) {
      setTabs((prev) => prev.map((t) =>
        t.path === path ? { ...t, content: newContent } : t
      ));
    }
  }, []);

  const saveTab = useCallback(async (projectId, path) => {
    const tab = tabs.find((t) => t.path === path);
    if (!tab) return;
    await writeFile(projectId, path, tab.content, { loadedAt: tab.loadedAt });
    setTabs((prev) => prev.map((t) =>
      t.path === path ? { ...t, originalContent: t.content, loadedAt: Date.now() } : t
    ));
  }, [tabs, writeFile]);

  const showDiff = useCallback(async (projectId, path) => {
    const tab = tabs.find((t) => t.path === path);
    if (!tab || tab.isBinary) return;
    setDiffView({ path, original: null, modified: tab.content, loading: true });
    try {
      const result = await readFile(projectId, path);
      setDiffView({ path, original: result.content || '', modified: tab.content, loading: false });
    } catch (err) {
      setDiffView(null);
      throw err;
    }
  }, [tabs, readFile]);

  const closeDiff = useCallback(() => {
    setDiffView(null);
  }, []);

  const fetchDir = useCallback(async (projectId, path) => {
    const key = `${projectId}:${path}`;
    if (fetchDirLock.current[key]) return fetchDirLock.current[key];
    const promise = listFiles(projectId, path, 'single').catch(() => []);
    fetchDirLock.current[key] = promise;
    try {
      return await promise;
    } finally {
      delete fetchDirLock.current[key];
    }
  }, [listFiles]);

  const handleCreateFile = useCallback(async (projectId, name) => {
    await writeFile(projectId, name, '');
  }, [writeFile]);

  const handleCreateDir = useCallback(async (projectId, name) => {
    await createDir(projectId, name);
  }, [createDir]);

  return {
    tabs,
    activePath,
    diffView,
    openFile,
    closeTab,
    selectTab,
    saveTab,
    showDiff,
    closeDiff,
    fetchDir,
    handleCreateFile,
    handleCreateDir,
  };
}
