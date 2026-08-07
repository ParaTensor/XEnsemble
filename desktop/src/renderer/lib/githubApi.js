import { apiFetch } from './api';

async function request(path, options = {}) {
  const res = await apiFetch(path, options);
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed: ${res.status}`);
  }
  return data;
}

export function openExternal(url) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export const getGitStatus = (projectId) =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/git/status`);

export const commitStaged = (projectId, message, author) => {
  const body = { message };
  if (author) body.author = author;
  return request(`/api/v1/projects/${encodeURIComponent(projectId)}/git/commit`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
};

export const stageFiles = (projectId, files) =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/git/stage`, {
    method: 'POST',
    body: JSON.stringify({ files }),
  });

export const unstageFiles = (projectId, files) =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/git/unstage`, {
    method: 'POST',
    body: JSON.stringify({ files }),
  });

export const pushBranch = (projectId, branch) =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/git/push`, {
    method: 'POST',
    body: JSON.stringify({ branch }),
  });

export const pullLatest = (projectId) =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/git/pull`, {
    method: 'POST',
  });

export const fetchRemote = (projectId) =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/git/fetch`, {
    method: 'POST',
  });

export const getGitDiff = (projectId, { base, head } = {}) => {
  const qs = new URLSearchParams();
  if (base) qs.set('base', base);
  if (head) qs.set('head', head);
  const query = qs.toString();
  return request(`/api/v1/projects/${encodeURIComponent(projectId)}/git/diff${query ? `?${query}` : ''}`);
};

export const getGitFileDiff = (projectId, filePath) =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/git/file-diff?path=${encodeURIComponent(filePath)}`);

export const getGitFileDiffView = (projectId, filePath) =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/git/file-diff-view?path=${encodeURIComponent(filePath)}`);

export const getGitFileContent = (projectId, filePath, ref = 'HEAD') =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/git/file-content?path=${encodeURIComponent(filePath)}&ref=${encodeURIComponent(ref)}`);

export const listBranches = (projectId) =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/branches`);

export const createPullRequest = (projectId, payload) =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/pull-requests`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
