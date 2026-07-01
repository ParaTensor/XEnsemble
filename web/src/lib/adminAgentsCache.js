const STORAGE_KEY = 'xensemble.admin.agents';

export function loadAdminAgentsCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data.agents) ? data.agents : [];
  } catch {
    return [];
  }
}

export function saveAdminAgentsCache(agents) {
  if (!Array.isArray(agents)) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ agents, savedAt: Date.now() }));
  } catch {
    // ignore quota errors
  }
}
