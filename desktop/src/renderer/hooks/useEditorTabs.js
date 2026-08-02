import { useState, useCallback, useRef, useEffect } from 'react';
import { pickDefaultRootFile } from '../lib/workspaceFileTree';
import { useWorkspaceFiles } from './useWorkspaceFiles';

export function useEditorTabs(projectId) {
  const [tabs, setTabs] = useState([]);
  const [activePath, setActivePath] = useState(null);
  const [diffView, setDiffView] = useState(null);
  const { listFiles, readFile, writeFile, createDir } = useWorkspaceFiles();
  const fetchDirLock = useRef({});
  const lastProjectId = useRef(projectId);
  const autoOpenedForProject = useRef(null);

  // tabsRef keeps the latest tabs array without triggering re-renders,
  // allowing callbacks (openFile, saveTab, showDiff) to have stable
  // identity instead of depending on `tabs` (which changes on every keystroke).
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activePathRef = useRef(activePath);
  activePathRef.current = activePath;

  // projectId 变化时重置 state，防止跨项目 state 泄漏
  useEffect(() => {
    if (lastProjectId.current !== projectId) {
      lastProjectId.current = projectId;
      tabsRef.current = [];
      activePathRef.current = null;
      autoOpenedForProject.current = null;
      setTabs([]);
      setActivePath(null);
      setDiffView(null);
      fetchDirLock.current = {};
    }
  }, [projectId]);

  const openFile = useCallback(async (projectId, file) => {
    if (!file || file.type !== 'file') return;
    const path = file.path;
    const existing = tabsRef.current.find((t) => t.path === path);
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
  }, [readFile]);

  const closeTab = useCallback((path) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.path === path);
      if (idx === -1) return prev;
      const next = prev.filter((t) => t.path !== path);
      if (activePathRef.current === path) {
        const newActive = next[idx] || next[idx - 1] || null;
        setActivePath(newActive ? newActive.path : null);
      }
      return next;
    });
  }, []);

  const selectTab = useCallback((path, newContent) => {
    setActivePath(path);
    if (newContent !== undefined) {
      setTabs((prev) => prev.map((t) =>
        t.path === path ? { ...t, content: newContent } : t
      ));
    }
  }, []);

  const saveTab = useCallback(async (projectId, path) => {
    const tab = tabsRef.current.find((t) => t.path === path);
    if (!tab) return;
    await writeFile(projectId, path, tab.content, { loadedAt: tab.loadedAt });
    // 保存成功：更新 originalContent 和 loadedAt
    setTabs((prev) => prev.map((t) =>
      t.path === path ? { ...t, originalContent: t.content, loadedAt: Date.now() } : t
    ));
  }, [writeFile]);

  const showDiff = useCallback(async (projectId, path) => {
    const tab = tabsRef.current.find((t) => t.path === path);
    if (!tab || tab.isBinary) return;
    setDiffView({ path, original: null, modified: tab.content, loading: true });
    try {
      const result = await readFile(projectId, path);
      setDiffView({ path, original: result.content || '', modified: tab.content, loading: false });
    } catch (err) {
      setDiffView(null);
      throw err;
    }
  }, [readFile]);

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

  // 进入项目时默认打开根目录文档（优先 README）
  useEffect(() => {
    if (!projectId) return;
    if (autoOpenedForProject.current === projectId) return;
    if (tabsRef.current.length > 0) {
      autoOpenedForProject.current = projectId;
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const entries = await fetchDir(projectId, '.');
        if (cancelled || autoOpenedForProject.current === projectId) return;
        if (tabsRef.current.length > 0) {
          autoOpenedForProject.current = projectId;
          return;
        }
        const file = pickDefaultRootFile(entries);
        autoOpenedForProject.current = projectId;
        if (file) await openFile(projectId, file);
      } catch {
        if (!cancelled) autoOpenedForProject.current = projectId;
      }
    })();

    return () => { cancelled = true; };
  }, [projectId, fetchDir, openFile]);

  const handleCreateFile = useCallback(async (projectId, name) => {
    // 先创建空文件，然后打开 tab 进入编辑模式
    await writeFile(projectId, name, '');
    // 刷新文件树由 WorkspaceFileTree 重新拉取处理
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
