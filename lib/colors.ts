/** Colores para elegir en el perfil: distintos entre sí y legibles sobre crema. */
export const PALETTE = [
  { hex: '#C0392B', name: 'Rojo' },
  { hex: '#E67E22', name: 'Naranja' },
  { hex: '#C9A227', name: 'Mostaza' },
  { hex: '#2E8B57', name: 'Verde' },
  { hex: '#138D90', name: 'Turquesa' },
  { hex: '#2F6FB5', name: 'Azul' },
  { hex: '#7D3C98', name: 'Morado' },
  { hex: '#D35490', name: 'Rosa' },
  { hex: '#8D6E63', name: 'Canela' },
  { hex: '#34495E', name: 'Pizarra' },
];

/** Color de una persona: el suyo (la base de datos ya los reparte sin repetir) o gris si no tiene. */
export function colorOf(color: string | null | undefined, _index?: number) {
  return color ?? '#8A7B70';
}
