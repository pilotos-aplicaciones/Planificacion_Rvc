// Gantt con layouts: agrupación por partida/códigos, filtros, columnas y opciones de barras.
import { $, $$, esc, MODOS, toast, errorMsg, openModal } from "./util.js";
import { crearCalendario, duracionEfectiva } from "./cpm.js";
import { predText } from "./validacion.js";

const RH = 26, DIA = 86400000;
const BASE_COLS = {
  id: { t: "ID", w: 92 }, nombre: { t: "Nombre", w: 230 }, partida: { t: "Partida", w: 70 },
  dur: { t: "Dur.", w: 44, num: 1 }, ie: { t: "Inicio", w: 72 }, te: { t: "Término", w: 72 },
  ht: { t: "HT", w: 40, num: 1 }, hl: { t: "HL", w: 40, num: 1 }, pred: { t: "Predecesoras", w: 160 },
  bie: { t: "Inicio base", w: 72 }, bte: { t: "Término base", w: 80 }, dvt: { t: "Desv.", w: 48, num: 1 },
};
const ESCALAS = { dia: { t: "Día", ppd: 22 }, semana: { t: "Semana", ppd: 7 }, mes: { t: "Mes", ppd: 2.4 } };
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export const LAYOUT_DEFECTO = {
  id: "defecto", nombre: "Por partida", agrupar: ["partida"], filtros: [], coincidir: "todos",
  columnas: ["id", "nombre", "dur", "ie", "te", "ht", "pred"],
  opciones: { color: "partida", relaciones: true, holgura: true, base: true, escala: "semana", orden: "inicio" },
};

const OPS = {
  texto: [["eq", "es"], ["ne", "no es"], ["has", "contiene"]],
  lista: [["eq", "es"], ["ne", "no es"]],
  num: [["eq", "="], ["ne", "≠"], ["lt", "<"], ["le", "≤"], ["gt", ">"], ["ge", "≥"], ["bt", "entre"]],
  fecha: [["lt", "antes de"], ["ge", "desde"], ["bt", "entre"], ["prox", "inicia en los próximos N días"], ["curso", "en curso hoy"]],
  bool: [["si", "sí"], ["no", "no"]],
};

let G = { layoutId: null, escala: null, colapsados: new Set(), progId: null };
let API = null;

