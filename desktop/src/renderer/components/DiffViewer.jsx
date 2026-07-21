import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, X } from 'lucide-react';
import { DiffEditor } from '@monaco-editor/react';
import { consoleButtonFocusClass } from '@/lib/consoleTheme';

const LANG_MAP = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  json: 'json', css: 'css', html: 'html', md: 'markdown', py: 'python',
  rb: 'ruby', go: 'go', rs: 'rust', java: 'java', c: 'c', cpp: 'cpp',
  sh: 'shell', yml: 'yaml', yaml: 'yaml', toml: 'toml', sql: 'sql',
  scss: 'scss', less: 'less', xml: 'xml', graphql: 'graphql',
};

function inferLanguage(path) {
  if (!path) return 'plaintext';
  const ext = path.split('.').pop().toLowerCase();
  return LANG_MAP[ext] || 'plaintext';
}

export default function DiffViewer({ original, modified, path, loading, onClose }) {
  const displayName = path ? path.split('/').pop() : '';
  const language = inferLanguage(path);
  const [diffReady, setDiffReady] = useState(false);
  const editorRef = useRef(null);

  // Reset diffReady when content changes so the loading overlay shows
  // until Monaco finishes computing the new diff decorations.
  useEffect(() => {
    setDiffReady(false);
  }, [original, modified]);

  const handleMount = useCallback((editor) => {
    editorRef.current = editor;
    // Monaco computes diffs asynchronously. Listen for the completion
    // event so we can hide the loading overlay only after decorations
    // are applied (file text + diff markers appear simultaneously).
    if (editor && typeof editor.onDidUpdateDiff === 'function') {
      editor.onDidUpdateDiff(() => {
        setDiffReady(true);
      });
    } else {
      // Fallback: if the API is unavailable, show immediately.
      setDiffReady(true);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col h-full w-full">
        <div className="flex items-center justify-between px-4 py-2 border-b border-[#E8EAED] bg-[#FAFBFC]">
          <span className="text-sm text-zinc-600">对比：{displayName}</span>
          <button
            aria-label="关闭对比"
            onClick={onClose}
            className={`p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-[#E8EAED] ${consoleButtonFocusClass}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center" data-testid="diff-loading">
          <Loader2 className="animate-spin h-6 w-6 text-zinc-400" />
        </div>
      </div>
    );
  }

  const noDiff = original === modified;
  // Show loading overlay until Monaco's async diff computation completes.
  // This ensures the file text and diff markers (red/green) appear together
  // instead of text first, markers 1-2s later.
  const showOverlay = !noDiff && !diffReady;

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#E8EAED] bg-[#FAFBFC]">
        <span className="text-sm text-zinc-600">对比：{displayName}</span>
        <button
          aria-label="关闭对比"
          onClick={onClose}
          className={`p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-[#E8EAED] ${consoleButtonFocusClass}`}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {noDiff ? (
        <div className="flex-1 flex items-center justify-center text-sm text-zinc-400">
          无差异
        </div>
      ) : (
        <div className="flex-1 min-h-0 relative">
          <DiffEditor
            height="100%"
            language={language}
            original={original}
            modified={modified}
            theme="vs"
            onMount={handleMount}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              fontSize: 13,
              fontFamily: "'Noto Sans Mono', 'Fira Code', monospace",
              automaticLayout: true,
              renderSideBySide: true,
            }}
          />
          {showOverlay && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10" data-testid="diff-computing">
              <Loader2 className="animate-spin h-6 w-6 text-zinc-400" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}