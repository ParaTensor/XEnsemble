import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../../App';
import { consoleSectionLabelClass } from '../../lib/consoleTheme';
import { getApiBase } from '../../lib/api.ts';

const API = getApiBase();

export default function QuotaSettingsPanel() {
  const { token } = useContext(AuthContext);
  const [me, setMe] = useState(null);

  useEffect(() => {
    if (!token) return;
    fetch(`${API}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => setMe(data));
  }, [token]);

  if (!me?.quotas) {
    return <p className="text-sm text-[#9AA0A6]">Loading quota information…</p>;
  }

  const q = me.quotas;
  const u = q.usage || {};

  const rows = [
    { label: 'Workspaces', used: u.projects ?? 0, max: q.max_projects },
    { label: 'Concurrent sessions', used: u.sessions ?? 0, max: q.max_sessions },
    { label: 'Concurrent previews', used: u.previews ?? 0, max: q.max_previews },
  ];

  return (
    <div className="space-y-3">
      <p className="text-sm text-[#5F6368]">
        Limits set by your administrator.
      </p>
      <div className="space-y-2.5">
        {rows.map(({ label, used, max }) => (
          <div key={label}>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-[#5F6368]">{label}</span>
              <span className="font-mono text-[#202124]">
                {used}
                /
                {max}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-[#E8EAED] overflow-hidden">
              <div
                className="h-full bg-[#202124] rounded-full transition-all"
                style={{ width: `${max > 0 ? Math.min(100, (used / max) * 100) : 0}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <div>
        <span className={consoleSectionLabelClass}>Resource tier</span>
        <p className="text-sm font-medium text-[#202124] mt-1 capitalize">{q.resource_tier || 'basic'}</p>
      </div>
      {me.role !== 'admin' && me.granted_agents_count === 0 && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          No agents are assigned to your account. Ask an administrator to grant access.
        </p>
      )}
    </div>
  );
}
