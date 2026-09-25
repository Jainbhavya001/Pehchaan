import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { Checkpoint } from '../types';

export const CheckpointSelector: React.FC = () => {
  const { user, selectCheckpoint, token, isAdmin } = useAuth();
  const { t } = useI18n();
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    fetch('/api/checkpoints', {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then(res => res.ok ? res.json() : [])
      .then(setCheckpoints)
      .catch(() => setCheckpoints([]))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0c1017] flex items-center justify-center">
        <div className="text-[#8a94a6] text-sm">Loading checkpoints...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0c1017] flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-xl font-bold text-white">{t('checkpoint.title')}</h1>
          <p className="text-sm text-[#8a94a6] mt-1">{t('checkpoint.subtitle')}</p>
          <p className="text-xs text-[#5a677d] mt-1">
            {user?.name} — {t(`role.${user?.role?.toLowerCase()}`)}
          </p>
        </div>

        <div className="space-y-3">
          {isAdmin && (
            <button
              onClick={() => selectCheckpoint({ id: 'GLOBAL', name: 'Global Scope' })}
              className="w-full bg-[#141b28] border border-[#1b2230] hover:border-[#2563eb] rounded-xl p-4 text-left transition-all cursor-pointer group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-lg bg-[#1e3a5f] flex items-center justify-center">
                    <span className="material-symbols-outlined text-[22px] text-[#60a5fa]">public</span>
                  </span>
                  <div>
                    <div className="text-sm font-bold text-white group-hover:text-[#60a5fa]">
                      {t('checkpoint.global')}
                    </div>
                    <div className="text-xs text-[#5a677d]">Access all checkpoints and analytics</div>
                  </div>
                </div>
                <span className="material-symbols-outlined text-[#5a677d] group-hover:text-[#60a5fa]">arrow_forward</span>
              </div>
            </button>
          )}

          {checkpoints.map((cp) => (
            <button
              key={cp.id}
              onClick={() => selectCheckpoint(cp)}
              className="w-full bg-[#141b28] border border-[#1b2230] hover:border-[#2563eb] rounded-xl p-4 text-left transition-all cursor-pointer group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-lg bg-[#182133] flex items-center justify-center">
                    <span className="material-symbols-outlined text-[22px] text-[#94a3b8]">location_on</span>
                  </span>
                  <div>
                    <div className="text-sm font-bold text-white group-hover:text-[#60a5fa]">{cp.name}</div>
                    {cp.location && <div className="text-xs text-[#5a677d]">{cp.location}</div>}
                    {cp.type && <div className="text-[10px] text-[#3e4a5c] font-mono">{cp.type}</div>}
                  </div>
                </div>
                <span className="material-symbols-outlined text-[#5a677d] group-hover:text-[#60a5fa]">arrow_forward</span>
              </div>
            </button>
          ))}

          {checkpoints.length === 0 && !isAdmin && (
            <div className="text-center py-8">
              <span className="material-symbols-outlined text-[48px] text-[#3e4a5c]">location_off</span>
              <p className="text-sm text-[#8a94a6] mt-3">{t('checkpoint.none')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
