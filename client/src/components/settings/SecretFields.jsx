import React from 'react';
import Input from '../Input';
import { getSecretLabel, isSecretPasswordField } from '../../lib/secretLabels';
import { cn } from '../../lib/utils';

export default function SecretFields({
  keys,
  secrets,
  onChange,
  savedHints = {},
  mono = false,
}) {
  if (keys.length === 0) {
    return <p className="text-sm text-zinc-500">No configuration required.</p>;
  }

  return (
    <div className="space-y-4">
      {keys.map((key) => (
        <div key={key}>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-zinc-900">{getSecretLabel(key)}</label>
            {savedHints[key] && (
              <span className="text-xs text-emerald-600 font-medium">Saved</span>
            )}
          </div>
          <Input
            type={isSecretPasswordField(key) ? 'password' : 'text'}
            className={cn(mono && 'font-mono', 'h-9 py-1.5')}
            value={secrets[key] || ''}
            onChange={(e) => onChange(key, e.target.value)}
            placeholder={
              savedHints[key]
                ? 'Leave unchanged or enter new value'
                : `Enter ${getSecretLabel(key)}`
            }
          />
        </div>
      ))}
    </div>
  );
}
