import React, { useCallback, useEffect, useState } from 'react';
import { Eye, Loader2, RefreshCw, User, FolderOpen, Search } from 'lucide-react';
import * as gitApi from '../../lib/gitApi';
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
        className="w-56 shrink-0 flex items-center gap-2 px-2 border-r border-[#E8EAED] overflow-hidden"
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
            <span className="text-[10px] text-[#9AA0A6]">
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

      <div className="flex-1 px-3 whitespace-pre overflow-x-auto text-[#202124]">
        {entry.content}
      </div>
    </div>
  );
}

export default function GitBlamePanel({ projectId }) {
  const { showToast } = useToast();
  const [blameData, setBlameData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [files, setFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [fileSearch, setFileSearch] = useState('');
  const [showFilePicker, setShowFilePicker] = useState(false);

  const fetchFiles = useCallback(async () => {
    if (!projectId) return;
    setLoadingFiles(true);
    try {
      const data = await gitApi.listTrackedFiles(projectId);
      setFiles(data.files || []);
    } catch (err) {
      showToast('error', err.message);
      setFiles([]);
    } finally {
      setLoadingFiles(false);
    }
  }, [projectId, showToast]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const fetchBlame = useCallback(async () => {
    if (!projectId || !selectedFile) return;
    setLoading(true);
    try {
      const data = await gitApi.getBlame(projectId, selectedFile, {});
      setBlameData(data.entries || []);
    } catch (err) {
      showToast('error', err.message);
      setBlameData([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, selectedFile, showToast]);

  useEffect(() => {
    fetchBlame();
  }, [fetchBlame]);

  const filteredFiles = fileSearch
    ? files.filter((f) => f.toLowerCase().includes(fileSearch.toLowerCase()))
    : files;

  const groupedFiles = React.useMemo(() => {
    const groups = {};
    filteredFiles.forEach((f) => {
      const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '(root)';
      if (!groups[dir]) groups[dir] = [];
      groups[dir].push(f);
    });
    return groups;
  }, [filteredFiles]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between border-b border-[#E8EAED] px-4 py-2.5 shrink-0">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-[#5F6368]" />
          <h3 className={`text-sm font-semibold ${textPrimary}`}>Blame</h3>
          {selectedFile && (
            <span className="font-mono text-[10px] text-[#5F6368] bg-[#F4F5F6] rounded px-1.5 py-0.5 max-w-[16rem] truncate">
              {selectedFile}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowFilePicker((v) => !v)}
            title="选择文件"
            className={consoleIconButtonClass}
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={fetchBlame}
            disabled={loading || !selectedFile}
            title="刷新"
            className={consoleIconButtonClass}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {showFilePicker && (
        <div className="border-b border-[#E8EAED] shrink-0">
          <div className="px-3 py-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[#9AA0A6]" />
              <input
                type="text"
                placeholder="搜索文件..."
                value={fileSearch}
                onChange={(e) => setFileSearch(e.target.value)}
                autoFocus={showFilePicker}
                className="w-full pl-7 pr-2 py-1 text-xs rounded border border-[#DADCE0] bg-white focus:outline-none focus:border-[#5B8DB8]"
              />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {loadingFiles ? (
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-[#5F6368]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                加载文件列表…
              </div>
            ) : Object.keys(groupedFiles).sort().map((dir) => (
              <div key={dir}>
                {dir !== '(root)' && (
                  <div className="px-3 py-1 text-[10px] font-semibold text-[#5F6368] uppercase tracking-wider bg-[#FAFAFA]">
                    {dir}
                  </div>
                )}
                {groupedFiles[dir].map((f) => (
                  <button
                    key={f}
                    onClick={() => {
                      setSelectedFile(f);
                      setShowFilePicker(false);
                      setFileSearch('');
                    }}
                    className={`w-full text-left px-6 py-1 text-xs truncate hover:bg-[#F4F5F6] transition-colors ${
                      selectedFile === f ? 'text-[#202124] bg-[#E8EAED]' : 'text-[#202124]'
                    }`}
                  >
                    <span className="font-mono">{dir === '(root)' ? f : f.slice(dir.length + 1)}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        {!selectedFile ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-zinc-400">
            <FolderOpen className="h-10 w-10" />
            <p className={`text-sm ${textSecondary}`}>选择一个文件查看 Blame</p>
            <button
              onClick={() => { fetchFiles(); setShowFilePicker(true); }}
              className={`text-xs ${textPlaceholder} hover:${textPrimary} transition-colors underline underline-offset-2`}
            >
              点击浏览文件列表
            </button>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-[#5F6368]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading blame…
          </div>
        ) : blameData.length === 0 ? (
          <div className="text-center py-8">
            <Eye className="mx-auto h-8 w-8 text-[#9AA0A6] mb-2" />
            <p className={`text-sm ${textSecondary}`}>No blame data available.</p>
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