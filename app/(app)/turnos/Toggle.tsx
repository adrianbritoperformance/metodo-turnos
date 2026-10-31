'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toggleTemplate } from '../actions';

/** Chip de Mañana / Tarde: un toque pone el turno, otro lo quita. */
export function TemplateToggle({ userId, date, templateId, name, on, custom, compact = false }: {
  userId: string; date: string; templateId: string; name: string; on: boolean; custom?: string; compact?: boolean;
}) {
  const [value, setValue] = useState(on);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const label = value && custom ? custom : name;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <button
        type="button"
        aria-pressed={value}
        aria-label={compact ? `${name}${value ? ' puesto' : ' sin poner'}${custom && value ? ` (${custom})` : ''}` : undefined}
        disabled={pending}
        onClick={() => {
          const next = !value;
          setValue(next);
          setErr(null);
          start(async () => {
            const r = await toggleTemplate(userId, date, templateId, next);
            if (r.error) { setValue(!next); setErr(r.error); }
            router.refresh();
          });
        }}
        style={{
          minHeight: compact ? 40 : 46, width: '100%', borderRadius: compact ? 10 : 12, cursor: 'pointer', fontWeight: 700,
          fontSize: compact ? 12 : 14, padding: compact ? '0 4px' : undefined, whiteSpace: 'nowrap',
          border: value ? '2px solid var(--espresso)' : '2px dashed #B9A28E',
          background: value ? (custom ? 'var(--mantequilla)' : 'var(--espresso)') : 'transparent',
          color: value ? (custom ? 'var(--espresso)' : '#F7EFE4') : 'var(--suave)',
        }}
      >
        {compact ? (value ? label : `+ ${name}`) : <>{value ? '✓ ' : '+ '}{label}</>}
      </button>
      {err && <span className="small" style={{ color: 'var(--terracota)', whiteSpace: 'normal' }}>{err}</span>}
    </div>
  );
}
