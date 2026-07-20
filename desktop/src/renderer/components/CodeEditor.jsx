import { useCallback, useRef, useState, useEffect } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import { FileWarning, Loader2, Pencil, Save } from 'lucide-react';
import { consoleButtonFocusClass } from '@/lib/consoleTheme';
import { buttonClass } from '@/lib/buttonStyles';

const LANG_MAP = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  css: 'css',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  sh: 'shell',
  bash: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  env: 'plaintext',
  txt: 'plaintext',
  log: 'plaintext',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  vue: 'html',
  svelte: 'html',
  scss: 'scss',
  less: 'less',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
};

function inferLanguage(path) {
  if (!path) return 'plaintext';
  const ext = path.split('.').pop().toLowerCase();
  return LANG_MAP[ext] || 'plaintext';
}

const MEGABYTE = 1024 * 1024;
const LARGE_FILE_THRESHOLD = MEGABYTE;

export default function CodeEditor({ content, path, readOnly: readOnlyProp, isBinary, onSave, onChange, saving }) {
  const [editing, setEditing] = useState(false);
  const editorRef = useRef(null);
  // 用 ref 存储最新 onSave，避免 addCommand 的 stale closure
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  // 切换 tab 时重置编辑状态，回到只读模式
  useEffect(() => { setEditing(false); }, [path]);

  const canEdit = !readOnlyProp && !isBinary;
  const isReadOnly = !editing || !canEdit;

  const handleMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => onSaveRef.current?.()
    );
  }, []);

  const handleKeyDown = useCallback((e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      onSave?.();
    }
  }, [onSave]);

  const language = inferLanguage(path);

  if (isBinary) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-500">
        <FileWarning className="h-10 w-10" />
        <p className="text-sm font-medium">二进制文件</p>
        <p className="text-xs">{path || '此文件无法在编辑器中显示'}</p>
      </div>
    );
  }

  const isLarge = content && content.length > LARGE_FILE_THRESHOLD;

  return (
    <div className="flex flex-col h-full w-full" onKeyDown={handleKeyDown}>
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#E8EAED] bg-[#FAFBFC]">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          {isReadOnly ? <span>只读</span> : <span>编辑中</span>}
          {isLarge && (
            <span className="inline-flex items-center gap-1 text-amber-700">
              <FileWarning className="h-3 w-3" />
              文件较大（{Math.round(content.length / MEGABYTE)} MB），编辑可能卡顿
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {canEdit && isReadOnly && (
            <button
              onClick={() => setEditing(true)}
              className={`inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-md text-[#5B8DB8] hover:bg-[#F4F5F6] transition-colors ${consoleButtonFocusClass}`}
            >
              <Pencil className="h-3 w-3" />
              编辑
            </button>
          )}
          {canEdit && !isReadOnly && (
            <button
              onClick={() => onSave?.()}
              disabled={saving}
              className={buttonClass('primary', 'sm') + ' ' + consoleButtonFocusClass}
            >
              {saving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  保存中…
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5" />
                  保存
                </>
              )}
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          language={language}
          value={content}
          onChange={onChange}
          onMount={handleMount}
          theme="vs"
          loading={
            <div className="flex items-center justify-center h-full gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
              <span className="text-sm text-zinc-400">加载编辑器…</span>
            </div>
          }
          options={{
            readOnly: isReadOnly,
            minimap: { enabled: false },
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            fontSize: 13,
            fontFamily: "'Noto Sans Mono', 'Fira Code', monospace",
            tabSize: 2,
            automaticLayout: true,
            renderLineHighlight: 'all',
            cursorBlinking: 'smooth',
            smoothScrolling: true,
            padding: { top: 12, bottom: 12 },
          }}
        />
      </div>
    </div>
  );
}
