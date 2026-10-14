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
    if (p?.modo === "fija" && av.pct !== null && av.pct !== "" && !(av.pct >= 0 && av.pct < 100)) e.push("el % de avance debe estar entre 0 y 99 (si es 100, márcala terminada)");
    if (p?.modo === "cantidad" && av.ejecutado !== null && av.ejecutado !== "" && !(av.ejecutado >= 0 && av.ejecutado < a.cantidad))
      e.push(`la cantidad ejecutada debe estar entre 0 y ${fmtNum(a.cantidad)} (si llegó al total, márcala terminada)`);
  }
  return e;
}

let PEND = new Map();   // cambios sin guardar: id -> avance
let VISTA = "pend";

export function tabAvance(el, api) {
  const S = api.S, ed = api.puedeEditar, corte = S.prog.fechaCorte || "";
  PEND = new Map();
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
      ${ed ? `<button id="av-guardar" class="btn btn-secondary" disabled>Guardar avance</button>
        <button id="av-guardar-calc" class="btn btn-primary" disabled>Guardar y recalcular</button>` : ""}
    </div>
    <p class="help" style="margin:0 0 10px">${corte
      ? `Avance informado hasta el <strong>${esc(fechaCL(corte))}</strong> inclusive; lo pendiente se programa desde el día hábil siguiente. "Por actualizar" muestra lo que debía haber partido al corte y no ha terminado.`
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
      if (p?.modo === "fija") avanceCtrl = `<input class="av-pct" type="number" min="0" max="99" step="1" value="${esc(av.pct ?? "")}" ${est === "curso" && editable ? "" : "disabled"} style="width:64px"> %`;
      if (p?.modo === "cantidad") avanceCtrl = `<input class="av-ej" type="number" min="0" step="any" value="${esc(av.ejecutado ?? "")}" ${est === "curso" && editable ? "" : "disabled"} style="width:80px"> / ${fmtNum(a.cantidad)} ${esc(p.unidad)}`;
      return `<tr data-id="${esc(a.id)}" class="${PEND.has(a.id) ? "av-dirty" : ""}">
        <td class="mono">${esc(a.id)}</td><td>${esc(a.nombre)}</td><td>${esc(a.partida)}</td>
        <td class="mono">${esc(corta(a.calc?.ie))}</td><td class="mono">${esc(corta(a.calc?.te))}</td>
        <td><select class="av-est" ${dis}>${Object.entries(ESTADOS).map(([k, v]) => `<option value="${k}" ${k === est ? "selected" : ""}>${v}</option>`).join("")}</select></td>
        <td><input class="av-ir" type="date" value="${esc(av.inicioReal || "")}" ${est !== "no" && editable ? "" : "disabled"} max="${esc(corte)}"></td>
        <td><input class="av-tr" type="date" value="${esc(av.terminoReal || "")}" ${est === "term" && editable ? "" : "disabled"} max="${esc(corte)}"></td>
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
        if (est !== "no" && !av.inicioReal) av.inicioReal = a.calc?.ie && a.calc.ie <= corte ? a.calc.ie : null;
        if (est === "term" && !av.terminoReal) av.terminoReal = a.calc?.te && a.calc.te <= corte && (!av.inicioReal || a.calc.te >= av.inicioReal) ? a.calc.te : null;
        if (est !== "term") av.terminoReal = null;
        if (est !== "curso") { av.pct = null; av.ejecutado = null; }
        marcar(av); pintar();
      };
      $(".av-ir", tr).onchange = (ev) => { const av = leer(); av.inicioReal = ev.target.value || null; marcar(av); tr.classList.add("av-dirty"); };
      $(".av-tr", tr).onchange = (ev) => { const av = leer(); av.terminoReal = ev.target.value || null; marcar(av); tr.classList.add("av-dirty"); };
      const pct = $(".av-pct", tr), ej = $(".av-ej", tr);
      if (pct) pct.onchange = () => { const av = leer(); av.pct = pct.value === "" ? null : Number(pct.value); marcar(av); tr.classList.add("av-dirty"); };
      if (ej) ej.onchange = () => { const av = leer(); av.ejecutado = ej.value === "" ? null : Number(ej.value.replace(",", ".")); marcar(av); tr.classList.add("av-dirty"); };
    });
  };
  const actualizarBotones = () => { if (!ed) return; $("#av-guardar").disabled = $("#av-guardar-calc").disabled = !PEND.size; };
  $("#av-vista").onchange = (e) => { VISTA = e.target.value; pintar(); };
  $("#av-texto").oninput = pintar;
  pintar();
  if (!ed) return;

  $("#av-corte-ok").onclick = async () => {
    const f = $("#av-corte").value || null;
    if (PEND.size && !confirm("Hay avance sin guardar que se perderá al cambiar la fecha de corte. ¿Continuar?")) return;
    try { await api.guardarCorte(f); toast(f ? `Fecha de corte: ${fechaCL(f)}` : "Fecha de corte eliminada"); } catch (e) { toast(errorMsg(e)); }
  };
  const guardar = async (recalcular) => {
    const errs = [];
    PEND.forEach((av, id) => {
      const a = api.todas().find((x) => x.id === id), p = S.partidas.get(a.partida);
      validarAvance({ ...a, avance: av }, p, corte).forEach((m) => errs.push(`${id}: ${m}`));
    });
    if (errs.length) { toast(`Revisa el avance: ${errs[0]}${errs.length > 1 ? ` (y ${errs.length - 1} más)` : ""}`); return; }
    try {
      const n = PEND.size;
      await api.guardarAvance(new Map([...PEND].map(([id, av]) => [id, av.estado === "no" ? null : av])));
      PEND = new Map();
      toast(`Avance guardado (${n} actividad(es))`);
      if (recalcular) await api.recalcular(); else api.render();
    } catch (e) { toast(errorMsg(e)); }
  };
  $("#av-guardar").onclick = () => guardar(false);
  $("#av-guardar-calc").onclick = () => guardar(true);
}
