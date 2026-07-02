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

export const listBranches = (projectId) =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/branches`);

export const createPullRequest = (projectId, payload) =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/pull-requests`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
