const LS_ACCESS = 'xe_access_token';
const LS_REFRESH = 'xe_refresh_token';

function apiUrl(path) {
  const env = import.meta.env.VITE_API_BASE?.trim();
  if (env) return `${env.replace(/\/+$/, '')}${path}`;
  if (import.meta.env.PROD) return path;
  return `http://localhost:3888${path}`;
}

export function getAccessToken() {
  return localStorage.getItem(LS_ACCESS);
}

export function getRefreshToken() {
  return localStorage.getItem(LS_REFRESH);
}

export function setTokens(accessToken, refreshToken) {
  localStorage.setItem(LS_ACCESS, accessToken);
  localStorage.setItem(LS_REFRESH, refreshToken);
}

export function clearTokens() {
  localStorage.removeItem(LS_ACCESS);
  localStorage.removeItem(LS_REFRESH);
}

let refreshPromise = null;

export async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const refreshToken = getRefreshToken();
      if (!refreshToken) return null;
      const res = await fetch(apiUrl('/api/v1/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.access_token || !data.refresh_token) return null;
      setTokens(data.access_token, data.refresh_token);
      return data.access_token;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function apiFetch(path, options = {}) {
  const accessToken = getAccessToken();
  const headers = {
    ...(options.headers || {}),
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const url = apiUrl(path);
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers.Authorization = `Bearer ${newToken}`;
      return fetch(url, { ...options, headers });
    }
  }
  return res;
}
