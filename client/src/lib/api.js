export function getApiBase() {
  const env = import.meta.env.VITE_API_BASE?.trim();
  if (env) return env.replace(/\/+$/, '');
  if (import.meta.env.PROD) return '';
  return 'http://localhost:3888';
}

export function getWsBase() {
  const env = import.meta.env.VITE_API_BASE?.trim();
  if (env) {
    const u = new URL(env);
    const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${u.host}`;
  }
  if (import.meta.env.PROD) {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}`;
  }
  return 'ws://localhost:3888';
}

export function apiFetch(path, token, options = {}) {
  const headers = {
    ...(options.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${getApiBase()}${path}`, { ...options, headers });
}
