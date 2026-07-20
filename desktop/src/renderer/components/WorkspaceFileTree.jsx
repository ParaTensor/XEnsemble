import { useEffect, useMemo, useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Loader2 } from 'lucide-react';
import { buildFileTree, collectAncestorFolderPaths } from '../lib/workspaceFileTree';

function TreeNode({ node, depth, expanded, selectedPath, onToggle, onOpenFile }) {
  const indent = depth * 12;

  if (node.type === 'file') {
    const selected = selectedPath === node.path;
    return (
      <button
        type="button"
        onClick={() => onOpenFile(node)}
        className={`flex w-full min-w-0 items-center gap-0.5 rounded-md py-1 pr-2 text-left text-sm transition-colors ${
          selected ? 'bg-zinc-100 font-medium text-zinc-900' : 'text-zinc-600 hover:bg-zinc-50'
        }`}
        style={{ paddingLeft: indent + 22 }}
        title={node.path}
      >
        <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        <span className="truncate">{node.name}</span>
      </button>
    );
  }

  const isExpanded = expanded.has(node.path);
  const isLoading = node._loading;
  return (
    <div>
      <div
        className="group flex min-w-0 items-center gap-0.5 rounded-md hover:bg-zinc-50"
        style={{ paddingLeft: indent + 4 }}
      >
        <button
          type="button"
          onClick={() => onToggle(node.path)}
          className="shrink-0 p-1 text-zinc-400 hover:text-zinc-700"
          aria-expanded={isExpanded}
          aria-label={`展开/折叠 ${node.name}`}
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
        {isExpanded ? (
          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        ) : (
          <Folder className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        )}
        <button
          type="button"
          onClick={() => onToggle(node.path)}
          className="min-w-0 flex-1 truncate py-1 pr-2 text-left text-sm text-zinc-800"
          title={node.path}
        >
          {node.name}
        </button>
      </div>
      {isExpanded &&
        node.children.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            selectedPath={selectedPath}
            onToggle={onToggle}
            onOpenFile={onOpenFile}
          />
        ))}
    </div>
  );
}

function LazyTree({ items, selectedPath, onOpenFile, projectId, onFetchDir }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const [loadedDirs, setLoadedDirs] = useState(() => new Set());
  const [loadingDirs, setLoadingDirs] = useState(() => new Set());
  const [dirChildren, setDirChildren] = useState(() => ({}));
  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    if (!projectId || !onFetchDir) return;
    setInitialLoading(true);
    onFetchDir(projectId, '.').then((files) => {
      setDirChildren({ '.': files });
      setLoadedDirs(new Set(['.']));
      setInitialLoading(false);
    }).catch(() => {
      setInitialLoading(false);
    });
  }, [projectId, onFetchDir]);

  const toggle = useCallback(async (path) => {
    if (expanded.has(path)) {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
      return;
    }

    if (!loadedDirs.has(path) && onFetchDir) {
      setLoadingDirs((prev) => new Set(prev).add(path));
      try {
        const files = await onFetchDir(projectId, path);
        setDirChildren((prev) => ({ ...prev, [path]: files }));
        setLoadedDirs((prev) => new Set(prev).add(path));
      } finally {
        setLoadingDirs((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    }

    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(path);
      return next;
    });
  }, [expanded, loadedDirs, onFetchDir, projectId]);

  const buildTree = useCallback((dirPath, depth) => {
    const items = dirChildren[dirPath] || [];
    const nodes = [];
    // 防御性深度限制：防止循环引用或异常数据导致栈溢出
    if (depth > 100) return nodes;
    for (const item of items) {
      if (item.type === 'directory') {
        // 跳过自身引用（item.path === dirPath 会导致无限递归）
        if (item.path === dirPath) continue;
        nodes.push({
          ...item,
          children: expanded.has(item.path) ? buildTree(item.path, depth + 1) : [],
          _loading: loadingDirs.has(item.path),
        });
      } else {
        nodes.push({ ...item, children: [] });
      }
    }
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return nodes;
  }, [dirChildren, expanded, loadingDirs]);

  useEffect(() => {
    if (!selectedPath) return;
    const ancestors = collectAncestorFolderPaths(selectedPath);
    if (!ancestors.length) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const p of ancestors) next.add(p);
      return next;
    });
  }, [selectedPath]);

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center py-4" data-testid="tree-loading">
        <Loader2 className="animate-spin h-4 w-4 text-zinc-400" />
      </div>
    );
  }

  const tree = buildTree('.', 0);

  if (!tree.length) {
    return <div className="py-4 text-center text-sm text-zinc-400" data-testid="tree-empty">暂无文件</div>;
  }

  return (
    <div className="flex flex-col gap-0.5">
      {tree.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          expanded={expanded}
          selectedPath={selectedPath}
          onToggle={toggle}
          onOpenFile={onOpenFile}
        />
      ))}
    </div>
  );
}

export default function WorkspaceFileTree({ items, selectedPath, onOpenFile, showHidden = false, lazy, projectId, onFetchDir }) {
  if (lazy) {
    return (
      <LazyTree
        selectedPath={selectedPath}
        onOpenFile={onOpenFile}
        projectId={projectId}
        onFetchDir={onFetchDir}
      />
    );
  }

  const tree = useMemo(() => buildFileTree(items, { showHidden }), [items, showHidden]);
  const [expanded, setExpanded] = useState(() => new Set());

  useEffect(() => {
    if (!selectedPath) return;
    const ancestors = collectAncestorFolderPaths(selectedPath);
    if (!ancestors.length) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const p of ancestors) next.add(p);
      return next;
    });
  }, [selectedPath]);

  const toggle = (path) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  if (!tree.length) return null;

  return (
    <div className="flex flex-col gap-0.5">
      {tree.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          expanded={expanded}
          selectedPath={selectedPath}
          onToggle={toggle}
          onOpenFile={onOpenFile}
        />
      ))}
    </div>
  );
}
