import React, { useCallback, useEffect, useState } from 'react';
import { GitCommit, Loader2, RefreshCw } from 'lucide-react';
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
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return `${Math.floor(diff / 2592000)}mo`;
}

const BRANCH_BADGE = [
  { bg: '#FFEBE9', text: '#CF222E', dot: '#CF222E' },
  { bg: '#E6F4EA', text: '#1E7E34', dot: '#26A641' },
  { bg: '#DAEAFE', text: '#0550AE', dot: '#0969DA' },
];

function isBranchRef(ref) {
  return !ref.name.startsWith('tag:') && ref.label !== 'tag';
}

function isRemoteRef(ref) {
  return ref.name.includes('/');
}

function getGraphDotColor(refs) {
  const branchRefs = (refs || []).filter(isBranchRef);
  if (branchRefs.length === 0) return '#8B949E';
  if (branchRefs.some((r) => r.name === 'HEAD' || r.name === 'main' || r.name === 'master'))
    return '#1F2328';
  if (branchRefs.some((r) => isRemoteRef(r)))
    return '#0969DA';
  return '#26A641';
}

function CommitRow({ commit }) {
  const [expanded, setExpanded] = useState(false);
  const graphLines = (commit.graph || '').split('\n');
  const refs = (commit.refs || []).filter(isBranchRef);
  const dotColor = getGraphDotColor(commit.refs || []);
  const rowH = graphLines.length * 9;
  const curH = `${rowH}px`;

  return (
    <div>
      <div className="flex group cursor-pointer"
           style={{ minHeight: curH }}
           onClick={() => setExpanded(!expanded)}>
        <div className="font-mono text-[9px] leading-[9px] select-none shrink-0 w-12 overflow-hidden py-px"
             style={{ width: '48px', minWidth: '48px' }}>
          {graphLines.map((line, i) => {
            const starIdx = line.indexOf('*');
            if (starIdx === -1) {
              return (
                <div key={i} className="h-[9px] text-[#8B949E] whitespace-pre">
                  {line || ' '}
                </div>
              );
            }
            return (
              <div key={i} className="h-[9px] text-[#656D76] whitespace-pre flex items-center">
                <span>{line.slice(0, starIdx)}</span>
                <span className="inline-flex items-center">
                  <svg width="9" height="9" viewBox="0 0 9 9" className="shrink-0">
                    <circle cx="4.5" cy="4.5" r="3.5" fill={dotColor} stroke="none" />
                  </svg>
                </span>
                <span>{line.slice(starIdx + 1)}</span>
              </div>
            );
          })}
        </div>

        <div className="flex-1 min-w-0" style={{ paddingTop: Math.max(0, rowH - 14) / 2 + 'px' }}>
          <div className="flex items-center gap-1.5 pr-2 h-[14px]">
            <span className="text-[11px] font-medium text-[#1F2328] line-clamp-1 flex-1 min-w-0">
              {commit.message}
            </span>
            {refs.length > 0 && (
              <span className="flex items-center gap-0.5 shrink-0">
                {refs.map((ref, i) => {
                  const color = BRANCH_BADGE[i % BRANCH_BADGE.length];
                  return (
                    <span key={i}
                      className="inline-flex items-center gap-px text-[8px] font-medium rounded-full px-1.5 leading-[11px] whitespace-nowrap"
                      style={{ backgroundColor: color.bg, color: color.text }}>
                      <svg width="6" height="6" viewBox="0 0 9 9" className="shrink-0">
                        <circle cx="4.5" cy="4.5" r="3.5" fill={color.dot} />
                      </svg>
                      {ref.name.replace(/^origin\//, '')}
                    </span>
                  );
                })}
              </span>
            )}
            <span className="text-[9px] text-[#8B949E] shrink-0 max-w-[80px] truncate"
                  title={commit.author}>
              {commit.author?.split(/\s+/)[0]}
            </span>
            <span className="text-[9px] text-[#8B949E] shrink-0 w-[24px] text-right"
                  title={formatTimestamp(commit.timestamp)}>
              {formatTimeAgo(commit.timestamp)}
            </span>
            <span className="font-mono text-[8px] text-[#8B949E] shrink-0 hidden group-hover:inline">
              {commit.sha?.slice(0, 7)}
            </span>
          </div>
        </div>
      </div>

      {expanded && commit.message && (
        <div className="pl-12 pb-1.5 text-[10px] text-[#57606A] whitespace-pre-wrap pr-3">
          {commit.message}
        </div>
      )}
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