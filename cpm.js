// Motor de cálculo: calendario laboral y camino crítico (CPM).
// Convención: días hábiles numerados desde el inicio del programa (día 0).
// IT = inicio temprano (día), TT = término temprano exclusivo (IT + duración).

const DIA = 86400000;
const toD = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const toISO = (t) => new Date(t).toISOString().slice(0, 10);

export function crearCalendario(fechaInicio, tipo, feriados = []) {
  const fer = new Set(feriados.map((f) => f.fecha || f));
  const laborable = (t) => { const w = new Date(t).getUTCDay(); return w !== 0 && !(w === 6 && tipo !== "LS") && !fer.has(toISO(t)); };
  const t0 = toD(fechaInicio);
  const adelante = [], atras = [];           // adelante[i] = día hábil i (i>=0); atras[i] = día hábil -(i+1)
  const extAdelante = (n) => { let t = adelante.length ? adelante[adelante.length - 1] + DIA : t0; while (adelante.length <= n) { if (laborable(t)) adelante.push(t); t += DIA; } };
  const extAtras = (n) => { let t = atras.length ? atras[atras.length - 1] - DIA : t0 - DIA; while (atras.length <= n) { if (laborable(t)) atras.push(t); t -= DIA; } };
  const fecha = (i) => { if (i >= 0) { extAdelante(i); return toISO(adelante[i]); } extAtras(-i - 1); return toISO(atras[-i - 1]); };
  // W(fecha) = número de días hábiles en [inicio, fecha). Negativo si fecha es anterior al inicio.
  const W = (iso) => {
    const t = toD(iso);
    if (t >= t0) { let i = 0; extAdelante(0); while (true) { extAdelante(i); if (adelante[i] >= t) return i; i++; } }
    let i = 0; while (true) { extAtras(i); if (atras[i] < t) return -i; i++; }
  };
  const sumarDia = (iso) => toISO(toD(iso) + DIA);
  return { fecha, W, sumarDia, laborable: (iso) => laborable(toD(iso)) };
}

export function duracionEfectiva(a, p) {
  if (!p) return null;
  if (p.modo === "fija") return a.duracion ?? null;
  if (p.modo === "ritmo") return p.duracionUnidad || 1;   // la define la partida
  if (!(a.cantidad > 0) || !(p.rendimiento > 0)) return null;
  const d = a.cantidad / p.rendimiento;
  return p.redondeo === "normal" ? Math.max(1, Math.round(d)) : Math.ceil(d - 1e-9);
}

// Relaciones de ritmo: por partida, unidades ordenadas por los códigos de unidad.
export function relacionesRitmo(actividades, partidas, codigos) {
  const orden = {};
  codigos.forEach((c) => { orden[c.codigo] = {}; c.valores.forEach((v, i) => (orden[c.codigo][v.valor] = i)); });
  const rel = [];
  Object.values(partidas).filter((p) => p.modo === "ritmo" && p.ritmo > 0).forEach((p) => {
    const cu = p.codigosUnidad || [];
    const lista = actividades.filter((a) => a.partida === p.id && cu.every((c) => a.codigos?.[c] in (orden[c] || {})));
    lista.sort((a, b) => { for (const c of cu) { const d = orden[c][a.codigos[c]] - orden[c][b.codigos[c]]; if (d) return d; } return a.id.localeCompare(b.id); });
    if (p.direccion === "descendente") lista.reverse();
    const acum = (k) => Math.floor(k / p.ritmo + 1e-9);
    for (let k = 1; k < lista.length; k++)
      rel.push({ de: lista[k - 1].id, a: lista[k].id, tipo: "SS", desfase: acum(k) - acum(k - 1), ritmo: true });
  });
  return rel;
}

// Duración remanente de una actividad en curso (días hábiles, mínimo 1).
export function duracionRemanente(a, p, dur, transcurridos) {
  const av = a.avance || {};
  if (p?.modo === "fija" && av.pct !== null && av.pct !== undefined && av.pct !== "") return Math.max(1, Math.ceil(dur * (1 - Number(av.pct) / 100) - 1e-9));
  if (p?.modo === "cantidad" && av.ejecutado !== null && av.ejecutado !== undefined && av.ejecutado !== "" && p.rendimiento > 0)
    return Math.max(1, Math.ceil((a.cantidad - Number(av.ejecutado)) / p.rendimiento - 1e-9));
  return Math.max(1, dur - transcurridos);
}

