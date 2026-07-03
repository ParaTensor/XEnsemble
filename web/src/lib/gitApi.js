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

export const listProviders = () => request('/api/v1/git/providers');

export const getProviderConfig = (provider) =>
  request(`/api/v1/git/providers/${encodeURIComponent(provider)}/config`);

export const getConnection = (provider) =>
  request(`/api/v1/git/connections/${encodeURIComponent(provider)}`);

export const connectProvider = (provider) =>
  request('/api/v1/git/connect', {
    method: 'POST',
    body: JSON.stringify({ provider }),
  });

export const disconnectProvider = (provider) =>
  request(`/api/v1/git/connections/${encodeURIComponent(provider)}`, {
    method: 'DELETE',
  });

export const listRepos = (provider, params = {}) => {
  const qs = new URLSearchParams({ provider, ...params });
  return request(`/api/v1/git/repos?${qs.toString()}`);
};

export const importRepo = (payload) =>
  request('/api/v1/projects/import-git', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const listMergeRequests = (projectId) =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/merge-requests`);

export const createMergeRequest = (projectId, payload) =>
  request(`/api/v1/projects/${encodeURIComponent(projectId)}/merge-requests`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
