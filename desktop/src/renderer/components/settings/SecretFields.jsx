import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import Input from '../Input';
import { getSecretLabel, getSecretPlaceholder, isSecretPasswordField } from '../../lib/secretLabels';
import { cn } from '../../lib/utils';

export default function SecretFields({
  keys,
  secrets,
  onChange,
  savedHints = {},
  missingKeys = [],
  mono = false,
}) {
  const [editingKeys, setEditingKeys] = useState(() => new Set());

  if (keys.length === 0) {
    return <p className="text-sm text-[#5F6368]">No configuration required.</p>;
  }

  return (
    <div className="space-y-4">
      {keys.map((key) => {
        const saved = Boolean(savedHints[key]);
        const required = missingKeys.includes(key);
        const editing = editingKeys.has(key) || !saved || Boolean(secrets[key]?.trim());
        return (
          <div key={key}>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-[#202124]">{getSecretLabel(key)}</label>
              {required && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-[#C06C5D]">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  Required
                </span>
              )}
            </div>
            {saved && !editing ? (
              <div className="flex items-center justify-between gap-2 h-9 px-3 border border-[#E8EAED] rounded-md bg-[#F4F5F6]">
                <span className="text-sm text-[#5F6368]">Saved</span>
                <button
                  type="button"
                  onClick={() => setEditingKeys((prev) => new Set(prev).add(key))}
                  className="text-xs font-medium text-[#5F6368] hover:text-[#202124]"
                >
                  Change
                </button>
              </div>
            ) : (
              <Input
                type={isSecretPasswordField(key) ? 'password' : 'text'}
                className={cn(mono && 'font-mono', 'h-9 py-1.5')}
                value={secrets[key] || ''}
                onChange={(e) => onChange(key, e.target.value)}
                placeholder={getSecretPlaceholder(key)}
                autoFocus={saved && editingKeys.has(key)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
