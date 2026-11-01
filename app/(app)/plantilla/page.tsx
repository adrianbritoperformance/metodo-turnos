import { redirect } from 'next/navigation';

/** Plantilla ya no existe: el horario se hace en Horario y el contrato se cambia en Bolsa de horas. */
export default function Plantilla() {
  redirect('/horario');
}
