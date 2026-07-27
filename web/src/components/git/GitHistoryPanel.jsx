import React, { useCallback, useEffect, useState } from 'react';
import { Clock, FileText, GitCommit, GitBranch, Lock, Loader2, RefreshCw, User } from 'lucide-react';
import * as gitApi from '../../lib/gitApi';
import { useToast } from '../Toast';
import {
  consoleIconButtonClass,
  textPrimary,
  textSecondary,
  textPlaceholder,
  borderHairline,
  bgCanvas,
} from '../../lib/consoleTheme';

const REF_COLORS = [
  { bg: '#FDE8E8', text: '#9B1C1C' },
  { bg: '#DEF7EC', text: '#03543F' },
  { bg: '#E1EFFE', text: '#1E429F' },
  { bg: '#FEF3C7', text: '#92400F' },
  { bg: '#EDEBFE', text: '#5521B5' },
  { bg: '#FCE7F3', text: '#9D174D' },
];

function formatTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return isNaN(d.getTime()) ? ts : d.toLocaleString();
}

function getRefColor(index) {
  return REF_COLORS[index % REF_COLORS.length];
}

function CommitGraph({ commit, isLast }) {
  const [expanded, setExpanded] = useState(false);
  const refs = commit.refs || [];
  const graphLines = commit.graph.split('\n');

  return (
    <div className="group">
      <div className="flex items-start">
        <pre className="font-mono text-[10px] leading-[18px] text-[#5F6368] select-none shrink-0 w-20 overflow-hidden pt-[3px]">
          {graphLines.map((line, i) => (
            <div key={i}>{line || ' '}</div>
          ))}
        </pre>

        <div className="flex-1 min-w-0">
          <div
            className={`rounded-lg border ${borderHairline} p-3 mb-1 cursor-pointer transition-colors hover:bg-[#FAFBFC]`}
            onClick={() => setExpanded(!expanded)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                {refs.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {refs.map((ref, i) => {
                      const color = getRefColor(i);
                      return (
                        <span
                          key={i}
                          className="inline-flex items-center gap-0.5 text-[10px] font-medium rounded-full px-2 py-0.5"
                          style={{ backgroundColor: color.bg, color: color.text }}
                        >
                          {ref.label === 'HEAD' || (ref.label === 'ref' && ref.name.includes('HEAD')) ? (
                            <Lock className="h-2.5 w-2.5" />
                          ) : (
                            <GitBranch className="h-2.5 w-2.5" />
                          )}
                          {ref.name}
                        </span>
                      );
                    })}
                  </div>
                )}
                <p className={`text-sm font-medium ${textPrimary} line-clamp-1`}>
                  {commit.message}
                </p>
                <div className={`flex items-center gap-3 mt-1 text-xs ${textSecondary}`}>
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {commit.author}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatTimestamp(commit.timestamp)}
                  </span>
                </div>
              </div>
              <span className="shrink-0 font-mono text-[10px] text-[#5F6368] bg-[#F4F5F6] rounded px-1.5 py-0.5">
                {commit.sha?.slice(0, 7)}
              </span>
            </div>

            {expanded && (
              <div className="mt-3 space-y-2">
                {commit.body && (
                  <pre className={`whitespace-pre-wrap text-xs ${textSecondary} bg-[#F4F5F6] rounded p-2`}>
                    {commit.body}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>
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
      <div className="flex items-center justify-between border-b border-[#E8EAED] px-4 py-2.5 shrink-0">
        <div className="flex items-center gap-2">
          <GitCommit className="h-4 w-4 text-[#5F6368]" />
          <h3 className={`text-sm font-semibold ${textPrimary}`}>
            Commit Graph
          </h3>
          {filePath && (
            <span className="font-mono text-[10px] text-[#5F6368] bg-[#F4F5F6] rounded px-1.5 py-0.5 max-w-[12rem] truncate">
              {filePath}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={fetchHistory}
          disabled={loading}
          title="Refresh history"
          className={consoleIconButtonClass}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-4">
        {loading && commits.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-[#5F6368]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading history…
          </div>
        ) : commits.length === 0 ? (
          <div className="text-center py-8">
            <GitCommit className="mx-auto h-8 w-8 text-[#9AA0A6] mb-2" />
            <p className={`text-sm ${textSecondary}`}>No commits found.</p>
          </div>
        ) : (
          <div className="space-y-0">
            {commits.map((commit, idx) => (
              <CommitGraph
                key={commit.sha || idx}
                commit={commit}
                isLast={idx === commits.length - 1}
              />
            ))}
            {commits.length >= count && (
              <div className="text-center pt-3">
                <button
                  type="button"
                  onClick={loadMore}
                  className="text-xs font-medium text-[#5F6368] hover:text-[#202124] transition-colors"
                >
                  Load more…
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}