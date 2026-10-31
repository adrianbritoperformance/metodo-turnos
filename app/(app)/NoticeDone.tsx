'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setNoticeDone } from './actions';

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