const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const toT = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const toISO = (t) => new Date(t).toISOString().slice(0, 10);
const corta = (iso) => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(2, 4)}` : "");

function campos(S) {
  return [
    { k: "id", t: "ID", tipo: "texto" }, { k: "nombre", t: "Nombre", tipo: "texto" },
    { k: "partida", t: "Partida", tipo: "lista", valores: [...S.partidas.values()].map((p) => [p.id, `${p.id} – ${p.nombre}`]) },
    { k: "modo", t: "Modo de la partida", tipo: "lista", valores: Object.entries(MODOS) },
    ...S.codigos.map((c) => ({ k: "cod:" + c.codigo, t: c.codigo, tipo: "lista", valores: c.valores.map((v) => [v.valor, v.valor + (v.descripcion ? " – " + v.descripcion : "")]) })),
    { k: "dur", t: "Duración", tipo: "num" }, { k: "ht", t: "Holgura total", tipo: "num" }, { k: "hl", t: "Holgura libre", tipo: "num" },
    { k: "ie", t: "Inicio", tipo: "fecha" }, { k: "te", t: "Término", tipo: "fecha" }, { k: "critica", t: "Crítica", tipo: "bool" },
  ];
}
function valorDe(a, k, S) {
  const p = S.partidas.get(a.partida);
  switch (k) {
    case "id": return a.id; case "nombre": return a.nombre || ""; case "partida": return a.partida; case "modo": return p?.modo;
    case "dur": return duracionEfectiva(a, p); case "ht": return a.calc?.ht; case "hl": return a.calc?.hl;
    case "ie": return a.calc?.ie; case "te": return a.calc?.te; case "critica": return !!a.calc?.critica;
  }
  return k.startsWith("cod:") ? a.codigos?.[k.slice(4)] || "" : undefined;
}
function cumple(a, f, S, hoy) {
  const v = valorDe(a, f.campo, S);
  const num = typeof v === "number", cv = (x) => (num ? Number(x) : String(x ?? ""));
  const x = cv(f.valor), y = cv(f.valor2);
  if (["lt", "le", "gt", "ge", "bt"].includes(f.op) && (v === undefined || v === null || v === "")) return false;
  switch (f.op) {
    case "eq": return num ? v === x : String(v ?? "").toLowerCase() === x.toLowerCase();
    case "ne": return num ? v !== x : String(v ?? "").toLowerCase() !== x.toLowerCase();
    case "has": return String(v ?? "").toLowerCase().includes(x.toLowerCase());
    case "lt": return v < x; case "le": return v <= x; case "gt": return v > x; case "ge": return v >= x;
    case "bt": return v >= x && v <= y;
    case "prox": return !!v && v >= hoy && v <= toISO(toT(hoy) + (Number(f.valor) || 0) * DIA);
    case "curso": return !!a.calc && a.calc.ie <= hoy && a.calc.te >= hoy;
    case "si": return v === true; case "no": return v === false;
  }
  return true;
}

function layouts() { return API.S.layouts?.length ? API.S.layouts : [LAYOUT_DEFECTO]; }
function layoutActual() {
  const L = layouts();
  if (!L.some((l) => l.id === G.layoutId)) {
    let guardado = null; try { guardado = localStorage.getItem("gantt-layout:" + API.S.id); } catch {}
    G.layoutId = L.some((l) => l.id === guardado) ? guardado : L[0].id;
  }
  return L.find((l) => l.id === G.layoutId);
}

// ---------- Construcción de filas ----------
function filas(L) {
  const S = API.S, hoy = hoyISO(), pos = API.posPartida();
  const fs = (L.filtros || []).filter((f) => f.campo && f.op);
  const acts = API.todas().filter((a) => !fs.length || (L.coincidir === "alguno" ? fs.some((f) => cumple(a, f, S, hoy)) : fs.every((f) => cumple(a, f, S, hoy))));
  const orden = L.opciones?.orden === "id" ? (a, b) => a.id.localeCompare(b.id)
    : (a, b) => (a.calc?.ie || "9").localeCompare(b.calc?.ie || "9") || a.id.localeCompare(b.id);
  const niveles = (L.agrupar || []).filter(Boolean);
  const out = [];
  const clave = (campo, a) => (campo === "partida" ? a.partida : a.codigos?.[campo.slice(4)] || "");
  const ordenClaves = (campo) => (x, y) => {
    if (x === "") return 1; if (y === "") return -1;
    if (campo === "partida") return (pos.get(x) ?? 1e9) - (pos.get(y) ?? 1e9);
    const vals = S.codigos.find((c) => c.codigo === campo.slice(4))?.valores || [];
    const ix = (v) => { const i = vals.findIndex((z) => z.valor === v); return i < 0 ? 1e9 : i; };
    return ix(x) - ix(y) || x.localeCompare(y);
  };
  const titulo = (campo, k) => {
    if (campo === "partida") { const p = S.partidas.get(k); return p ? `${p.id} – ${p.nombre}` : k; }
    const c = S.codigos.find((z) => z.codigo === campo.slice(4)), v = c?.valores.find((z) => z.valor === k);
    return `${campo.slice(4)}: ${k ? k + (v?.descripcion ? " – " + v.descripcion : "") : "(sin valor)"}`;
  };
  const rec = (lista, nivel, pref) => {
    if (nivel >= niveles.length) { lista.sort(orden).forEach((a) => out.push({ tipo: "act", a, nivel })); return; }
    const campo = niveles[nivel], grupos = new Map();
    lista.forEach((a) => { const k = clave(campo, a); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(a); });
    [...grupos.keys()].sort(ordenClaves(campo)).forEach((k) => {
      const key = pref + "|" + campo + "=" + k, items = grupos.get(k), cs = items.filter((a) => a.calc);
      out.push({ tipo: "grupo", key, nivel, titulo: titulo(campo, k), n: items.length,
        ie: cs.length ? cs.map((a) => a.calc.ie).sort()[0] : null, te: cs.length ? cs.map((a) => a.calc.te).sort().at(-1) : null,
        critica: cs.some((a) => a.calc.critica) });
      if (!G.colapsados.has(key)) rec(items, nivel + 1, key);
    });
  };
  rec(acts, 0, "");
  return { filas: out, total: acts.length };
}

// ---------- Vista ----------
export function tabGantt(el, api) {
  API = api;
  if (G.progId !== api.S.id) G = { layoutId: null, escala: null, colapsados: new Set(), progId: api.S.id };
  const S = api.S, ed = api.puedeLayouts, L = layoutActual();   // layouts: basta el rol de editor, sin candado
  const esc_ = G.escala || L.opciones?.escala || "semana";
  el.innerHTML = `
    <div class="toolbar">
      <label class="help" for="g-layout">Layout</label>
      <select id="g-layout">${layouts().map((l) => `<option value="${esc(l.id)}" ${l.id === L.id ? "selected" : ""}>${esc(l.nombre)}</option>`).join("")}</select>
      ${ed ? `<button id="g-editar" class="btn btn-secondary btn-sm">Editar layout</button>
        <button id="g-nuevo" class="btn btn-secondary btn-sm">Nuevo layout</button>
        ${S.layouts?.length ? `<button id="g-eliminar" class="btn btn-danger btn-sm">Eliminar</button>` : ""}` : ""}
      <span class="spacer"></span>
      <span class="seg">${Object.entries(ESCALAS).map(([k, v]) => `<button class="${k === esc_ ? "on" : ""}" data-escala="${k}">${v.t}</button>`).join("")}</span>
      <button id="g-exp" class="btn btn-secondary btn-sm">Expandir</button>
      <button id="g-con" class="btn btn-secondary btn-sm">Contraer</button>
    </div>
    ${api.estadoCalculo()}
    <p class="help" id="g-info" style="margin:0 0 6px"></p>
    <div class="gantt-scroll" id="g-scroll"></div>`;
  $("#g-layout").onchange = (e) => { G.layoutId = e.target.value; G.escala = null; G.colapsados.clear(); try { localStorage.setItem("gantt-layout:" + S.id, G.layoutId); } catch {} tabGantt(el, api); };
  $$(".seg button", el).forEach((b) => (b.onclick = () => { G.escala = b.dataset.escala; tabGantt(el, api); }));
  $("#g-exp").onclick = () => { G.colapsados.clear(); tabGantt(el, api); };
  $("#g-con").onclick = () => { filas({ ...L, agrupar: L.agrupar }).filas.filter((f) => f.tipo === "grupo" && f.nivel === 0).forEach((f) => G.colapsados.add(f.key)); tabGantt(el, api); };
  if (ed) {
    $("#g-editar").onclick = () => editarLayout(L, false, el);
    $("#g-nuevo").onclick = () => editarLayout({ ...structuredClone(LAYOUT_DEFECTO), id: null, nombre: "" }, true, el);
    if (S.layouts?.length) $("#g-eliminar").onclick = async () => {
      if (!confirm(`¿Eliminar el layout "${L.nombre}"?`)) return;
      try { await api.guardarLayouts(S.layouts.filter((l) => l.id !== L.id)); G.layoutId = null; toast("Layout eliminado"); tabGantt(el, api); } catch (e) { toast(errorMsg(e)); }
    };
  }
  dibujar(L, esc_);
}

// Contenido de una celda de la tabla izquierda (HTML escapado).
function celdaAct(col, a, cal) {
  const S = API.S, c = a.calc, p = S.partidas.get(a.partida), lb = S.base?.actividades?.[a.id];
  switch (col.k) {
    case "id": return esc(a.id); case "nombre": return esc(a.nombre); case "partida": return esc(a.partida);
    case "dur": return duracionEfectiva(a, p) ?? ""; case "ie": return corta(c?.ie); case "te": return corta(c?.te);
    case "ht": return c?.ht ?? ""; case "hl": return c?.hl ?? "";
    case "bie": return corta(lb?.[0]); case "bte": return corta(lb?.[1]);
    case "dvt": { if (!lb || !c) return ""; const dv = cal.W(c.te) - cal.W(lb[1]); return dv > 0 ? `<span class="warn">+${dv}</span>` : dv; }
    case "pred": return esc(predText(a.predecesoras));
  }
  return esc(a.codigos?.[col.k.slice(4)] || "");
}

// v0.18: ancho máximo por columna al ajustar al contenido (lo más largo se corta y se ve completo con el mouse).
const ANCHO_MAX = { nombre: 340, pred: 260 }, ANCHO_MAX_DEF = 200;

// Ajusta cada columna de la tabla izquierda al contenido real medido en pantalla (fuente real del navegador).
function ajustarAnchos(grid, cols) {
  const filas = [$(".g-hl", grid), ...$$(".g-act", grid)], w = cols.map(() => 0);
  filas.forEach((r) => [...r.children].forEach((sp, j) => { if (j < w.length) w[j] = Math.max(w[j], sp.scrollWidth); }));   // solo lecturas
  const fin = w.map((x, j) => Math.max(cols[j].num ? 36 : 44, Math.min(x + 2, (ANCHO_MAX[cols[j].k] || ANCHO_MAX_DEF) + (j === 0 ? 60 : 0))));
  fin.forEach((x, j) => grid.style.setProperty(`--gw${j}`, x + "px"));                                                 // luego escrituras
  grid.style.setProperty("--glw", Math.max(160, fin.reduce((a, b) => a + b, 0)) + "px");
}

function dibujar(L, escala) {
  const S = API.S, { filas: F, total } = filas(L), ppd = ESCALAS[escala].ppd, op = L.opciones || {};
  const cols = (L.columnas || []).map((k) => k.startsWith("cod:") ? { k, t: k.slice(4), w: 70 } : { k, ...BASE_COLS[k] }).filter((c) => c.t);
  const conCalc = API.todas().filter((a) => a.calc);
  $("#g-info").textContent = `${total} actividad(es) mostradas de ${API.todas().length}.` + (conCalc.length ? "" : " Calcula el programa para ver las barras.")
    + (S.base ? ` Línea base activa: ${S.base.nombre}.` : "");
  if (!F.length) { $("#g-scroll").innerHTML = `<div class="empty" style="margin:12px"><strong>Ninguna actividad cumple los filtros del layout</strong></div>`; return; }

  const fechas = conCalc.flatMap((a) => [a.calc.ie, a.calc.tt || a.calc.te]).sort();
  const t0 = (fechas.length ? toT(fechas[0]) : toT(hoyISO())) - 3 * DIA;
  const t1 = (fechas.length ? toT(fechas.at(-1)) : toT(hoyISO()) + 30 * DIA) + 10 * DIA;
  const nd = Math.round((t1 - t0) / DIA) + 1, TW = Math.ceil(nd * ppd), H = F.length * RH, HH = 44;
  const X = (iso) => ((toT(iso) - t0) / DIA) * ppd;
  const cal = crearCalendario(S.prog.fechaInicio, S.prog.calendario, S.feriados);
  const LW = Math.max(160, cols.reduce((s, c) => s + c.w, 0));

  // Encabezado de la escala
  let head = "", fondo = "";
  for (let i = 0; i < nd; i++) {
    const t = t0 + i * DIA, d = new Date(t), x = i * ppd, iso = toISO(t);
    if (d.getUTCDate() === 1 || i === 0) {
      head += `<line x1="${x}" y1="0" x2="${x}" y2="${HH}" class="g-tick"/><text x="${x + 4}" y="15" class="g-mes">${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}</text>`;
      if (escala === "mes") fondo += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" class="g-vline"/>`;
    }
    if (escala !== "mes" && !cal.laborable(iso)) fondo += `<rect x="${x}" y="0" width="${ppd}" height="${H}" class="g-nolab"/>`;
    if (escala === "dia") head += `<text x="${x + ppd / 2}" y="37" class="g-dia" text-anchor="middle">${d.getUTCDate()}</text>`;
    if (escala === "semana" && d.getUTCDay() === 1) {
      head += `<line x1="${x}" y1="22" x2="${x}" y2="${HH}" class="g-tick"/><text x="${x + 3}" y="37" class="g-dia">${String(d.getUTCDate()).padStart(2, "0")}</text>`;
      fondo += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" class="g-vline"/>`;
    }
  }
  const hoy = hoyISO(), corte = S.prog.fechaCorte;
  if (toT(hoy) >= t0 && toT(hoy) <= t1) fondo += `<line x1="${X(hoy)}" y1="0" x2="${X(hoy)}" y2="${H}" class="g-hoy"/>`;
  if (corte && toT(corte) >= t0 && toT(corte) <= t1) {
    fondo += `<line x1="${X(corte) + ppd}" y1="0" x2="${X(corte) + ppd}" y2="${H}" class="g-corte"/>`;
    head += `<text x="${X(corte) + ppd + 3}" y="${HH - 3}" class="g-corte-t">corte</text>`;
  }

  // Filas
  let izq = "", barras = "", relaciones = "";
  const filaDe = new Map(), calcDe = new Map(API.todas().map((a) => [a.id, a.calc]));
  F.forEach((f, i) => { if (f.tipo === "act") filaDe.set(f.a.id, i); });
  F.forEach((f, i) => {
    const y = i * RH, mid = y + RH / 2;
    if (f.tipo === "grupo") {
      const abierto = !G.colapsados.has(f.key);
      izq += `<div class="g-row g-grp" data-key="${esc(f.key)}" style="padding-left:${8 + f.nivel * 14}px"><span class="g-caret">${abierto ? "▾" : "▸"}</span>${esc(f.titulo)} <span class="muted">(${f.n})</span></div>`;
      barras += `<rect x="0" y="${y}" width="${TW}" height="${RH}" class="g-grp-bg"/>`;
      if (f.ie) {
        const x1 = X(f.ie), x2 = X(f.te) + ppd;
        barras += `<path d="M${x1} ${mid - 4}H${x2}V${mid + 4}L${x2 - 5} ${mid}H${x1 + 5}L${x1} ${mid + 4}Z" class="g-sum ${f.critica ? "crit" : ""}"><title>${esc(f.titulo)}\n${corta(f.ie)} a ${corta(f.te)}</title></path>`;
      }
      return;
    }
    const a = f.a, c = a.calc, p = S.partidas.get(a.partida), lb = S.base?.actividades?.[a.id];
    const celda = (col) => celdaAct(col, a, cal);
    izq += `<div class="g-row g-act ${c?.critica ? "crit" : ""} ${API.puedeEditar ? "link" : ""}" data-id="${esc(a.id)}">${cols.map((col, j) =>
      `<span class="${col.num ? "num" : ""}" style="width:var(--gw${j}, ${col.w}px);${j === 0 ? `padding-left:${8 + f.nivel * 14}px` : ""}" title="${col.k === "pred" || col.k === "nombre" ? celda(col) : ""}">${celda(col)}</span>`).join("")}</div>`;
    if (op.base && lb) barras += `<rect x="${X(lb[0])}" y="${y + RH - 6}" width="${Math.max(2, X(lb[1]) + ppd - X(lb[0]))}" height="3" class="g-base"><title>Línea base: ${corta(lb[0])} a ${corta(lb[1])}</title></rect>`;
    if (!c) return;
    const x1 = X(c.ie), x2 = X(c.te) + ppd;
    const color = c.estado === "term" ? "#A3ADB8" : c.critica ? "var(--critical)" : (op.color === "uniforme" ? "var(--plan)" : (p?.color || "#808080"));
    if (op.holgura && c.ht > 0 && c.tt) {
      const xf = X(c.tt) + ppd;
      barras += `<line x1="${x2}" y1="${mid}" x2="${xf}" y2="${mid}" class="g-float"/><line x1="${xf}" y1="${mid - 4}" x2="${xf}" y2="${mid + 4}" class="g-float"/>`;
    }
    barras += `<rect x="${x1}" y="${y + 7}" width="${Math.max(2, x2 - x1)}" height="${RH - 14}" rx="2" fill="${color}" class="g-bar" data-id="${esc(a.id)}"><title>${esc(a.id)} ${esc(a.nombre)}\n${corta(c.ie)} a ${corta(c.te)}${c.estado === "term" ? "  ·  terminada" : `  ·  HT ${c.ht}`}${c.estado === "curso" ? "  ·  en curso" : ""}</title></rect>`;
    if (c.estado === "curso" && corte) {
      const xc = Math.min(X(corte) + ppd, x2);
      if (xc > x1) barras += `<rect x="${x1}" y="${y + 10}" width="${xc - x1}" height="${RH - 20}" class="g-prog" pointer-events="none"/>`;
    }
    if (op.relaciones) (a.predecesoras || []).forEach((r) => {
      const j = filaDe.get(r.id), pc = calcDe.get(r.id);
      if (j === undefined || !pc) return;
      const y1 = j * RH + RH / 2, crit = pc.critica && c.critica;
      const xs = r.tipo === "SS" ? X(pc.ie) : X(pc.te) + ppd;
      const xm = r.tipo === "SS" ? xs - 6 : xs + 6;
      relaciones += `<path d="M${xs} ${y1}H${xm}V${mid}H${x1 - 1}" class="g-rel ${crit ? "crit" : ""}" marker-end="url(#g-flecha${crit ? "-c" : ""})"/>`;
    });
  });

  $("#g-scroll").innerHTML = `
    <div class="g-grid" style="grid-template-columns:var(--glw, ${LW}px) ${TW}px">
      <div class="g-hl" style="height:${HH}px">${cols.map((c, j) => `<span class="${c.num ? "num" : ""}" style="width:var(--gw${j}, ${c.w}px)">${esc(c.t)}</span>`).join("")}</div>
      <div class="g-hr"><svg width="${TW}" height="${HH}">${head}</svg></div>
      <div class="g-bl">${izq}</div>
      <div class="g-br"><svg width="${TW}" height="${H}">
        <defs><marker id="g-flecha" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L6 3L0 6Z" fill="#8A96A3"/></marker>
          <marker id="g-flecha-c" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L6 3L0 6Z" fill="var(--critical)"/></marker></defs>
        ${fondo}${barras}${relaciones}</svg></div>
    </div>`;
  ajustarAnchos($(".g-grid", $("#g-scroll")), cols);
  $$(".g-grp", $("#g-scroll")).forEach((r) => (r.onclick = () => { G.colapsados.has(r.dataset.key) ? G.colapsados.delete(r.dataset.key) : G.colapsados.add(r.dataset.key); dibujar(L, escala); }));
  if (API.puedeEditar) $$(".g-act, .g-bar", $("#g-scroll")).forEach((r) => (r.onclick = () => {
    const a = API.todas().find((z) => z.id === r.dataset.id); if (a) API.abrirActividad(a);
  }));
  // Desplazar al inicio de las barras o a hoy
  const sc = $("#g-scroll"), xh = X(hoy);
  if (xh > 0 && xh < TW) sc.scrollLeft = Math.max(0, xh - 200);
}

