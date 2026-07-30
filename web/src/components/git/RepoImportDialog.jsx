import { useEffect, useMemo, useState, useRef } from 'react';
import { GitBranch, Loader2, Search, AlertCircle, Link2 } from 'lucide-react';
import {
  ConsoleDialogShell,
  ConsoleStructuredDialogHeader,
  ConsoleStructuredDialogBody,
  ConsoleStructuredDialogFooter,
} from '../ConsoleDialog';
import Input, { FormLabel } from '../Input';
import Button from '../Button';
import GitConnectButton from './GitConnectButton';
import GitOAuthAlert from './GitOAuthAlert';
import { useGitProvider } from '../../hooks/useGitProvider';
import { formatGitOAuthError } from '../../lib/gitLabels';
import { useToast } from '../Toast';
import * as gitApi from '../../lib/gitApi';
import * as githubApi from '../../lib/githubApi';
import {
  consoleDialogLgClass,
  textPlaceholder,
  textPrimary,
  textSecondary,
  borderHairline,
} from '../../lib/consoleTheme';

const CLONE_POLL_INTERVAL_MS = 2000;
const MAX_CLONE_POLL_ATTEMPTS = 300;

function parseRepoUrl(input) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let path = trimmed;
  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    path = url.pathname;
  } catch {
    path = trimmed;
  }
  path = path.replace(/^\/+/, '').replace(/\.git$/, '').replace(/\/(tree|blob)\/.*$/, '').replace(/\/+$/, '');
  return path || null;
}

function normalizeRepo(repo) {
  const fullName = repo.full_name || repo.fullName || '';
  return {
    ...repo,
    full_name: fullName,
    name: repo.name || fullName.split('/').pop() || '',
    default_branch: repo.default_branch || repo.defaultBranch || 'main',
  };
}

const PROVIDER_OPTIONS = [
  { id: 'github', label: 'GitHub' },
  { id: 'gitlab', label: 'GitLab' },
  { id: 'gitea', label: 'Gitea' },
];

