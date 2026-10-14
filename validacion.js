// Validaciones compartidas por la edición manual y la importación.

export function parsePredecesoras(txt) {
  const lista = [], errs = [];
  String(txt || "").split(";").map((s) => s.trim()).filter(Boolean).forEach((tok) => {
    const m = tok.match(/^(\S+?)(?:\s+(FI|FS|II|SS))?$/i);
    if (!m) errs.push(`la predecesora "${tok}" no tiene un formato válido (ej. CERA-0001 o CERA-0001 II)`);
    else lista.push({ id: m[1].toUpperCase(), tipo: /^(II|SS)$/i.test(m[2] || "") ? "SS" : "FS" });
  });
  return { lista, errs };
}
export const predText = (arr) => (arr || []).map((x) => x.id + (x.tipo === "SS" ? " II" : "")).join("; ");

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
