// Validaciones compartidas por la edición manual y la importación.

// Formato texto: ID [FI|II|FS|SS][+n|-n]   ej.: CERA-0001 · TABI-0002 II · HLOS-0003 FI+2 · PINT-0001 II-1
export function parsePredecesoras(txt) {
  const lista = [], errs = [];
  String(txt || "").split(";").map((s) => s.trim()).filter(Boolean).forEach((tok) => {
    const m = tok.match(/^([A-Za-z0-9_]{1,12}-\d{4})\s*(FI|FS|II|SS)?\s*([+-]\s*\d+)?$/i);
    if (!m) errs.push(`la predecesora "${tok}" no tiene un formato válido (ej. CERA-0001, CERA-0001 II o CERA-0001 FI+2)`);
    else lista.push({ id: m[1].toUpperCase(), tipo: /^(II|SS)$/i.test(m[2] || "") ? "SS" : "FS", desfase: m[3] ? Number(m[3].replace(/\s/g, "")) : 0 });
  });
  return { lista, errs };
}
export const predText = (arr) => (arr || []).map((x) => {
  const d = Number(x.desfase) || 0;
  if (x.tipo === "SS") return `${x.id} II${d ? (d > 0 ? "+" : "") + d : ""}`;
  return d ? `${x.id} FI${d > 0 ? "+" : ""}${d}` : x.id;
}).join("; ");

// a: actividad; ids: Set de IDs existentes; partidaDe(id) -> partida o undefined; codigos: definiciones
export function validarActividad(a, ids, partidaDe, codigos) {
  const e = [], p = partidaDe(a.partida);
  if (!a.nombre) e.push("falta el nombre");
  if (!p) { e.push(`la partida ${a.partida || "(vacía)"} no existe`); return e; }
  if (p.modo === "fija" && !(Number.isInteger(a.duracion) && a.duracion > 0)) e.push("la duración debe ser un número entero de días mayor que 0");
  if (p.modo === "cantidad" && !(a.cantidad > 0)) e.push(`falta la cantidad en ${p.unidad} (mayor que 0)`);
  if (p.modo === "ritmo") {
    if (a.duracion !== null && a.duracion !== undefined && !(Number.isInteger(a.duracion) && a.duracion > 0)) e.push("la duración debe ser un número entero de días mayor que 0");
    (p.codigosUnidad || []).forEach((c) => { if (!a.codigos?.[c]) e.push(`falta el código de unidad ${c}`); });
  }
  const vistos = new Set();
  (a.predecesoras || []).forEach((x) => {
    if (x.id === a.id) e.push("no puede ser predecesora de sí misma");
    else if (!ids.has(x.id)) e.push(`la predecesora ${x.id} no existe`);
    if (vistos.has(x.id)) e.push(`la predecesora ${x.id} está repetida`);
    if (!Number.isInteger(Number(x.desfase ?? 0))) e.push(`el desfase con ${x.id} debe ser un número entero de días`);
    vistos.add(x.id);
  });
  if (a.restriccion?.tipo && !a.restriccion.fecha) e.push("falta la fecha de la restricción");
  Object.entries(a.codigos || {}).forEach(([c, v]) => {
    const def = codigos.find((k) => k.codigo === c);
    if (!def) e.push(`el código ${c} no existe`);
    else if (!def.valores.some((x) => x.valor === v)) e.push(`el valor ${v} no existe en el código ${c}`);
  });
  return e;
}

export function buscarCiclo(acts) {
  const succ = new Map(acts.map((a) => [a.id, []]));
  acts.forEach((a) => (a.predecesoras || []).forEach((x) => succ.get(x.id)?.push(a.id)));
  const estado = new Map(), pila = [];
  const dfs = (id) => {
    estado.set(id, 1); pila.push(id);
    for (const s of succ.get(id) || []) {
      if (estado.get(s) === 1) return [...pila.slice(pila.indexOf(s)), s];
      if (!estado.get(s)) { const c = dfs(s); if (c) return c; }
    }
    estado.set(id, 2); pila.pop(); return null;
  };
  for (const a of acts) if (!estado.get(a.id)) { const c = dfs(a.id); if (c) return c; }
  return null;
}