export default function RepoImportDialog({ open, onClose, onImported, fetchWorkspaces }) {
  const { showToast } = useToast();
  const [provider, setProvider] = useState('github');
  const { connection, loading: connectionLoading, error: connectError, connect, disconnect } = useGitProvider(provider);
  const [providerOAuthConfigured, setProviderOAuthConfigured] = useState(null);

  const [repos, setRepos] = useState([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedFullName, setSelectedFullName] = useState('');
  const [mode, setMode] = useState('browse');
  const [urlInput, setUrlInput] = useState('');
  const [urlFetching, setUrlFetching] = useState(false);
  const [urlError, setUrlError] = useState(null);
  const urlInputRef = useRef(null);

  const [name, setName] = useState('');
  const [branch, setBranch] = useState('');
  const [workBranchName, setWorkBranchName] = useState(`xensemble/${Date.now()}`);
  const [autoCreateBranch, setAutoCreateBranch] = useState(true);

  const [importing, setImporting] = useState(false);
  const [importedProjectId, setImportedProjectId] = useState(null);
  const [cloneStatus, setCloneStatus] = useState(null);
  const [cloneError, setCloneError] = useState(null);

  const selectedRepo = useMemo(
    () => repos.find((r) => r.full_name === selectedFullName) || null,
    [repos, selectedFullName],
  );

  const resetForm = () => {
    setRepos([]);
    setQuery('');
    setSelectedFullName('');
    setMode('browse');
    setUrlInput('');
    setUrlFetching(false);
    setUrlError(null);
    setName('');
    setBranch('');
    setWorkBranchName(`xensemble/${Date.now()}`);
    setAutoCreateBranch(true);
    setImporting(false);
    setImportedProjectId(null);
    setCloneStatus(null);
    setCloneError(null);
  };

  const handleClose = () => {
    if (importing && !cloneStatus) return;
    resetForm();
    onClose();
  };

  const loadRepos = async () => {
    setReposLoading(true);
    try {
      const data = await gitApi.listRepos(provider, { per_page: '100' });
      const rows = data.repos || data;
      setRepos(Array.isArray(rows) ? rows.map(normalizeRepo) : []);
    } catch (err) {
      showToast('error', err.message);
      setRepos([]);
    } finally {
      setReposLoading(false);
    }
  };

  const handleFetchUrl = async () => {
    const repoPath = parseRepoUrl(urlInput);
    if (!repoPath) {
      setUrlError('Invalid URL. Use owner/repo or https://github.com/owner/repo');
      return;
    }
    setUrlFetching(true);
    setUrlError(null);
    try {
      const data = await gitApi.getRepo(provider, repoPath);
      const repo = normalizeRepo(data.repo || data);
      setRepos((prev) => prev.some((r) => r.full_name === repo.full_name) ? prev : [...prev, repo]);
      setSelectedFullName(repo.full_name);
    } catch (err) {
      setUrlError(err.message || 'Repository not found or no access');
    } finally {
      setUrlFetching(false);
    }
  };

  const switchMode = (next) => {
    setMode(next);
    setUrlError(null);
    if (next === 'url') {
      requestAnimationFrame(() => urlInputRef.current?.focus());
    }
  };

  useEffect(() => {
    if (!open) {
      resetForm();
      setProviderOAuthConfigured(null);
      return;
    }
    gitApi.listProviders()
      .then((data) => {
        const map = {};
        for (const p of data.providers || []) {
          map[p.name] = p.oauth_configured ?? p.oauthConfigured ?? false;
        }
        setProviderOAuthConfigured(map);
      })
      .catch(() => setProviderOAuthConfigured({}));
    if (connection) loadRepos();
  }, [open, connection, provider]);

  const oauthNotConfigured = providerOAuthConfigured?.[provider] === false;
  const oauthAlertMessage = connectError
    || (oauthNotConfigured ? `${provider} OAuth is not configured` : null);

  useEffect(() => {
    if (selectedRepo) {
      setName(selectedRepo.name || '');
      setBranch(selectedRepo.default_branch || 'main');
    }
  }, [selectedRepo]);

  useEffect(() => {
    if (!importedProjectId || cloneStatus === 'ready' || cloneStatus === 'failed') return;
    let attempts = 0;
    const id = setInterval(async () => {
      attempts += 1;
      try {
        await fetchWorkspaces?.();
        const res = await githubApi.getCloneStatus(importedProjectId);
        if (res?.clone_status === 'ready') {
          setCloneStatus('ready');
          clearInterval(id);
          showToast('success', 'Repository imported and ready.');
          onImported?.(importedProjectId);
          handleClose();
        } else if (res?.clone_status === 'failed') {
          setCloneStatus('failed');
          setCloneError(res.clone_error || 'Clone failed. Please check your repository URL and credentials.');
          clearInterval(id);
        }
      } catch {
        // Still cloning or endpoint temporarily unavailable
      }
      if (attempts >= MAX_CLONE_POLL_ATTEMPTS) {
        clearInterval(id);
        setCloneError('Clone is taking longer than expected. It will continue in the background.');
      }
    }, CLONE_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [importedProjectId, cloneStatus, fetchWorkspaces, onImported, showToast]);

  const filteredRepos = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) => r.full_name?.toLowerCase().includes(q));
  }, [repos, query]);

  const handleImport = async () => {
    if (!selectedFullName) return;
    setImporting(true);
    try {
      const result = await gitApi.importRepo({
        provider,
        repo_full_name: selectedFullName,
        name: name.trim() || selectedRepo?.name,
        branch: branch.trim() || selectedRepo?.default_branch || 'main',
        auto_create_branch: autoCreateBranch,
        work_branch_name: workBranchName.trim() || `xensemble/${Date.now()}`,
      });
      setImportedProjectId(result.id);
      setCloneStatus(result.status || 'cloning');
      showToast('success', 'Import started. Cloning repository…');
    } catch (err) {
      showToast('error', err.message);
      setImporting(false);
    }
  };

  const canImport = Boolean(
    selectedFullName && name.trim() && branch.trim() && (!autoCreateBranch || workBranchName.trim()),
  );

  const username = connection?.remote_username || connection?.remoteUsername
    || connection?.github_username || connection?.githubUsername || '';

  if (!open) return null;

  return (
    <ConsoleDialogShell
      onClose={handleClose}
      panelClassName={`${consoleDialogLgClass} max-h-[calc(100vh-2rem)]`}
    >
      <ConsoleStructuredDialogHeader
        title="Import Repository"
        subtitle={connection ? 'Select a repository to import as a workspace.' : 'Connect a Git provider to import repositories.'}
      />
      <ConsoleStructuredDialogBody>
        <div className="flex items-center gap-2 mb-4">
          {PROVIDER_OPTIONS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { setProvider(p.id); setRepos([]); setSelectedFullName(''); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                provider === p.id
                  ? 'bg-[#202124] text-white'
                  : 'bg-[#F4F5F6] text-[#5F6368] hover:bg-[#E8EAED] hover:text-[#202124]'
              }`}
            >
              {p.label}
              {providerOAuthConfigured?.[p.id] === false && (
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    provider === p.id ? 'bg-[#FADBD8]' : 'bg-[#C06C5D]'
                  }`}
                  title="OAuth not configured"
                />
              )}
            </button>
          ))}
        </div>

        {!connection ? (
          <div className="space-y-4">
            {oauthAlertMessage && (
              <GitOAuthAlert message={oauthAlertMessage} provider={provider} />
            )}
            <p className={textSecondary}>
              {oauthNotConfigured
                ? `An administrator must configure ${PROVIDER_OPTIONS.find((p) => p.id === provider)?.label} OAuth before you can connect.`
                : `Connect your ${PROVIDER_OPTIONS.find((p) => p.id === provider)?.label} account to import repositories.`}
            </p>
            <GitConnectButton
              provider={provider}
              connection={connection}
              loading={connectionLoading}
              onConnect={connect}
              onDisconnect={disconnect}
              disabled={oauthNotConfigured}
              disabledReason={oauthNotConfigured ? formatGitOAuthError(`${provider} OAuth is not configured`, provider) : null}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-[#9AA0A6]" />
                <span className={`text-sm font-medium ${textPrimary}`}>{username}</span>
                <span className="text-xs text-[#9AA0A6]">({provider})</span>
              </div>
              <button
                type="button"
                onClick={disconnect}
                disabled={connectionLoading}
                className="text-xs text-[#5F6368] hover:text-[#202124]"
              >
                Disconnect
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => switchMode('browse')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${mode === 'browse' ? 'bg-[#202124] text-white' : 'bg-[#F4F5F6] text-[#5F6368] hover:bg-[#E8EAED]'}`}
              >
                <Search className="h-3 w-3" />
                Browse
              </button>
              <button
                type="button"
                onClick={() => switchMode('url')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${mode === 'url' ? 'bg-[#202124] text-white' : 'bg-[#F4F5F6] text-[#5F6368] hover:bg-[#E8EAED]'}`}
              >
                <Link2 className="h-3 w-3" />
                Paste URL
              </button>
            </div>

            {mode === 'url' ? (
              <div className="space-y-2">
                <div>
                  <FormLabel htmlFor="repo-url">Repository URL</FormLabel>
                  <div className="relative mt-1.5">
                    <Link2 className={`pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${textPlaceholder}`} />
                    <Input
                      ref={urlInputRef}
                      id="repo-url"
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !urlFetching) handleFetchUrl(); }}
                      placeholder="https://github.com/owner/repo"
                      className="pl-8"
                      disabled={urlFetching}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleFetchUrl}
                  disabled={urlFetching || !urlInput.trim()}
                  className="text-xs font-medium text-[#1967D2] hover:text-[#174EA6] disabled:opacity-50"
                >
                  {urlFetching ? 'Fetching…' : 'Fetch repository'}
                </button>
                {urlError && (
                  <div className="flex items-center gap-1.5 text-xs text-red-600">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    {urlError}
                  </div>
                )}
                {selectedRepo && mode === 'url' && (
                  <div className="flex items-center justify-between rounded-md border border-[#E8EAED] bg-[#FAFBFC] px-3 py-2">
                    <span className="min-w-0 truncate text-sm font-medium text-[#202124]">{selectedRepo.full_name}</span>
                    <span className="shrink-0 text-xs text-[#5F6368]">{selectedRepo.private ? 'Private' : 'Public'}{selectedRepo.language ? ` · ${selectedRepo.language}` : ''}</span>
                  </div>
                )}
              </div>
            ) : (
            <>
            <div>
              <FormLabel htmlFor="repo-search">Search repositories</FormLabel>
              <div className="relative mt-1.5">
                <Search className={`pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${textPlaceholder}`} />
                <Input
                  id="repo-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="owner/repo"
                  className="pl-8"
                />
              </div>
            </div>

            <div className={`max-h-48 overflow-auto rounded-lg border ${borderHairline}`}>
              {reposLoading ? (
                <div className="flex items-center justify-center gap-2 p-4 text-sm text-[#5F6368]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading repositories…
                </div>
              ) : filteredRepos.length === 0 ? (
                <div className="p-4 text-center text-sm text-[#5F6368]">
                  {repos.length === 0 ? 'No repositories found.' : 'No matches.'}
                </div>
              ) : (
                <ul className="divide-y divide-[#E8EAED]">
                  {filteredRepos.map((repo) => (
                    <li key={repo.id || repo.full_name}>
                      <button
                        type="button"
                        onClick={() => setSelectedFullName(repo.full_name)}
                        className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors ${
                          selectedFullName === repo.full_name ? 'bg-[#F4F5F6]' : 'hover:bg-[#FAFBFC]'
                        }`}
                      >
                        <span className="min-w-0 truncate font-medium text-[#202124]">
                          {repo.full_name}
                        </span>
                        <span className="shrink-0 text-xs text-[#5F6368]">
                          {repo.private ? 'Private' : 'Public'}
                          {repo.language ? ` · ${repo.language}` : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            </>
            )}

            {selectedRepo && (
              <div className="space-y-3 rounded-lg border border-[#E8EAED] bg-[#FAFBFC] p-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FormLabel htmlFor="import-name">Project name</FormLabel>
                    <Input
                      id="import-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="my-project"
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <FormLabel htmlFor="import-branch">Base branch</FormLabel>
                    <Input
                      id="import-branch"
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      placeholder="main"
                      className="mt-1.5"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm text-[#3C4043]">
                  <input
                    type="checkbox"
                    checked={autoCreateBranch}
                    onChange={(e) => setAutoCreateBranch(e.target.checked)}
                    className="rounded border-[#DADCE0] text-[#202124] focus:ring-[#202124]"
                  />
                  Auto-create work branch
                </label>

                {autoCreateBranch && (
                  <div>
                    <FormLabel htmlFor="import-work-branch">Work branch name</FormLabel>
                    <Input
                      id="import-work-branch"
                      value={workBranchName}
                      onChange={(e) => setWorkBranchName(e.target.value)}
                      placeholder="xensemble/dev"
                      className="mt-1.5"
                    />
                  </div>
                )}
              </div>
            )}

            {importedProjectId && (
              <div className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${cloneStatus === 'failed' ? 'bg-red-50 text-red-600' : 'bg-[#E8F0FE] text-[#1967D2]'}`}>
                {cloneStatus === 'failed' ? (
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                )}
                {cloneError || 'Cloning repository, please wait…'}
              </div>
            )}
          </div>
        )}
      </ConsoleStructuredDialogBody>
      <ConsoleStructuredDialogFooter>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleClose}
          disabled={importing && !cloneStatus}
        >
          Cancel
        </Button>
        {connection && (
          <Button
            type="button"
            size="sm"
            disabled={!canImport || importing}
            onClick={handleImport}
          >
            {importing ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Importing…
              </>
            ) : (
              'Import repository'
            )}
          </Button>
        )}
      </ConsoleStructuredDialogFooter>
    </ConsoleDialogShell>
  );
}
