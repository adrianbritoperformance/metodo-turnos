'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ic = {
  fichar: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 8h3v3H8zM13 8h3v3h-3zM8 13h3v3H8zM13 13h3v3',
  horas: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  turnos: 'M8 3v3M16 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  reponer: 'M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10',
  admin: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
};

export function Nav({ owner }: { owner: boolean }) {
  const path = usePathname();
  const items: [string, string, keyof typeof ic][] = [
    ['/', 'Fichar', 'fichar'],
    ['/horas', 'Horas', 'horas'],
    ['/turnos', 'Turnos', 'turnos'],
    ['/reponer', 'Reponer', 'reponer'],
  ];
  if (owner) items.push(['/admin', 'Gestión', 'admin']);
  return (
    <nav className="nav" aria-label="Secciones">
      <div className="in">
        {items.map(([href, label, icon]) => {
          const on = href === '/' ? path === '/' : path.startsWith(href);
          return (
            <Link key={href} href={href} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={ic[icon]} />
              </svg>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
