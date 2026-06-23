import React from 'react';
import { GitBranch, Loader2, Unlink } from 'lucide-react';
import { cn } from '../../lib/utils';
import { consoleIconButtonClass } from '../../lib/consoleTheme';

const PROVIDER_LABELS = {
  github: 'GitHub',
  gitlab: 'GitLab',
  gitea: 'Gitea',
};

export default function GitConnectButton({
  provider = 'github',
  connection,
  loading,
  onConnect,
  onDisconnect,
  className,
}) {
  const label = PROVIDER_LABELS[provider] || provider;
  const username = connection?.remote_username || connection?.remoteUsername
    || connection?.github_username || connection?.githubUsername || '';

  if (connection) {
    return (
      <div className={cn('flex items-center gap-3', className)}>
        {connection.avatar_url || connection.github_avatar || connection.githubAvatar ? (
          <img
            src={connection.avatar_url || connection.github_avatar || connection.githubAvatar}
            alt=""
            className="h-6 w-6 rounded-full"
          />
        ) : (
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-100">
            <GitBranch className="h-3.5 w-3.5 text-zinc-600" />
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-zinc-900">
            {username || label}
          </p>
          <p className="text-xs text-zinc-500">Connected to {label}</p>
        </div>
        <button
          type="button"
          onClick={onDisconnect}
          disabled={loading}
          title={`Disconnect ${label}`}
          aria-label={`Disconnect ${label}`}
          className={cn(consoleIconButtonClass, 'ml-auto')}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Unlink className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onConnect}
      disabled={loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50',
        className,
      )}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <GitBranch className="h-4 w-4" />
      )}
      Connect to {label}
    </button>
  );
}
