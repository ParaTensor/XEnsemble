export function getApiBase() {
  const host = window.location.hostname || 'localhost';
  return `http://${host}:3000`;
}

export function apiFetch(path, token, options = {}) {
  const headers = {
    ...(options.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${getApiBase()}${path}`, { ...options, headers });
}
