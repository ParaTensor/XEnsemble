import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from 'lucide-react';
import { buildFileTree, collectFolderPaths } from '../lib/workspaceFileTree';

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
        >
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
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

export default function WorkspaceFileTree({ items, selectedPath, onOpenFile }) {
  const tree = useMemo(() => buildFileTree(items), [items]);
  const [expanded, setExpanded] = useState(() => new Set());

  useEffect(() => {
    setExpanded(new Set(collectFolderPaths(items)));
  }, [items]);

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
