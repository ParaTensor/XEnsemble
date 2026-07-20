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
        <div className="flex-1 min-h-0">
          <DiffEditor
            height="100%"
            language={language}
            original={original}
            modified={modified}
            theme="vs"
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
        </div>
      )}
    </div>
  );
}