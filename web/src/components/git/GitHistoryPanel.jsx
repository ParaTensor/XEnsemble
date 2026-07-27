import React, { useCallback, useEffect, useState } from 'react';
import { GitBranch, GitCommit, Loader2, RefreshCw, User } from 'lucide-react';
import * as gitApi from '../../lib/gitApi';
import { useToast } from '../Toast';
import {
  consoleIconButtonClass,
  textPrimary,
  textSecondary,
} from '../../lib/consoleTheme';

function formatTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return isNaN(d.getTime()) ? ts : d.toLocaleString();
}

function formatTimeAgo(ts) {
  if (!ts) return '';
  const now = Date.now() / 1000;
  const diff = now - ts;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 2592000)}mo ago`;
}

const BRANCH_COLORS = [
  { bg: '#FDE8E8', text: '#9B1C1C' },
  { bg: '#DEF7EC', text: '#03543F' },
  { bg: '#E1EFFE', text: '#1E429F' },
];

function isBranchRef(ref) {
  return !ref.name.startsWith('tag:') && ref.label !== 'tag';
}

function isRemoteRef(ref) {
  return ref.name.includes('/');
}

function CommitRow({ commit }) {
  const [expanded, setExpanded] = useState(false);
  const graphLines = (commit.graph || '').split('\n');
  const refs = (commit.refs || []).filter(isBranchRef);

  return (
    <div className="flex group hover:bg-[#F4F5F6] transition-colors cursor-pointer"
         onClick={() => setExpanded(!expanded)}>
      <pre className="font-mono text-[10px] leading-[12px] text-[#8B949E] select-none shrink-0 w-16 overflow-hidden py-px">
        {graphLines.map((line, i) => (
          <div key={i}>{line || ' '}</div>
        ))}
      </pre>

      <div className="flex-1 min-w-0 py-px border-b border-[#E8EAED]">
        <div className="flex items-center gap-2 pr-2">
          <span className="text-xs font-medium text-[#1F2328] line-clamp-1 leading-4">
            {commit.message}
          </span>

          {refs.length > 0 && (
            <span className="flex items-center gap-1 shrink-0">
              {refs.map((ref, i) => {
                const colorIdx = ref.name === 'HEAD' ? 0 : isRemoteRef(ref) ? 2 : 1;
                const color = BRANCH_COLORS[colorIdx % BRANCH_COLORS.length];
                return (
                  <span
                    key={i}
                    className="inline-flex items-center gap-0.5 text-[9px] font-medium rounded-full px-1.5 py-px whitespace-nowrap"
                    style={{ backgroundColor: color.bg, color: color.text }}
                  >
                    <GitBranch className="h-2 w-2" />
                    {ref.name.replace(/^origin\//, '')}
                  </span>
                );
              })}
            </span>
          )}

          <span className="text-[10px] text-[#8B949E] shrink-0 ml-auto">{commit.author}</span>
          <span className="text-[10px] text-[#8B949E] shrink-0" title={formatTimestamp(commit.timestamp)}>
            {formatTimeAgo(commit.timestamp)}
          </span>
          <span className="font-mono text-[9px] text-[#8B949E] bg-[#E8EAED] rounded px-1 shrink-0 hidden group-hover:inline">
            {commit.sha?.slice(0, 7)}
          </span>
        </div>

        {expanded && commit.message && (
          <div className="px-1 pb-1.5 text-[10px] text-[#8B949E] whitespace-pre-wrap">
            {commit.message}
          </div>
        )}
      </div>
    </div>
  );
}

export default function GitHistoryPanel({ projectId, filePath }) {
  const { showToast } = useToast();
  const [commits, setCommits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState(30);

  const fetchHistory = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const data = await gitApi.getGraphLog(projectId, count);
      setCommits(data.commits || []);
    } catch (err) {
      showToast('error', err.message);
      setCommits([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, count, showToast]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const loadMore = () => setCount((c) => c + 30);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between border-b border-[#E8EAED] px-3 py-1.5 shrink-0">
        <div className="flex items-center gap-2">
          <GitCommit className="h-3.5 w-3.5 text-[#5F6368]" />
          <h3 className={`text-xs font-semibold ${textPrimary}`}>History</h3>
        </div>
        <button
          type="button"
          onClick={fetchHistory}
          disabled={loading}
          title="Refresh"
          className={consoleIconButtonClass}
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {loading && commits.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-[#5F6368]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading history...
          </div>
        ) : commits.length === 0 ? (
          <div className="text-center py-8">
            <GitCommit className="mx-auto h-8 w-8 text-[#9AA0A6] mb-2" />
            <p className={`text-sm ${textSecondary}`}>No commits found.</p>
          </div>
        ) : (
          <div>
            {commits.map((commit, idx) => (
              <CommitRow
                key={commit.sha || idx}
                commit={commit}
              />
            ))}
            {commits.length >= count && (
              <div className="text-center py-2">
                <button
                  type="button"
                  onClick={loadMore}
                  className="text-xs font-medium text-[#5F6368] hover:text-[#202124] transition-colors"
                >
                  Load more...
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}