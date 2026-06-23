import React, { useCallback, useEffect, useState } from 'react';
import { Clock, FileText, GitCommit, Loader2, RefreshCw, User } from 'lucide-react';
import * as gitApi from '../../lib/gitApi.js';
import { useToast } from '../Toast';
import {
  consoleIconButtonClass,
  textPrimary,
  textSecondary,
  textPlaceholder,
  borderHairline,
  bgCanvas,
} from '../../lib/consoleTheme';

function formatTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return isNaN(d.getTime()) ? ts : d.toLocaleString();
}

function CommitItem({ commit, isLast }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="relative pl-6">
      {/* Timeline connector */}
      <div className="absolute left-[9px] top-0 bottom-0 w-px bg-[#E8EAED]" />
      <div className="absolute left-[5px] top-2.5 h-2.5 w-2.5 rounded-full border-2 border-[#202124] bg-white" />

      <div
        className={`rounded-lg border ${borderHairline} p-3 mb-2 cursor-pointer transition-colors hover:bg-[#FAFBFC]`}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
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
            {commit.files?.length > 0 && (
              <div className="space-y-0.5">
                <p className={`text-[10px] uppercase tracking-wider font-semibold ${textPlaceholder}`}>
                  Changed files ({commit.files.length})
                </p>
                <ul className="max-h-32 overflow-auto">
                  {commit.files.map((file, i) => (
                    <li key={i} className="flex items-center gap-1.5 py-0.5">
                      <FileText className="h-3 w-3 shrink-0 text-[#9AA0A6]" />
                      <span className="font-mono text-xs text-[#202124] truncate">{file}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
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
  const [count, setCount] = useState(20);

  const fetchHistory = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const params = { count: String(count) };
      if (filePath) params.path = filePath;
      const data = await gitApi.getDetailedLog(projectId, params);
      setCommits(data.commits || data || []);
    } catch (err) {
      showToast('error', err.message);
      setCommits([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, filePath, count, showToast]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const loadMore = () => setCount((c) => c + 20);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#E8EAED] px-4 py-2.5 shrink-0">
        <div className="flex items-center gap-2">
          <GitCommit className="h-4 w-4 text-[#5F6368]" />
          <h3 className={`text-sm font-semibold ${textPrimary}`}>
            Commit History
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

      {/* Commit timeline */}
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
          <>
            {commits.map((commit, idx) => (
              <CommitItem
                key={commit.sha || idx}
                commit={commit}
                isLast={idx === commits.length - 1}
              />
            ))}
            {commits.length >= count && (
              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={loadMore}
                  className="text-xs font-medium text-[#5F6368] hover:text-[#202124] transition-colors"
                >
                  Load more…
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
