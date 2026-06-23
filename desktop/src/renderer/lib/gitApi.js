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

// ── Providers ──

export const listProviders = () => request('/api/v1/git/providers');

export const getProviderConfig = (provider) =>
  request(`/api/v1/git/providers/${encodeURIComponent(provider)}/config`);

// ── Connections ──

export const getConnection = (provider) =>
  request(`/api/v1/git/connections/${encodeURIComponent(provider)}`);

export const connectProvider = (provider) =>
  request(`/api/v1/git/connect`, {
    method: 'POST',
    body: JSON.stringify({ provider }),
  });

export const disconnectProvider = (provider) =>
  request(`/api/v1/git/connections/${encodeURIComponent(provider)}`, {
    method: 'DELETE',
  });

// ── Repos ──

export const listRepos = (provider, params = {}) => {
  const qs = new URLSearchParams(params);
  return request(`/api/v1/git/repos/${encodeURIComponent(provider)}?${qs.toString()}`);
};

// ── Import ──

export const importRepo = (payload) =>
  request('/api/v1/git/import', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

// ── Merge Requests ──

export const listMergeRequests = (projectId) =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/merge-requests`);

export const createMergeRequest = (projectId, payload) =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/merge-requests`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const syncMergeRequest = (projectId, mrId) =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/merge-requests/${encodeURIComponent(mrId)}/sync`, {
    method: 'POST',
  });

// ── Reviews (Phase 4) ──

export const listReviews = (projectId, mrId) =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/merge-requests/${encodeURIComponent(mrId)}/reviews`);

export const listReviewComments = (projectId, mrId, params = {}) => {
  const qs = new URLSearchParams(params);
  return request(`/api/v1/projects/${encodeURIComponent(projectId)}/merge-requests/${encodeURIComponent(mrId)}/comments?${qs}`);
};

// ── Repository (Phase 4) ──

export const getBlame = (projectId, filePath, params = {}) => {
  const qs = new URLSearchParams({ path: filePath, ...params });
  return request(`/api/v1/projects/${encodeURIComponent(projectId)}/repository/blame?${qs}`);
};

export const getDetailedLog = (projectId, params = {}) => {
  const qs = new URLSearchParams(params);
  return request(`/api/v1/projects/${encodeURIComponent(projectId)}/repository/log/detailed?${qs}`);
};

export const conflictCheck = (projectId, targetBranch) => {
  const qs = new URLSearchParams({ target: targetBranch });
  return request(`/api/v1/projects/${encodeURIComponent(projectId)}/repository/conflict-check?${qs}`);
};

export const listConflicts = (projectId) =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/repository/conflicts`);

export const resolveConflict = (projectId, filePath, strategy) =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/repository/conflicts/resolve`, {
    method: 'POST',
    body: JSON.stringify({ path: filePath, strategy }),
  });

export const getFileAtRef = (projectId, filePath, ref = 'HEAD') => {
  const qs = new URLSearchParams({ path: filePath, ref });
  return request(`/api/v1/projects/${encodeURIComponent(projectId)}/repository/file?${qs}`);
};
