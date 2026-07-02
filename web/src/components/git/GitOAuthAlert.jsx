import { AlertCircle } from 'lucide-react';
import { formatGitOAuthError } from '../../lib/gitLabels';

export default function GitOAuthAlert({ message, provider, className = '' }) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className={`flex gap-2 rounded-md border border-[#FADBD8] bg-[#FDECEA] px-3 py-2.5 text-sm text-[#C06C5D] ${className}`}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
      <p className="min-w-0 leading-relaxed">{formatGitOAuthError(message, provider)}</p>
    </div>
  );
}