// ---------- Editor de layout ----------
function editarLayout(L0, nuevo, el) {
  const S = API.S, L = structuredClone(L0), C = campos(S);
  const opAgr = (sel) => `<option value="">Sin agrupar</option><option value="partida" ${sel === "partida" ? "selected" : ""}>Partida</option>` +
    S.codigos.map((c) => `<option value="cod:${esc(c.codigo)}" ${sel === "cod:" + c.codigo ? "selected" : ""}>${esc(c.codigo)}</option>`).join("");
  const todasCols = [...Object.entries(BASE_COLS).map(([k, v]) => [k, v.t]), ...S.codigos.map((c) => ["cod:" + c.codigo, c.codigo])];
  const o = L.opciones || {};
  openModal(`
    <h2>${nuevo ? "Nuevo layout" : "Editar layout"}</h2>
    <label>Nombre<input name="nombre" maxlength="50" value="${esc(L.nombre)}" placeholder="Ej. Terminaciones por piso"></label>
    <fieldset><legend>Agrupar por</legend><div class="grid2">
      ${[0, 1, 2].map((i) => `<label>Nivel ${i + 1}<select name="agr${i}">${opAgr(L.agrupar?.[i])}</select></label>`).join("")}</div></fieldset>
    <fieldset><legend>Filtros</legend>
      <label style="display:flex;gap:8px;align-items:center;font-weight:400">Mostrar actividades que cumplan
        <select name="coincidir" style="width:auto"><option value="todos">todas las condiciones</option><option value="alguno" ${L.coincidir === "alguno" ? "selected" : ""}>alguna condición</option></select></label>
      <div class="table-wrap"><table class="pred-table"><tbody id="flt-body"></tbody></table></div>
      <div><button type="button" class="btn btn-secondary btn-sm" id="btn-add-flt">+ Agregar filtro</button></div>
    </fieldset>
    <fieldset><legend>Columnas</legend><div class="chk-grid">
      ${todasCols.map(([k, t]) => `<label><input type="checkbox" name="col" value="${esc(k)}" ${L.columnas?.includes(k) ? "checked" : ""}> ${esc(t)}</label>`).join("")}</div></fieldset>
    <fieldset><legend>Barras</legend><div class="grid2">
      <label>Color<select name="color"><option value="partida">Color de la partida</option><option value="uniforme" ${o.color === "uniforme" ? "selected" : ""}>Uniforme (azul)</option></select><span class="help">Las críticas siempre en rojo.</span></label>
      <label>Escala por defecto<select name="escala">${Object.entries(ESCALAS).map(([k, v]) => `<option value="${k}" ${o.escala === k ? "selected" : ""}>${v.t}</option>`).join("")}</select></label>
      <label>Orden dentro del grupo<select name="orden"><option value="inicio">Por inicio</option><option value="id" ${o.orden === "id" ? "selected" : ""}>Por ID</option></select></label>
      <div class="chk-grid" style="align-self:end"><label><input type="checkbox" name="relaciones" ${o.relaciones ? "checked" : ""}> Relaciones</label>
        <label><input type="checkbox" name="holgura" ${o.holgura ? "checked" : ""}> Holgura total</label>
        <label><input type="checkbox" name="base" ${o.base ? "checked" : ""}> Línea base</label></div>
    </div></fieldset>
    <p class="msg-error" hidden></p>
    <div class="modal-actions"><button class="btn btn-secondary" value="cancel" formnovalidate>Cancelar</button><button class="btn btn-primary" value="save">Guardar layout</button></div>`,
    async (fd, form) => {
      const nombre = String(fd.get("nombre")).trim();
      if (!nombre) throw new Error("Falta el nombre del layout.");
      const filtros = $$("#flt-body tr", form).map((tr) => ({
        campo: $(".f-campo", tr).value, op: $(".f-op", tr).value,
        valor: $(".f-v1", tr)?.value ?? "", valor2: $(".f-v2", tr)?.value ?? "",
      })).filter((f) => f.campo && f.op);
      const columnas = todasCols.map(([k]) => k).filter((k) => fd.getAll("col").includes(k));
      if (!columnas.length) throw new Error("Elige al menos una columna.");
      const nuevoL = {
        id: L.id && L.id !== "defecto" ? L.id : "L" + Date.now().toString(36), nombre,
        agrupar: [0, 1, 2].map((i) => fd.get("agr" + i)).filter(Boolean), filtros, coincidir: fd.get("coincidir"), columnas,
        opciones: { color: fd.get("color"), escala: fd.get("escala"), orden: fd.get("orden"), relaciones: fd.get("relaciones") === "on", holgura: fd.get("holgura") === "on", base: fd.get("base") === "on" },
      };
      const lista = [...(S.layouts || [])];
      const i = lista.findIndex((l) => l.id === nuevoL.id);
      if (i >= 0) lista[i] = nuevoL; else lista.push(nuevoL);
      await API.guardarLayouts(lista);
      G.layoutId = nuevoL.id; G.escala = null; G.colapsados.clear();
      try { localStorage.setItem("gantt-layout:" + S.id, G.layoutId); } catch {}
      toast("Layout guardado"); tabGantt(el, API);
    },
    (form) => {
      const fila = (f = { campo: "", op: "", valor: "", valor2: "" }) => {
        const tr = document.createElement("tr");
        const pintar = () => {
          const c = C.find((z) => z.k === $(".f-campo", tr).value);
          const opSel = $(".f-op", tr)?.value || f.op;
          const ops = c ? OPS[c.tipo] : [];
          const op = ops.some(([k]) => k === opSel) ? opSel : ops[0]?.[0];
          const ctrl = (cls, val) => {
            if (!c || ["curso", "si", "no"].includes(op)) return "";
            if (op === "prox") return `<input class="${cls}" type="number" min="0" step="1" value="${esc(val || 7)}" style="width:80px"> días`;
            if (c.tipo === "lista") return `<select class="${cls}">${c.valores.map(([k, t]) => `<option value="${esc(k)}" ${k === val ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
            return `<input class="${cls}" type="${c.tipo === "fecha" ? "date" : c.tipo === "num" ? "number" : "text"}" value="${esc(val)}">`;
          };
          $(".f-opc", tr).innerHTML = `<select class="f-op">${ops.map(([k, t]) => `<option value="${k}" ${k === op ? "selected" : ""}>${t}</option>`).join("")}</select>`;
          $(".f-val", tr).innerHTML = ctrl("f-v1", $(".f-v1", tr)?.value ?? f.valor) + (op === "bt" ? ` y ${ctrl("f-v2", $(".f-v2", tr)?.value ?? f.valor2)}` : "");
          $(".f-op", tr).onchange = pintar;
        };
        tr.innerHTML = `<td><select class="f-campo"><option value="">Campo…</option>${C.map((c) => `<option value="${esc(c.k)}" ${c.k === f.campo ? "selected" : ""}>${esc(c.t)}</option>`).join("")}</select></td>
          <td class="f-opc"></td><td class="f-val"></td><td style="width:40px"><button type="button" class="icon-btn f-del" aria-label="Quitar">✕</button></td>`;
        $("#flt-body", form).appendChild(tr);
        $(".f-campo", tr).onchange = () => { f = { ...f, op: "", valor: "", valor2: "" }; $(".f-val", tr).innerHTML = ""; $(".f-opc", tr).innerHTML = ""; pintar(); };
        pintar();
      };
      (L.filtros || []).forEach((f) => fila(f));
      $("#btn-add-flt", form).onclick = () => fila();
      $("#flt-body", form).onclick = (ev) => { if (ev.target.closest(".f-del")) ev.target.closest("tr").remove(); };
    });
}
