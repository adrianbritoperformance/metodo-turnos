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

/** Color de una persona: el que eligió o, si no, uno por su posición en el equipo. */
export function colorOf(color: string | null | undefined, index: number) {
  return color ?? PALETTE[index % PALETTE.length].hex;
}
