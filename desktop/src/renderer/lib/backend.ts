const DEFAULT_BACKEND_URL = 'https://hk.xensemble.dev';

export function getBackendURL(): string {
  if (typeof window !== 'undefined' && (window as any).xensembleDesktopAPI) {
    return (window as any).xensembleDesktopAPI.getBackendURL() || DEFAULT_BACKEND_URL;
  }
  const host = window.location.hostname || 'localhost';
  const protocol = window.location.protocol || 'http:';
  return `${protocol}//${host}:3888`;
}

export function getApiBase(): string {
  return getBackendURL().replace(/\/$/, '');
}

export function getWsUrl(sessionId: string, accessToken: string | null): string {
  const base = getBackendURL();
  const wsProtocol = base.startsWith('https:') ? 'wss:' : 'ws:';
  const httpProtocolRemoved = base.replace(/^https?:/, '');
  const qs = new URLSearchParams({ sessionId });
  if (accessToken) qs.set('access_token', accessToken);
  return `${wsProtocol}${httpProtocolRemoved}/ws/v1/terminal?${qs.toString()}`;
}

export function publicFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${getApiBase()}${path}`, options);
}
