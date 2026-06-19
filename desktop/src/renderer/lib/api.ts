const DEFAULT_BACKEND_URL = 'https://xensemble.dev';

export function getBackendURL(): string {
  if (typeof window !== 'undefined' && (window as any).xensembleDesktopAPI) {
    return (window as any).xensembleDesktopAPI.getBackendURL() || DEFAULT_BACKEND_URL;
  }
  const host = window.location.hostname || 'localhost';
  const protocol = window.location.protocol || 'http:';
  return `${protocol}//${host}:3000`;
}

export function getApiBase(): string {
  return getBackendURL().replace(/\/$/, '');
}

export function getWsUrl(sessionId: string): string {
  const base = getBackendURL();
  const wsProtocol = base.startsWith('https:') ? 'wss:' : 'ws:';
  const httpProtocolRemoved = base.replace(/^https?:/, '');
  return `${wsProtocol}${httpProtocolRemoved}/ws/v1/terminal?sessionId=${encodeURIComponent(sessionId)}`;
}

export function apiFetch(path: string, token: string | null, options: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {})
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${getApiBase()}${path}`, { ...options, headers });
}

export function publicFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${getApiBase()}${path}`, options);
}
