'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import jsQR from 'jsqr';
import { fichar, type FicharResult } from './actions';
import { VoidRecent } from './VoidRecent';
import { fmtMinutes, fmtTime } from '@/lib/time';

/** Botón grande de fichar: abre la cámara, lee el QR del local y registra entrada/salida. */
export function Scanner({ nextKind, autoCode }: { nextKind: 'in' | 'out'; autoCode?: string }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<FicharResult | null>(null);
  const [pending, start] = useTransition();
  const video = useRef<HTMLVideoElement>(null);
  const done = useRef(false);
  const router = useRouter();

  const send = (code: string) => {
    if (done.current) return;
    done.current = true;
    start(async () => {
      const r = await fichar(code);
      setResult(r);
      setOpen(false);
      router.refresh();
    });
  };

  // Llegada desde el QR leído con la cámara del móvil (/fichar?c=...)
  useEffect(() => {
    if (!autoCode) return;
    // Quita el código de la barra de direcciones para que recargar no vuelva a fichar.
    window.history.replaceState(null, '', '/');
    send(autoCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCode]);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        const tick = () => {
          if (v.readyState === v.HAVE_ENOUGH_DATA && ctx) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            ctx.drawImage(v, 0, 0);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const qr = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (qr?.data) { send(qr.data); return; }
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setResult({ ok: false, error: 'No se puede abrir la cámara. Dale permiso en los ajustes del navegador.' });
        setOpen(false);
      }
    })();

    return () => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const label = nextKind === 'in' ? 'ESCANEAR QR · ENTRADA' : 'ESCANEAR QR · SALIDA';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {result?.ok && (
        <div className="card" style={{ border: '2px solid var(--espresso)' }} role="status">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div className="eyebrow">{result.kind === 'in' ? 'Entrada registrada' : 'Salida registrada'}</div>
            <div className="big" style={{ fontSize: 26 }}>{fmtTime(result.at)}</div>
          </div>
          <div style={{ fontSize: 15 }}>
            {result.kind === 'in' && 'Buen turno. Recuerda fichar la salida al terminar.'}
            {result.kind === 'out' && result.extra !== null && (result.extra > 0
              ? <>Has salido {fmtMinutes(result.extra).replace('+', '')} después de tu hora. Se suman a tu bolsa.</>
              : <>Saliste a tu hora: no suma a la bolsa.</>)}
            {result.kind === 'out' && result.extra === null && 'No había turno asignado ahora: la encargada lo verá en el registro.'}
            {result.kind === 'in' && result.shiftEnd === null && ' Ojo: no tenías turno puesto ahora. Si te has equivocado de día, anúlalo.'}
          </div>
          <VoidRecent id={result.id} />
        </div>
      )}
      {result && !result.ok && <div className="alert err" role="alert">{result.error}</div>}

      {open ? (
        <>
          <video ref={video} className="video" playsInline muted />
          <button className="btn ghost" onClick={() => setOpen(false)}>Cancelar</button>
        </>
      ) : (
        <button
          className="btn scan"
          disabled={pending}
          onClick={() => { done.current = false; setResult(null); setOpen(true); }}
        >
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#F1E3B3" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 8h3v3H8zM13 8h3v3h-3zM8 13h3v3H8zM13 13h3v3" />
          </svg>
          {pending ? 'REGISTRANDO…' : label}
        </button>
      )}
    </div>
  );
}
