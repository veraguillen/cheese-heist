// log-version.mjs — agrega una versión nueva a CHANGELOG.md
//
// Uso (cada dato entre comillas):
// node scripts/log-version.mjs \
//   --v "v1" \
//   --hipotesis "Si uso distancias BFS reales, el ratón entrega más queso porque elige rutas sin paredes" \
//   --cambio "Mapa de distancias BFS calculado en createBot" \
//   --yo "Elegí calcular las distancias al inicio y no en cada turno" \
//   --ia "Sugirió guardar las distancias en un arreglo plano" \
//   --modelo "Claude Opus 5.5 / High" \
//   --enviado "Mouse and cat now use real BFS distances..."
//
// Agrega una fila a la tabla resumen y una sección completa al final.
// "Resultado" y "Decisión" quedan vacíos para completarlos después de 10 partidas.

import fs from 'node:fs';

const FILE = 'CHANGELOG.md';
const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  if (!argv[i].startsWith('--')) { console.error(`Argumento inesperado: ${argv[i]}`); process.exit(1); }
  args[argv[i].slice(2)] = argv[i + 1] ?? '';
}

const required = ['v', 'hipotesis', 'cambio'];
const missing = required.filter((k) => !args[k]);
if (missing.length) {
  console.error(`Faltan datos obligatorios: ${missing.map((k) => '--' + k).join(', ')}`);
  process.exit(1);
}

const fecha = new Date().toLocaleDateString('es-PY', { day: 'numeric', month: 'short', timeZone: 'America/Asuncion' });
const clean = (s) => String(s ?? '').replace(/\|/g, '/').trim(); // el símbolo | rompe la tabla

let text = fs.readFileSync(FILE, 'utf8');

if (text.includes(`## ${args.v} —`)) {
  console.error(`${args.v} ya existe en ${FILE}. Usa otro número de versión.`);
  process.exit(1);
}

// 1. Fila en la tabla resumen: se inserta después de la última fila de la tabla.
const row = `| ${clean(args.v)} | ${fecha} | ${clean(args.hipotesis)} | ${clean(args.cambio)} | → | |`;
const lines = text.split('\n');
let lastRow = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].startsWith('|')) lastRow = i;
  else if (lastRow !== -1) break; // termina la primera tabla
}
if (lastRow === -1) { console.error('No encontré la tabla resumen en CHANGELOG.md.'); process.exit(1); }
lines.splice(lastRow + 1, 0, row);
text = lines.join('\n');

// 2. Sección detallada al final.
text = text.trimEnd() + `

## ${args.v} — ${fecha}
- **Hipótesis:** ${args.hipotesis}
- **Cambio (uno solo):** ${args.cambio}
- **Por qué (qué vi en los datos):** ${args.porque ?? ''}
- **Decidí yo:** ${args.yo ?? ''}
- **Sugirió la IA:** ${args.ia ?? ''}
- **Modelo / razonamiento:** ${args.modelo ?? ''}
- **Texto enviado en "What changed, and why?":** ${args.enviado ?? ''}
- **Qué observar en 10 partidas:** ${args.observar ?? ''}
- **Resultado (contra Timothy / contra el resto):**
- **Decisión:** mantener / ajustar / revertir
`;

fs.writeFileSync(FILE, text);
console.log(`${args.v} agregada a ${FILE}.`);
