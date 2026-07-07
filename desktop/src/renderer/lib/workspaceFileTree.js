const HIDDEN_WORKSPACE_DIRS = new Set(['.agents', '.git', '.xensemble', '.scrollback']);

export function isHiddenWorkspacePath(itemPath) {
  const segments = String(itemPath || '').split('/').filter(Boolean);
  return segments.some((seg) => HIDDEN_WORKSPACE_DIRS.has(seg));
}

export function filterVisibleWorkspaceItems(items, { showHidden = false } = {}) {
  if (showHidden) return items;
  return items.filter((item) => !isHiddenWorkspacePath(item.path));
}

export function collectAncestorFolderPaths(filePath) {
  if (!filePath) return [];
  const segments = filePath.split('/').filter(Boolean);
  if (segments.length <= 1) return [];
  const paths = [];
  for (let i = 1; i < segments.length; i++) {
    paths.push(segments.slice(0, i).join('/'));
  }
  return paths;
}

function sortNodes(nodes) {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) {
    if (node.type === 'directory' && node.children.length) sortNodes(node.children);
  }
}

export function buildFileTree(items, { showHidden = false } = {}) {
  const root = { type: 'directory', name: '', path: '', children: [] };

  for (const item of filterVisibleWorkspaceItems(items, { showHidden })) {
    const segments = item.path.split('/').filter(Boolean);
    if (!segments.length) continue;

    let current = root;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const isLast = i === segments.length - 1;
      const partialPath = segments.slice(0, i + 1).join('/');

      if (isLast && item.type === 'file') {
        current.children.push({ name: seg, path: item.path, type: 'file' });
        continue;
      }

      let node = current.children.find((c) => c.type === 'directory' && c.name === seg);
      if (!node) {
        node = { name: seg, path: partialPath, type: 'directory', children: [] };
        current.children.push(node);
      }
      current = node;
    }
  }

  sortNodes(root.children);
  return root.children;
}
