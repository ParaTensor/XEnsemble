export function renderDiffLines(raw, { showLineNumbers = false } = {}) {
  if (!raw) return null;
  let oldLine = 0;
  let newLine = 0;
  return raw.split('\n').map((line, i) => {
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted ') || line.startsWith('\\ No newline')) return null;
    if (line[0] === '@') {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      return null;
    }
    const first = line[0];
    if (first === '+') {
      const ln = newLine;
      newLine++;
      if (showLineNumbers) {
        return (
          <div key={i} className="bg-emerald-500/10 text-emerald-300 flex">
            <span className="text-zinc-500 select-none w-10 text-right pr-1.5 shrink-0 border-r border-zinc-800 mr-1.5">{ln}</span>
            <span className="pl-0.5">{line.slice(1)}</span>
          </div>
        );
      }
      return <div key={i} className="bg-emerald-500/10 text-emerald-300 pl-2">{line.slice(1)}</div>;
    }
    if (first === '-') {
      const ln = oldLine;
      oldLine++;
      if (showLineNumbers) {
        return (
          <div key={i} className="bg-red-500/10 text-red-300 flex">
            <span className="text-zinc-500 select-none w-10 text-right pr-1.5 shrink-0 border-r border-zinc-800 mr-1.5">{ln}</span>
            <span className="pl-0.5">{line.slice(1)}</span>
          </div>
        );
      }
      return <div key={i} className="bg-red-500/10 text-red-300 pl-2">{line.slice(1)}</div>;
    }
    const ol = oldLine;
    const nl = newLine;
    oldLine++;
    newLine++;
    if (showLineNumbers) {
      return (
        <div key={i} className="bg-zinc-950 text-zinc-300 flex">
          <span className="text-zinc-500 select-none w-10 text-right pr-1.5 shrink-0 border-r border-zinc-800 mr-1.5">{nl}</span>
          <span className="pl-0.5">{line.slice(1) || ' '}</span>
        </div>
      );
    }
    return <div key={i} className="bg-zinc-950 text-zinc-300 pl-2">{line || ' '}</div>;
  });
}

export function DiffText({ diff, className = '', showLineNumbers = false }) {
  if (!diff) return <span className="text-zinc-400 text-xs">No changes</span>;
  return (
    <div className={`text-[11px] leading-relaxed overflow-x-auto font-mono select-text ${className}`} style={{ tabSize: 4, MozTabSize: 4 }}>
      {renderDiffLines(diff, { showLineNumbers })}
    </div>
  );
}
