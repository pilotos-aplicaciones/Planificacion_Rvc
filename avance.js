// Pestaña Avance: fecha de corte y registro de avance en línea.
import { $, $$, esc, fmtNum, toast, errorMsg } from "./util.js";

const ESTADOS = { no: "No iniciada", curso: "En curso", term: "Terminada" };
const corta = (iso) => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(2, 4)}` : "");
const fechaCL = (iso) => (iso ? iso.split("-").reverse().join("-") : "");

// Validación del avance de una actividad respecto de la fecha de corte.
export function validarAvance(a, p, corte) {
  const av = a.avance, e = [];
  if (!av || !av.estado || av.estado === "no") return e;
  if (!corte) return ["define la fecha de corte antes de registrar avance"];
  if (!av.inicioReal) e.push("falta el inicio real");
  else if (av.inicioReal > corte) e.push("el inicio real es posterior a la fecha de corte");
  if (av.estado === "term") {
    if (!av.terminoReal) e.push("falta el término real");
    else {
      if (av.terminoReal > corte) e.push("el término real es posterior a la fecha de corte");
      if (av.inicioReal && av.terminoReal < av.inicioReal) e.push("el término real es anterior al inicio real");
    }
  }
  if (av.estado === "curso") {
    if (p?.modo === "fija" && av.pct != null && av.pct !== "" && !(av.pct >= 0 && av.pct < 100)) e.push("el % de avance debe estar entre 0 y 99 (si es 100, márcala terminada)");
    if (p?.modo === "cantidad" && av.ejecutado != null && av.ejecutado !== "" && !(av.ejecutado >= 0 && av.ejecutado < a.cantidad))
      e.push(`la cantidad ejecutada debe estar entre 0 y ${fmtNum(a.cantidad)} (si llegó al total, márcala terminada)`);
  }
  return e;
}

let PEND = new Map();   // cambios sin guardar: id -> avance
let VISTA = "pend";

export function tabAvance(el, api) {
  const S = api.S, ed = api.puedeEditar, corte = S.prog.fechaCorte || "";
  PEND = new Map();
  const desde = S.prog.fechaCorteAnterior || S.prog.fechaInicio;   // rango de los calendarios de fechas reales
  const minDe = (v) => (v && v < desde ? v : desde);
  el.innerHTML = `
    <div class="toolbar">
      <label class="help" style="display:flex;gap:6px;align-items:center">Fecha de corte
        <input type="date" id="av-corte" value="${esc(corte)}" ${ed ? "" : "disabled"}></label>
      ${ed ? `<button id="av-corte-ok" class="btn btn-secondary btn-sm">Guardar fecha de corte</button>` : ""}
      <select id="av-vista">
        <option value="pend" ${VISTA === "pend" ? "selected" : ""}>Por actualizar</option>
        <option value="curso" ${VISTA === "curso" ? "selected" : ""}>En curso</option>
        <option value="term" ${VISTA === "term" ? "selected" : ""}>Terminadas</option>
        <option value="todas" ${VISTA === "todas" ? "selected" : ""}>Todas</option></select>
      <input id="av-texto" placeholder="Buscar por ID o nombre" style="min-width:200px">
      <span class="spacer"></span>
      ${ed ? `<button id="av-guardar" class="btn btn-primary" disabled>Guardar avance</button>` : ""}
    </div>
    <p class="help" style="margin:0 0 10px">${corte
      ? `Avance informado hasta el <strong>${esc(fechaCL(corte))}</strong> inclusive (período desde el ${esc(fechaCL(desde))}); lo pendiente se programa desde el día hábil siguiente. "Por actualizar" muestra lo que debía haber partido al corte y no ha terminado.`
      : `<span class="warn">Define la fecha de corte para registrar avance.</span>`}</p>
    ${api.estadoCalculo()}
    <div class="table-wrap"><table class="av-table">
      <thead><tr><th>ID</th><th>Nombre</th><th>Partida</th><th>Inicio prog.</th><th>Término prog.</th>
        <th>Estado</th><th>Inicio real</th><th>Término real</th><th>Avance</th></tr></thead>
      <tbody id="av-body"></tbody></table></div>`;

  const editable = ed && !!corte;
  // Lo que debía partir al corte: programado hasta el primer día hábil siguiente (incluye lo que el corte empujó).
  const limite = corte ? api.primerDiaTrasCorte() : "";
  const pintar = () => {
    const ft = $("#av-texto").value.trim().toLowerCase(), pos = api.posPartida();
    const lista = api.todas().filter((a) => {
      const est = (PEND.get(a.id) || a.avance)?.estado || "no";
      if (ft && !a.id.toLowerCase().includes(ft) && !(a.nombre || "").toLowerCase().includes(ft)) return false;
      if (PEND.has(a.id)) return true;   // lo que se está editando no desaparece de la vista
      if (VISTA === "curso") return est === "curso";
      if (VISTA === "term") return est === "term";
      if (VISTA === "pend") return est === "curso" || (est === "no" && corte && (!a.calc?.ie || a.calc.ie <= limite));
      return true;
    }).sort((a, b) => (a.calc?.ie || "9").localeCompare(b.calc?.ie || "9") || pos.get(a.partida) - pos.get(b.partida) || a.id.localeCompare(b.id));
    $("#av-body").innerHTML = lista.map((a) => {
      const p = S.partidas.get(a.partida), av = PEND.get(a.id) || a.avance || {}, est = av.estado || "no";
      const dis = editable ? "" : "disabled";
      let avanceCtrl = `<span class="muted">—</span>`;
      if (p?.modo === "fija") avanceCtrl = `<input class="av-pct" type="number" min="0" max="100" step="1" value="${esc(av.pct ?? "")}" ${est === "curso" && editable ? "" : "disabled"} style="width:64px"> %`;
      if (p?.modo === "cantidad") avanceCtrl = `<input class="av-ej" type="number" min="0" step="any" value="${esc(av.ejecutado ?? "")}" ${est === "curso" && editable ? "" : "disabled"} style="width:80px"> / ${fmtNum(a.cantidad)} ${esc(p.unidad)}`;
      return `<tr data-id="${esc(a.id)}" class="${PEND.has(a.id) ? "av-dirty" : ""}">
        <td class="mono">${esc(a.id)}</td><td>${esc(a.nombre)}</td><td>${esc(a.partida)}</td>
        <td class="mono">${esc(corta(a.calc?.ie))}</td><td class="mono">${esc(corta(a.calc?.te))}</td>
        <td><select class="av-est" ${dis}>${Object.entries(ESTADOS).map(([k, v]) => `<option value="${k}" ${k === est ? "selected" : ""}>${v}</option>`).join("")}</select></td>
        <td><input class="av-ir" type="date" value="${esc(av.inicioReal || "")}" ${est !== "no" && editable ? "" : "disabled"} min="${esc(minDe(av.inicioReal))}" max="${esc(corte)}"></td>
        <td><input class="av-tr" type="date" value="${esc(av.terminoReal || "")}" ${est !== "no" && editable ? "" : "disabled"} min="${esc(minDe(av.terminoReal))}" max="${esc(corte)}"></td>
        <td style="white-space:nowrap">${avanceCtrl}</td></tr>`;
    }).join("") || `<tr><td colspan="9" class="muted">No hay actividades en esta vista.</td></tr>`;
    if (!editable) return;
    $$("#av-body tr[data-id]").forEach((tr) => {
      const a = api.todas().find((x) => x.id === tr.dataset.id);
      const leer = () => ({ ...(PEND.get(a.id) || a.avance || {}) });
      const marcar = (av) => { PEND.set(a.id, av); actualizarBotones(); };
      $(".av-est", tr).onchange = (ev) => {
        const av = leer(), est = ev.target.value; av.estado = est;
        if (est === "no") { av.inicioReal = null; av.terminoReal = null; av.pct = null; av.ejecutado = null; }
        // Propone las fechas programadas solo si caen antes del corte; si no, quedan vacías para ingresarlas.
        // Propone fechas programadas (cálculo o, si el corte ya las corrió, línea base activa) solo si caen antes del corte.
        const lb = S.base?.actividades?.[a.id];
        const prop = (f1, f2) => (f1 && f1 <= corte ? f1 : f2 && f2 <= corte ? f2 : null);
        if (est !== "no" && !av.inicioReal) av.inicioReal = prop(a.calc?.ie, lb?.[0]);
        if (est === "term" && !av.terminoReal) { const t = prop(a.calc?.te, lb?.[1]); av.terminoReal = t && (!av.inicioReal || t >= av.inicioReal) ? t : null; }
        if (est !== "term") av.terminoReal = null;
        if (est !== "curso") { av.pct = null; av.ejecutado = null; }
        marcar(av); pintar();
      };
      $(".av-ir", tr).onchange = (ev) => { const av = leer(); av.inicioReal = ev.target.value || null; marcar(av); tr.classList.add("av-dirty"); };
      // Término real: al ingresarlo la actividad queda terminada; al borrarlo vuelve a en curso.
      $(".av-tr", tr).onchange = (ev) => {
        const av = leer(); av.terminoReal = ev.target.value || null;
        if (av.terminoReal) { av.estado = "term"; av.pct = null; av.ejecutado = null; } else if (av.estado === "term") av.estado = "curso";
        marcar(av); pintar();
      };
      // 100 % o cantidad completa: queda terminada con término propuesto en la fecha de corte.
      const terminar = (av) => { av.estado = "term"; av.pct = null; av.ejecutado = null; if (!av.terminoReal) av.terminoReal = corte; marcar(av); pintar(); };
      const pct = $(".av-pct", tr), ej = $(".av-ej", tr);
      if (pct) pct.onchange = () => {
        const av = leer(); av.pct = pct.value === "" ? null : Number(pct.value);
        if (av.pct >= 100) return terminar(av);
        marcar(av); tr.classList.add("av-dirty");
      };
      if (ej) ej.onchange = () => {
        const av = leer(); av.ejecutado = ej.value === "" ? null : Number(ej.value.replace(",", "."));
        if (av.ejecutado >= a.cantidad) return terminar(av);
        marcar(av); tr.classList.add("av-dirty");
      };
    });
  };
  const actualizarBotones = () => { if (!ed) return; $("#av-guardar").disabled = !PEND.size; };
  $("#av-vista").onchange = (e) => { VISTA = e.target.value; pintar(); };
  $("#av-texto").oninput = pintar;
  pintar();
  if (!ed) return;

  $("#av-corte-ok").onclick = async () => {
    const f = $("#av-corte").value || null;
    if (PEND.size && !confirm("Hay avance sin guardar que se perderá al cambiar la fecha de corte. ¿Continuar?")) return;
    try { await api.guardarCorte(f); toast(f ? `Fecha de corte: ${fechaCL(f)}` : "Fecha de corte eliminada"); } catch (e) { toast(errorMsg(e)); }
  };
  const guardar = async () => {
    const errs = [];
    PEND.forEach((av, id) => {
      const a = api.todas().find((x) => x.id === id), p = S.partidas.get(a.partida);
      validarAvance({ ...a, avance: av }, p, corte).forEach((m) => errs.push(`${id}: ${m}`));
    });
    if (errs.length) { toast(`Revisa el avance: ${errs[0]}${errs.length > 1 ? ` (y ${errs.length - 1} más)` : ""}`); return; }
    const conf = conflictos(api, PEND);
    if (conf.length && !(await api.confirmar(`
      <h2>Avance fuera de secuencia</h2>
      <p>Estas fechas reales no respetan relaciones del programa:</p>
      <ul>${conf.slice(0, 15).map((m) => `<li>${esc(m)}</li>`).join("")}${conf.length > 15 ? `<li>… y ${conf.length - 15} más</li>` : ""}</ul>
      <p class="help">Si así ocurrió en obra, puedes guardar igual: el cálculo respeta la lógica para el trabajo pendiente (lógica retenida).</p>
      <div class="modal-actions"><button class="btn btn-secondary" value="cancel" formnovalidate>Revisar</button><button class="btn btn-primary" value="save">Guardar igual</button></div>`))) return;
    try {
      const n = PEND.size;
      await api.guardarAvance(new Map([...PEND].map(([id, av]) => [id, av.estado === "no" ? null : av])));
      PEND = new Map();
      toast(`Avance guardado (${n} actividad(es)). Recuerda calcular el programa.`);
      api.render();
    } catch (e) { toast(errorMsg(e)); }
  };
  $("#av-guardar").onclick = () => guardar();
}

// Relaciones lógicas (FI/II con desfase) que las fechas reales no respetan. Solo se revisan las que tocan actividades editadas.
function conflictos(api, pend) {
  const cal = api.calendario(), Wfin = (f) => cal.W(cal.sumarDia(f));
  const acts = api.todas(), av = (a) => pend.get(a.id) || a.avance || {};
  const porId = new Map(acts.map((a) => [a.id, a])), out = [];
  acts.forEach((s) => (s.predecesoras || []).forEach((r) => {
    const pr = porId.get(r.id); if (!pr) return;
    if (!pend.has(s.id) && !pend.has(pr.id)) return;
    const as = av(s), ap = av(pr), d = Number(r.desfase) || 0;
    if (!as.inicioReal || !as.estado || as.estado === "no") return;
    const txtDes = d ? ` con desfase ${d > 0 ? "+" : ""}${d}` : "";
    if (r.tipo === "SS") {
      if (!ap.inicioReal || ap.estado === "no") out.push(`${s.id} inició el ${fechaCL(as.inicioReal)}, pero su predecesora ${pr.id} (II${txtDes}) no ha iniciado.`);
      else if (cal.W(as.inicioReal) < cal.W(ap.inicioReal) + d) out.push(`${s.id} inició el ${fechaCL(as.inicioReal)}, antes de lo que permite ${pr.id} (II${txtDes}, inició el ${fechaCL(ap.inicioReal)}).`);
    } else {
      if (ap.estado !== "term" || !ap.terminoReal) out.push(`${s.id} inició el ${fechaCL(as.inicioReal)}, pero su predecesora ${pr.id} (FI${txtDes}) no ha terminado.`);
      else if (cal.W(as.inicioReal) < Wfin(ap.terminoReal) + d) out.push(`${s.id} inició el ${fechaCL(as.inicioReal)}, antes de lo que permite ${pr.id} (FI${txtDes}, terminó el ${fechaCL(ap.terminoReal)}).`);
    }
  }));
  return out;
}
