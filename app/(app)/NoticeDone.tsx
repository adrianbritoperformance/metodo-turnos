'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setNoticeDone, setRuleDone } from './actions';

/** Botón "Hecho" de una tarea: lo puede pulsar quien la recibe o un admin. */
export function NoticeDone({ id, done }: { id: string; done: boolean }) {
  const [value, setValue] = useState(done);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      aria-pressed={value}
      disabled={pending}
      className={value ? 'btn sm' : 'btn ghost sm'}
      style={{ flexShrink: 0 }}
      onClick={() => {
        const next = !value;
        setValue(next);
        start(async () => {
          const r = await setNoticeDone(id, next);
          if (r.error) setValue(!next);
          router.refresh();
        });
      }}
    >
      {value ? '✓ Hecho' : 'Marcar hecho'}
    </button>
  );
}

/** Botón "Hecho" de una tarea que se repite (para un día concreto). */
export function RuleDone({ ruleId, day, done }: { ruleId: string; day: string; done: boolean }) {
  const [value, setValue] = useState(done);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      aria-pressed={value}
      disabled={pending}
      className={value ? 'btn sm' : 'btn ghost sm'}
      style={{ flexShrink: 0 }}
      onClick={() => {
        const next = !value;
        setValue(next);
        start(async () => {
          const r = await setRuleDone(ruleId, day, next);
          if (r.error) setValue(!next);
          router.refresh();
        });
      }}
    >
      {value ? '✓ Hecho' : 'Marcar hecho'}
    </button>
  );
}
