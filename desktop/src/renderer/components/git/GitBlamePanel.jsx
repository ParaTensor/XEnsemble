import React, { useCallback, useEffect, useState } from 'react';
import { Clock, Eye, Loader2, RefreshCw, User } from 'lucide-react';
import * as gitApi from '../../lib/gitApi.js';
import { useToast } from '../Toast';
import {
  consoleIconButtonClass,
  textPrimary,
  textSecondary,
  textPlaceholder,
  borderHairline,
} from '../../lib/consoleTheme';

function shaToColor(sha) {
  if (!sha) return '#F4F5F6';
  let hash = 0;
  for (let i = 0; i < sha.length; i++) {
    hash = sha.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 40%, 92%)`;
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return isNaN(d.getTime()) ? ts : d.toLocaleDateString();
}

function BlameLine({ entry, prevSha, showGutter }) {
  const isNewBlock = entry.sha !== prevSha;
  const bg = shaToColor(entry.sha);

  return (
    <div className="flex text-xs font-mono leading-5 hover:bg-[#F4F5F6] transition-colors">
      <div
        className="w-40 shrink-0 flex items-center gap-2 px-2 border-r border-[#E8EAED] overflow-hidden"
        style={{ backgroundColor: isNewBlock ? bg : 'transparent' }}
      >
        {isNewBlock ? (
          <>
            <span className="w-14 truncate text-[10px] text-[#5F6368]" title={entry.sha}>
              {entry.sha?.slice(0, 7)}
            </span>
            <span className="flex-1 truncate text-[10px] text-[#202124]" title={entry.author}>
              {entry.author}
            </span>
            <span className="text-[10px] text-[#9AA0A6] shrink-0">
              {formatDate(entry.date)}
            </span>
          </>
        ) : (
          <span className="text-[10px] text-transparent select-none">.</span>
        )}
      </div>
      <div className="w-10 shrink-0 text-right pr-2 text-[#9AA0A6] select-none border-r border-[#E8EAED]">
        {entry.lineNumber}
      </div>
      <div className="flex-1 min-w-0 px-3 whitespace-pre overflow-x-auto text-[#202124]">
        {entry.content}
      </div>
    </div>
  );
}

export default function GitBlamePanel({ projectId, filePath, gitRef }) {
  const { showToast } = useToast();
  const [blameData, setBlameData] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchBlame = useCallback(async () => {
    if (!projectId || !filePath) return;
    setLoading(true);
    try {
      const params = {};
      if (gitRef) params.ref = gitRef;
      const data = await gitApi.getBlame(projectId, filePath, params);
      setBlameData(data.entries || []);
    } catch (err) {
      showToast('error', err.message);
      setBlameData([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, filePath, gitRef, showToast]);

  useEffect(() => {
    fetchBlame();
  }, [fetchBlame]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between border-b border-[#E8EAED] px-4 py-2.5 shrink-0">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-[#5F6368]" />
          <h3 className={`text-sm font-semibold ${textPrimary}`}>Blame</h3>
          <span className="font-mono text-[10px] text-[#5F6368] bg-[#F4F5F6] rounded px-1.5 py-0.5 max-w-[16rem] truncate">
            {filePath}
          </span>
          {gitRef && gitRef !== 'HEAD' && (
            <span className="font-mono text-[10px] text-[#5F6368] bg-[#F4F5F6] rounded px-1.5 py-0.5">
              @{gitRef.slice(0, 7)}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={fetchBlame}
          disabled={loading}
          title="Refresh blame"
          className={consoleIconButtonClass}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-[#5F6368]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading blame…
          </div>
        ) : blameData.length === 0 ? (
          <div className="text-center py-8">
            <Eye className="mx-auto h-8 w-8 text-[#9AA0A6] mb-2" />
            <p className={`text-sm ${textSecondary}`}>
              {filePath ? 'No blame data available.' : 'Select a file to view blame.'}
            </p>
          </div>
        ) : (
          <div className="min-w-max">
            {blameData.map((entry, idx) => (
              <BlameLine
                key={idx}
                entry={entry}
                prevSha={idx > 0 ? blameData[idx - 1].sha : null}
                showGutter
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}