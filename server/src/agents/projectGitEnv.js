function applyProjectGitEnv(env, project) {
    if (!env || !project) return env;
    const provider = String(project.repoProvider || '').trim();
    if (!provider || provider === 'none' || provider === 'local_git') return env;

    env.XENSEMBLE_GIT_BRANCH = project.currentBranch || '';
    env.XENSEMBLE_GIT_BASE_BRANCH = project.repoDefaultBranch || '';
    env.XENSEMBLE_REPO_URL = project.remoteFullName || project.githubFullName || project.repoUrl || '';
    env.XENSEMBLE_REPO_PROVIDER = provider;
    return env;
}

module.exports = { applyProjectGitEnv };
