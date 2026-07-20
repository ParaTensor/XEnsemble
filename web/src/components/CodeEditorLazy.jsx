import { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';

const CodeEditor = lazy(() => import('./CodeEditor'));

export default function CodeEditorLazy(props) {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-full w-full" data-testid="editor-loading">
        <Loader2 className="animate-spin h-6 w-6 text-zinc-400" />
      </div>
    }>
      <CodeEditor {...props} />
    </Suspense>
  );
}