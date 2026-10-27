'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { voidPunch } from './actions';

/** "¿Te has equivocado?": la trabajadora anula su propio fichaje (solo los 10 minutos siguientes). */
export function VoidRecent({ id }: { id: string }) {
  const [step, setStep] = useState<'idle' | 'confirm' | 'done'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (step === 'done') return <div className="alert ok" role="status">Fichaje anulado. No cuenta y queda apuntado en tu historial.</div>;
  if (step === 'idle') {
    return (
      <button type="button" className="small" onClick={() => setStep('confirm')}
        style={{ background: 'none', border: 0, padding: '8px 0', textAlign: 'left', color: 'var(--terracota)', textDecoration: 'underline', cursor: 'pointer', minHeight: 44 }}>
        ¿Te has equivocado? Anular este fichaje
      </button>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 14 }}>Se anula y deja de contar. Queda apuntado que lo has anulado tú.</div>
      <div className="btn-row">
        <button type="button" className="btn ghost sm" onClick={() => setStep('idle')}>No, dejarlo</button>
        <button type="button" className="btn danger sm" disabled={pending} onClick={() => start(async () => {
          const r = await voidPunch(id, '');
          if ('error' in r && r.error) setErr(r.error); else { setStep('done'); router.refresh(); }
        })}>Sí, anular</button>
      </div>
      {err && <div className="alert err" role="alert">{err}</div>}
    </div>
  );
}