export function calcular({ actividades, partidas, codigos, programa, feriados }) {
  const cal = crearCalendario(programa.fechaInicio, programa.calendario, feriados);
  const errores = [];
  const corte = programa.fechaCorte || null;
  const Wfin = (f) => cal.W(cal.sumarDia(f));   // fin exclusivo tras el día f
  const dd = corte ? Wfin(corte) : 0;           // primer día hábil después del corte
  const N = new Map();
  actividades.forEach((a) => {
    const p = partidas[a.partida], dur = duracionEfectiva(a, p);
    if (!(dur >= 1)) errores.push(`${a.id}: no tiene duración válida.`);
    const estado = corte && ["curso", "term"].includes(a.avance?.estado) ? a.avance.estado : "no";
    N.set(a.id, { a, p, dur: dur || 1, estado, pred: [], succ: [] });
  });
  const rels = [];
  actividades.forEach((a) => (a.predecesoras || []).forEach((x) => {
    if (N.has(x.id)) rels.push({ de: x.id, a: a.id, tipo: x.tipo === "SS" ? "SS" : "FS", desfase: Number(x.desfase) || 0 });
    else errores.push(`${a.id}: la predecesora ${x.id} no existe.`);
  }));
  const rRitmo = relacionesRitmo(actividades, partidas, codigos);
  rels.push(...rRitmo);
  rels.forEach((r) => { N.get(r.de).succ.push(r); N.get(r.a).pred.push(r); });

  const grado = new Map([...N.keys()].map((k) => [k, N.get(k).pred.length]));
  const cola = [...N.keys()].filter((k) => !grado.get(k)), orden = [];
  while (cola.length) { const k = cola.shift(); orden.push(k); N.get(k).succ.forEach((r) => { grado.set(r.a, grado.get(r.a) - 1); if (!grado.get(r.a)) cola.push(r.a); }); }
  if (orden.length < N.size) {
    const resto = [...N.keys()].filter((k) => !orden.includes(k));
    errores.push(`Hay un ciclo entre la lógica y el ritmo que involucra a: ${resto.slice(0, 8).join(", ")}${resto.length > 8 ? "…" : ""}. Revisa las predecesoras dentro de partidas por ritmo.`);
  }
  if (errores.length) return { errores };

  // Pasada hacia adelante. esL = inicio "lógico" (real si ya partió) para relaciones II.
  for (const k of orden) {
    const n = N.get(k), r = n.a.restriccion, av = n.a.avance || {};
    if (n.estado === "term") { n.es = n.esL = cal.W(av.inicioReal); n.ef = Wfin(av.terminoReal); n.rem = 0; continue; }
    let es = dd;
    n.pred.forEach((p) => {
      const m = N.get(p.de);
      if (n.estado === "curso" && p.tipo === "SS") return;        // ya partió: la relación II está cumplida
      es = Math.max(es, p.tipo === "SS" ? m.esL + p.desfase : m.ef + p.desfase);
    });
    if (n.estado === "curso") {
      n.esL = cal.W(av.inicioReal);
      n.rem = duracionRemanente(n.a, n.p, n.dur, Math.max(0, dd - n.esL));
    } else {
      if (r?.tipo === "SNET") es = Math.max(es, cal.W(r.fecha));
      if (r?.tipo === "MSO") es = cal.W(r.fecha);
      if (r?.tipo === "MFO") es = Wfin(r.fecha) - n.dur;
      n.esL = es; n.rem = n.dur;
    }
    n.es = es; n.ef = es + n.rem;
  }
  const fin = Math.max(...[...N.values()].map((n) => n.ef));
  // Pasada hacia atrás (las terminadas no participan)
  for (const k of [...orden].reverse()) {
    const n = N.get(k), r = n.a.restriccion;
    if (n.estado === "term") { n.ls = n.es; n.lf = n.ef; continue; }
    let lf = fin;
    n.succ.forEach((s) => {
      const m = N.get(s.a);
      if (m.estado === "term") return;
      if (s.tipo === "SS") { if (n.estado === "curso" || m.estado === "curso") return; lf = Math.min(lf, m.ls - s.desfase + n.rem); }
      else lf = Math.min(lf, m.ls - s.desfase);
    });
    if (r?.tipo === "FNLT") lf = Math.min(lf, Wfin(r.fecha));
    if (r?.tipo === "MFO" && n.estado === "no") lf = Wfin(r.fecha);
    if (r?.tipo === "MSO" && n.estado === "no") lf = cal.W(r.fecha) + n.dur;
    n.lf = lf; n.ls = lf - n.rem;
  }
  // Resultados
  const res = new Map();
  for (const [k, n] of N) {
    const av = n.a.avance || {};
    if (n.estado === "term") {
      res.set(k, { dur: n.dur, rem: 0, estado: "term", ie: av.inicioReal, te: av.terminoReal, it: null, tt: null, ht: null, hl: null, critica: false, es: n.es, ls: n.es });
      continue;
    }
    const ht = n.ls - n.es;
    const sucs = n.succ.filter((s) => N.get(s.a).estado !== "term" && !(s.tipo === "SS" && (n.estado === "curso" || N.get(s.a).estado === "curso")));
    const hl = sucs.length ? Math.min(...sucs.map((s) => { const m = N.get(s.a); return s.tipo === "SS" ? m.es - s.desfase - n.esL : m.es - s.desfase - n.ef; })) : fin - n.ef;
    res.set(k, { dur: n.dur, rem: n.rem, estado: n.estado,
      ie: n.estado === "curso" ? av.inicioReal : cal.fecha(n.es), te: cal.fecha(n.ef - 1),
      ir: n.estado === "curso" ? cal.fecha(n.es) : null,   // inicio del remanente
      it: cal.fecha(n.ls), tt: cal.fecha(n.lf - 1), ht, hl, critica: ht <= 0, es: n.es, ls: n.ls });
  }
  return { errores: [], res, termino: cal.fecha(fin - 1), duracionTotal: fin, relacionesRitmo: rRitmo.length, corte };
}
