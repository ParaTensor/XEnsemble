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

export function getWsUrl(sessionId, accessToken) {
  const params = new URLSearchParams({ sessionId });
  if (accessToken) params.set('access_token', accessToken);
  return `${getWsBase()}/ws/v1/terminal?${params.toString()}`;
}

export function publicFetch(path, options = {}) {
  return fetch(`${getApiBase()}${path}`, options);
}

export {
  apiFetch,
  getAccessToken,
  getRefreshToken,
  setTokens,
  clearTokens,
  refreshAccessToken,
} from './auth';
