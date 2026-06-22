import { apiFetch } from './api.ts';

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
  if (typeof window !== 'undefined' && window.xensembleDesktopAPI?.openExternal) {
    return window.xensembleDesktopAPI.openExternal(url);
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

// GitHub OAuth connection
export const getConnection = () => request('/api/v1/github/connection');
export const connectGitHub = () => request('/api/v1/github/connect', { method: 'POST' });
export const disconnectGitHub = () => request('/api/v1/github/connection', { method: 'DELETE' });

// GitHub repos
export const listGitHubRepos = (params = {}) => {
  const qs = new URLSearchParams(params);
  return request(`/api/v1/github/repos?${qs.toString()}`);
};

export const getGitHubRepo = (owner, repo) => request(`/api/v1/github/repos/${owner}/${repo}`);

// Project import
export const importGitHubRepo = (payload) =>
  request('/api/v1/projects/import-github', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

// Project metadata
export const getProject = (projectId) => request(`/api/v1/projects/${encodeURIComponent(projectId)}`);

// Git status and operations
export const getGitStatus = (projectId) =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/git/status`);

export const commitAll = (projectId, message) =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/git/commit`, {
    method: 'POST',
    body: JSON.stringify({ message }),
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

export const getGitDiff = (projectId, { base, head } = {}) => {
  const qs = new URLSearchParams();
  if (base) qs.set('base', base);
  if (head) qs.set('head', head);
  const query = qs.toString();
  return request(`/api/v1/projects/${encodeURIComponent(projectId)}/git/diff${query ? `?${query}` : ''}`);
};

// Branches
export const listBranches = (projectId) =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/branches`);

export const createBranch = (projectId, name, baseBranch) =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/branches`, {
    method: 'POST',
    body: JSON.stringify({ name, base_branch: baseBranch }),
  });

export const switchBranch = (projectId, name) =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/branches/switch`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });

// Pull requests
export const listPullRequests = (projectId) =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/pull-requests`);

export const createPullRequest = (projectId, payload) =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/pull-requests`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const syncPullRequest = (projectId, prId) =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/pull-requests/${encodeURIComponent(prId)}/sync`, {
    method: 'POST',
  });
