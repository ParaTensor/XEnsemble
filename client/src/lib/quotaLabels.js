const QUOTA_DIMENSION_LABELS = {
  max_projects: 'Workspaces',
  projects: 'Workspaces',
  max_sessions: 'Sessions',
  sessions: 'Sessions',
  max_previews: 'Previews',
  previews: 'Previews',
};

export function quotaDimensionLabel(dimension) {
  return QUOTA_DIMENSION_LABELS[dimension] || dimension;
}

export function formatQuotaExceeded(dimension, current, limit) {
  return `${quotaDimensionLabel(dimension)} quota exceeded (${current}/${limit}).`;
}
