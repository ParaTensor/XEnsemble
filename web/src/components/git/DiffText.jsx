export function renderDiffLines(raw) {
  if (!raw) return null;
  return raw.split('\n').map((line, i) => {
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted ') || line.startsWith('\\ No newline')) return null;
    if (line[0] === '@') return null;
    if (line[0] === '+') return <div key={i} className="bg-[#DFF7E4] text-[#1A7F37] pl-2">{line.slice(1)}</div>;
    if (line[0] === '-') return <div key={i} className="bg-[#FFEBE9] text-[#CF222E] pl-2">{line.slice(1)}</div>;
    return <div key={i} className="bg-white text-[#1F2328] pl-2">{line || ' '}</div>;
  });
}

export function DiffText({ diff, className = '' }) {
  if (!diff) return <span className="text-zinc-400 text-xs">No changes</span>;
  return (
    <div className={`text-[11px] leading-relaxed overflow-x-auto font-mono select-text ${className}`} style={{ tabSize: 4, MozTabSize: 4 }}>
      {renderDiffLines(diff)}
    </div>
  );
}
