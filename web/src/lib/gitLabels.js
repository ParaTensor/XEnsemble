const PROVIDER_LABELS = {
  github: 'GitHub',
  gitlab: 'GitLab',
  gitea: 'Gitea',
  local_git: 'Local Git',
};

export function getProviderLabel(provider) {
  if (!provider || provider === 'none') return null;
  return PROVIDER_LABELS[provider] || provider;
}

export function getWorkspaceRepoLabel(project) {
  if (!project?.repoProvider || project.repoProvider === 'none') return null;
  if (project.githubFullName) return project.githubFullName;
  if (project.repoUrl) {
    try {
      return new URL(project.repoUrl).pathname.replace(/^\//, '').replace(/\.git$/, '');
    } catch {
      return project.repoUrl;
    }
  }
  return null;
}

export function isGitLinkedProject(project) {
  const provider = project?.repoProvider;
  return Boolean(provider && provider !== 'none');
}

export function isOAuthNotConfiguredError(message) {
  return String(message || '').toLowerCase().includes('not configured');
}

export function formatGitOAuthError(message, provider) {
  const label = getProviderLabel(provider) || provider || 'Git';
  if (isOAuthNotConfiguredError(message)) {
    return `${label} OAuth is not configured. Ask an administrator to set up OAuth credentials in Settings → Git.`;
  }
  return message || `${label} connection failed.`;
}
