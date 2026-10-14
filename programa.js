// Detalle de un programa: resumen y miembros, códigos, partidas y actividades.
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, writeBatch }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { $, $$, esc, ROLES, CALENDARIOS, MODOS, RESTRICCIONES, fmtNum, toast, errorMsg, openModal } from "./util.js";
import { calcular, duracionEfectiva, crearCalendario, relacionesRitmo } from "./cpm.js";
import { parsePredecesoras, predText, validarActividad, buscarCiclo } from "./validacion.js";
import { leerExcel } from "./importar.js";
import { tabGantt } from "./gantt.js";

let S = null;   // estado del programa abierto
let CTX = null;

export function resetPrograma() { S = null; }

export async function viewPrograma(ctx, id, tab) {
  CTX = ctx;
  const main = $("#main");
  if (!S || S.id !== id) {
    main.innerHTML = `<a href="#programas" class="back">‹ Programas</a><p>Cargando…</p>`;
    try { S = await cargar(id); }
    catch (e) { main.lastElementChild.outerHTML = `<p class="msg-error">${esc(errorMsg(e))}</p>`; return; }
    if (!S) { main.lastElementChild.outerHTML = `<p class="msg-error">El programa no existe o fue eliminado.</p>`; return; }
  }
  S.tab = ["resumen", "codigos", "partidas", "actividades", "gantt"].includes(tab) ? tab : "resumen";
  render();
}

// ---------- Datos ----------
const refProg = (id) => doc(CTX.db, "programas", id);
const refDef = () => doc(CTX.db, "programas", S.id, "definiciones", "actual");
const refPart = (pid) => doc(CTX.db, "programas", S.id, "partidas", pid);

async function cargar(id) {
  const { db, me } = CTX;
  const pSnap = await getDoc(refProg(id));
  if (!pSnap.exists()) return null;
  const prog = pSnap.data();
  const [dSnap, parts] = await Promise.all([
    getDoc(doc(db, "programas", id, "definiciones", "actual")),
    getDocs(collection(db, "programas", id, "partidas")),
  ]);
  const partidas = ordenadas(parts.docs.map((d) => [d.id, { actividades: [], ...d.data(), id: d.id }]));
  return {
    id, prog, partidas, tab: "resumen",
    codigos: dSnap.exists() ? dSnap.data().codigos || [] : [],
    feriados: dSnap.exists() ? dSnap.data().feriados || [] : [],
    layouts: dSnap.exists() ? dSnap.data().layouts || [] : [],
    usuarios: me.admin ? await CTX.loadUsuarios() : [],
    puedeEditar: me.admin || prog.miembros?.[me.uid] === "editor",
  };
}

// Partidas en su orden de secuencia (campo orden; las antiguas sin orden van al final por ID)
function ordenadas(entradas) {
  return new Map(entradas.sort((a, b) => (a[1].orden ?? 1e9) - (b[1].orden ?? 1e9) || a[0].localeCompare(b[0])));
}
const posPartida = () => new Map([...S.partidas.keys()].map((k, i) => [k, i]));
const todas = () => [...S.partidas.values()].flatMap((p) => p.actividades.map((a) => ({ ...a, partida: p.id })));
const fechaCL = (iso) => (iso ? iso.split("-").reverse().join("-") : "");
const fechaCorta = (iso) => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(2, 4)}` : "");

// Firma de los datos que afectan el cálculo: si cambia, el cálculo guardado está desactualizado.
function firma() {
  const datos = JSON.stringify({
    f: S.prog.fechaInicio, c: S.prog.calendario, fer: S.feriados.map((x) => x.fecha).sort(),
    cod: S.codigos.map((c) => [c.codigo, c.valores.map((v) => v.valor)]),
    p: [...S.partidas.values()].map((p) => [p.id, p.modo, p.rendimiento, p.redondeo, p.ritmo, p.codigosUnidad, p.direccion, p.modo === "ritmo" ? p.duracionUnidad || 1 : null]).sort(),
    a: todas().map((a) => JSON.stringify([a.id, a.partida, a.cantidad, a.duracion,
      (a.predecesoras || []).map((x) => [x.id, x.tipo, Number(x.desfase) || 0]),
      a.restriccion, Object.entries(a.codigos || {}).sort()])).sort(),
  });
  let h = 5381; for (let i = 0; i < datos.length; i++) h = ((h << 5) + h + datos.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}


// ---------- Estructura de la vista ----------
function render() {
  const p = S.prog, me = CTX.me, miRol = p.miembros?.[me.uid];
  const nAct = todas().length;
  const tabs = [["resumen", "Resumen", ""], ["codigos", "Códigos", S.codigos.length],
    ["partidas", "Partidas", S.partidas.size], ["actividades", "Actividades", nAct], ["gantt", "Gantt", ""]];
  $("#main").innerHTML = `
    <a href="#programas" class="back">‹ Programas</a>
    <div class="page-head">
      <div><h1>${esc(p.nombre)}</h1><p>${esc(p.proyecto)}, ${esc(p.etapa)}</p></div>
      <div class="toolbar" style="margin:0">
        <span class="badge ${miRol ? "badge-" + miRol : "badge-lector"}">${miRol ? ROLES[miRol] : "Administrador"}</span>
        ${S.puedeEditar ? `<button id="btn-importar" class="btn btn-secondary btn-sm">Importar desde Excel</button>` : ""}
        <button id="btn-exportar" class="btn btn-secondary btn-sm">Exportar a Excel</button>
        <button id="btn-recargar" class="btn btn-secondary btn-sm">Recargar</button>
      </div>
    </div>
    <nav class="tabs">${tabs.map(([k, t, n]) =>
      `<a class="tab ${S.tab === k ? "active" : ""}" href="#programa/${esc(S.id)}/${k}">${t}${n !== "" ? `<span class="count">${n}</span>` : ""}</a>`).join("")}</nav>
    <div id="tab"></div>`;
  $("#btn-exportar").onclick = exportarExcel;
  if (S.puedeEditar) $("#btn-importar").onclick = importarExcel;
  $("#btn-recargar").onclick = () => { const t = S.tab; S = null; viewPrograma(CTX, location.hash.split("/")[1], t); };
  ({ resumen: tabResumen, codigos: tabCodigos, partidas: tabPartidas, actividades: tabActividades, gantt: (el) => tabGantt(el, apiGantt()) })[S.tab]($("#tab"));
}

// ---------- Resumen y miembros ----------
function tabResumen(el) {
  const p = S.prog, me = CTX.me;
  const nombreDe = (uid) => S.usuarios.find((u) => u.uid === uid) || { nombre: uid, email: "" };
  const filas = Object.entries(p.miembros || {}).map(([uid, rol]) => {
    const u = nombreDe(uid);
    const ctrl = me.admin
      ? `<select data-uid="${esc(uid)}" class="sel-rol">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === rol ? "selected" : ""}>${v}</option>`).join("")}</select>
         <button class="btn btn-danger btn-sm btn-quitar" data-uid="${esc(uid)}">Quitar</button>`
      : `<span class="badge badge-${rol}">${ROLES[rol]}</span>`;
    return `<tr><td>${esc(u.nombre)}</td><td>${esc(u.email)}</td><td>${ctrl}</td></tr>`;
  }).join("");
  const disponibles = S.usuarios.filter((u) => !p.miembros?.[u.uid]);
  const ed = S.puedeEditar;
  el.innerHTML = `
    ${ed ? `<div class="toolbar"><span class="spacer"></span><button id="btn-editar-datos" class="btn btn-secondary btn-sm">Editar datos del programa</button></div>` : ""}
    <dl class="meta">
      <div><dt>Fecha de inicio</dt><dd>${esc(fechaCL(p.fechaInicio))}</dd></div>
      <div><dt>Calendario</dt><dd>${esc(CALENDARIOS[p.calendario] || p.calendario)}</dd></div>
      <div><dt>Estado</dt><dd><span class="badge badge-ok">${esc(p.estado)}</span></dd></div>
      <div><dt>Programa tipo</dt><dd>${p.programaTipo ? esc(p.programaTipo.nombre) : "Sin asignar"}</dd></div>
    </dl>
    <h2>Feriados</h2>
    <p class="help">Días no laborables del programa, además de los domingos${p.calendario === "LS" ? "" : " y sábados"}.</p>
    <div class="table-wrap" style="max-width:560px"><table><thead><tr><th>Fecha</th><th>Feriado</th>${ed ? "<th></th>" : ""}</tr></thead>
      <tbody>${S.feriados.map((f, i) => `<tr><td class="mono">${esc(fechaCL(f.fecha))}</td><td>${esc(f.nombre)}</td>${ed ? `<td><button class="icon-btn del-fer" data-i="${i}" aria-label="Eliminar">✕</button></td>` : ""}</tr>`).join("")
        || `<tr><td colspan="3" class="muted">Sin feriados.</td></tr>`}</tbody></table></div>
    ${ed ? `<div class="add-row" style="max-width:560px"><input type="date" id="fer-fecha" style="flex:0 0 160px"><input id="fer-nombre" placeholder="Nombre (ej. Glorias Navales)" maxlength="60">
      <button id="btn-add-fer" class="btn btn-secondary">Agregar feriado</button></div>
      <p class="help">Referenciales: verificar con la fuente oficial antes de usar en un programa real.</p>` : ""}
    <h2 style="margin-top:28px">Miembros</h2>
    <div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Email</th><th>Rol</th></tr></thead><tbody>${filas || `<tr><td colspan="3">Sin miembros.</td></tr>`}</tbody></table></div>
    ${me.admin ? `<div class="row-actions">
        <select id="nuevo-miembro"><option value="">Agregar usuario…</option>${disponibles.map((u) => `<option value="${esc(u.uid)}">${esc(u.nombre)} (${esc(u.email)})</option>`).join("")}</select>
        <select id="nuevo-rol">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        <button id="btn-agregar" class="btn btn-primary">Agregar</button></div>
      <p class="help">¿No aparece la persona? Debe ingresar una vez a la app con su cuenta Google para quedar registrada.</p>
      <div class="row-actions" style="margin-top:32px"><button id="btn-eliminar" class="btn btn-danger">Eliminar programa</button></div>` : ""}`;
  if (ed) {
    const guardarFer = async (lista) => { lista.sort((a, b) => a.fecha.localeCompare(b.fecha)); await setDoc(refDef(), { feriados: lista }, { merge: true }); S.feriados = lista; render(); };
    $("#btn-add-fer").onclick = async () => {
      const fecha = $("#fer-fecha").value, nombre = $("#fer-nombre").value.trim();
      if (!fecha) return toast("Elige la fecha del feriado");
      if (S.feriados.some((f) => f.fecha === fecha)) return toast("Esa fecha ya está en la lista");
      try { await guardarFer([...S.feriados, { fecha, nombre: nombre || "Feriado" }]); toast("Feriado agregado"); } catch (e) { toast(errorMsg(e)); }
    };
    $$(".del-fer", el).forEach((b) => (b.onclick = async () => {
      const l = [...S.feriados]; l.splice(+b.dataset.i, 1);
      try { await guardarFer(l); toast("Feriado eliminado"); } catch (e) { toast(errorMsg(e)); }
    }));
    $("#btn-editar-datos").onclick = () => openModal(`
      <h2>Datos del programa</h2>
      <div class="grid2">
        <label>Proyecto RVC<input name="proyecto" maxlength="80" value="${esc(p.proyecto)}"></label>
        <label>Etapa<input name="etapa" maxlength="40" value="${esc(p.etapa)}"></label>
      </div>
      <label>Nombre del programa<input name="nombre" maxlength="80" value="${esc(p.nombre)}"></label>
      <div class="grid2">
        <label>Fecha de inicio<input name="fechaInicio" type="date" value="${esc(p.fechaInicio)}"></label>
        <label>Calendario<select name="calendario">${Object.entries(CALENDARIOS).map(([k, v]) => `<option value="${k}" ${k === p.calendario ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      </div>
      <p class="msg-error" hidden></p>
      <div class="modal-actions"><button class="btn btn-secondary" value="cancel" formnovalidate>Cancelar</button><button class="btn btn-primary">Guardar</button></div>`,
      async (fd) => {
        const d = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v).trim()]));
        if (!d.proyecto || !d.etapa || !d.nombre || !d.fechaInicio) throw new Error("Completa proyecto, etapa, nombre y fecha de inicio.");
        await updateDoc(refProg(S.id), d); Object.assign(S.prog, d); render(); toast("Datos guardados");
      });
  }
  if (!me.admin) return;

  const guardarMiembros = async (miembros) => {
    await updateDoc(refProg(S.id), { miembros, miembrosUids: Object.keys(miembros) });
    S.prog.miembros = miembros; render();
  };
  $$(".sel-rol", el).forEach((s) => (s.onchange = async () => {
    try { await guardarMiembros({ ...p.miembros, [s.dataset.uid]: s.value }); toast("Rol actualizado"); } catch (e) { toast(errorMsg(e)); }
  }));
  $$(".btn-quitar", el).forEach((b) => (b.onclick = async () => {
    if (!confirm(`¿Quitar a ${nombreDe(b.dataset.uid).nombre} de este programa?`)) return;
    const m = { ...p.miembros }; delete m[b.dataset.uid];
    try { await guardarMiembros(m); toast("Miembro quitado"); } catch (e) { toast(errorMsg(e)); }
  }));
  $("#btn-agregar").onclick = async () => {
    const uid = $("#nuevo-miembro").value; if (!uid) return toast("Elige un usuario");
    try { await guardarMiembros({ ...p.miembros, [uid]: $("#nuevo-rol").value }); toast("Miembro agregado"); } catch (e) { toast(errorMsg(e)); }
  };
  $("#btn-eliminar").onclick = async () => {
    const txt = prompt(`Esta acción no se puede deshacer: borra el programa con todas sus partidas y actividades.\nEscribe el nombre del programa para eliminarlo:\n${p.nombre}`);
    if (txt !== p.nombre) { if (txt !== null) toast("El nombre no coincide; no se eliminó"); return; }
    try {
      const batch = writeBatch(CTX.db);
      for (const sub of ["partidas", "definiciones", "control"]) {
        (await getDocs(collection(CTX.db, "programas", S.id, sub))).docs.forEach((d) => batch.delete(d.ref));
      }
      batch.delete(refProg(S.id));
      await batch.commit();
      S = null; toast("Programa eliminado"); location.hash = "programas";
    } catch (e) { toast(errorMsg(e)); }
  };
}

// ---------- Códigos ----------
function usoCodigo(c) {
  return { acts: todas().filter((a) => a.codigos?.[c]).length,
    parts: [...S.partidas.values()].filter((p) => p.codigosUnidad?.includes(c)).map((p) => p.id) };
}
async function guardarCodigos(nuevos) {
  nuevos.forEach((c) => c.valores.forEach((v, i) => (v.orden = i + 1)));
  await setDoc(refDef(), { codigos: nuevos }, { merge: true });
  S.codigos = nuevos; render();
}

function tabCodigos(el) {
  const ed = S.puedeEditar;
  el.innerHTML = `
    <div class="toolbar"><p class="muted" style="margin:0">Clasificaciones de las actividades. El orden de los valores define el orden de avance en las partidas por ritmo.</p>
      <span class="spacer"></span>${ed ? `<button id="btn-nuevo-codigo" class="btn btn-primary">+ Nuevo código</button>` : ""}</div>
    ${S.codigos.length ? "" : `<div class="empty"><strong>Aún no hay códigos</strong>Crea códigos como Frente, Piso o Depto para clasificar las actividades.</div>`}
    ${S.codigos.map((c, ci) => `
      <section class="code-block">
        <header><div><h3 style="margin:0">${esc(c.codigo)} <span class="muted" style="font-weight:400">(${c.valores.length} valores)</span></h3>
            <p class="${c.descripcion ? "muted" : "warn"}" style="margin:2px 0 0">${c.descripcion ? esc(c.descripcion) : "Sin descripción"}</p></div>
          ${ed ? `<div class="toolbar" style="margin:0"><button class="btn btn-secondary btn-sm edit-desc" data-ci="${ci}">Editar descripción</button>
            <button class="btn btn-danger btn-sm del-codigo" data-ci="${ci}">Eliminar código</button></div>` : ""}</header>
        <div class="table-wrap"><table>
          <thead><tr><th class="num" style="width:50px">Orden</th><th>Valor</th><th>Descripción</th>${ed ? "<th style='width:130px'></th>" : ""}</tr></thead>
          <tbody>${c.valores.map((v, vi) => `<tr><td class="num">${vi + 1}</td><td class="mono">${esc(v.valor)}</td><td>${esc(v.descripcion)}</td>
            ${ed ? `<td><button class="icon-btn mv" data-ci="${ci}" data-vi="${vi}" data-d="-1" ${vi === 0 ? "disabled" : ""} aria-label="Subir">↑</button>
              <button class="icon-btn mv" data-ci="${ci}" data-vi="${vi}" data-d="1" ${vi === c.valores.length - 1 ? "disabled" : ""} aria-label="Bajar">↓</button>
              <button class="icon-btn del-valor" data-ci="${ci}" data-vi="${vi}" aria-label="Eliminar">✕</button></td>` : ""}</tr>`).join("")
            || `<tr><td colspan="4" class="muted">Sin valores.</td></tr>`}</tbody></table></div>
        ${ed ? `<div class="add-row"><input placeholder="Valor (ej. 501)" maxlength="20" class="nv-valor" data-ci="${ci}">
          <input placeholder="Descripción (opcional)" maxlength="60" class="nv-desc" data-ci="${ci}">
          <button class="btn btn-secondary add-valor" data-ci="${ci}">Agregar valor</button></div>` : ""}
      </section>`).join("")}`;
  if (!ed) return;
  const copia = () => structuredClone(S.codigos);
  const run = async (fn, msg) => { try { await fn(); if (msg) toast(msg); } catch (e) { toast(errorMsg(e)); } };

  $("#btn-nuevo-codigo").onclick = () => openModal(`
    <h2>Nuevo código</h2>
    <label>Código<input name="codigo" maxlength="30" placeholder="Ej. Piso"><span class="help">Nombre corto: letras, números y espacios. No se puede cambiar después.</span></label>
    <label>Descripción<input name="descripcion" maxlength="100" placeholder="Ej. Piso del edificio donde se ejecuta la actividad"><span class="help">Para qué sirve el código. Se puede editar después.</span></label>
    <p class="msg-error" hidden></p>
    <div class="modal-actions"><button class="btn btn-secondary" value="cancel" formnovalidate>Cancelar</button><button class="btn btn-primary">Crear código</button></div>`,
    async (fd) => {
      const n = String(fd.get("codigo")).trim(), desc = String(fd.get("descripcion")).trim(), errs = [];
      if (!/^[\p{L}\p{N} _]{1,30}$/u.test(n)) errs.push("El código debe tener entre 1 y 30 letras, números o espacios.");
      if (S.codigos.some((c) => c.codigo.toLowerCase() === n.toLowerCase())) errs.push(`Ya existe el código "${n}".`);
      if (!desc) errs.push("Falta la descripción.");
      if (errs.length) throw new Error(errs.join("\n"));
      await guardarCodigos([...copia(), { codigo: n, descripcion: desc, valores: [] }]); toast("Código creado");
    });
  $$(".add-valor", el).forEach((b) => (b.onclick = () => run(async () => {
    const ci = +b.dataset.ci, inV = $(`.nv-valor[data-ci="${ci}"]`, el), inD = $(`.nv-desc[data-ci="${ci}"]`, el);
    const valor = inV.value.trim();
    if (!valor) throw new Error("Escribe el valor.");
    if (S.codigos[ci].valores.some((v) => v.valor === valor)) throw new Error(`El valor "${valor}" ya existe en ${S.codigos[ci].codigo}.`);
    const c = copia(); c[ci].valores.push({ valor, descripcion: inD.value.trim(), orden: 0 });
    await guardarCodigos(c);
    $(`.nv-valor[data-ci="${ci}"]`)?.focus();
  }, "Valor agregado")));
  $$(".nv-valor, .nv-desc", el).forEach((i) => (i.onkeydown = (e) => { if (e.key === "Enter") $(`.add-valor[data-ci="${i.dataset.ci}"]`, el).click(); }));
  $$(".mv", el).forEach((b) => (b.onclick = () => run(async () => {
    const c = copia(), v = c[+b.dataset.ci].valores, i = +b.dataset.vi, j = i + +b.dataset.d;
    [v[i], v[j]] = [v[j], v[i]]; await guardarCodigos(c);
  })));
  $$(".del-valor", el).forEach((b) => (b.onclick = () => run(async () => {
    const ci = +b.dataset.ci, vi = +b.dataset.vi, cod = S.codigos[ci].codigo, val = S.codigos[ci].valores[vi].valor;
    const n = todas().filter((a) => a.codigos?.[cod] === val).length;
    if (n) throw new Error(`No se puede eliminar: ${n} actividad(es) usan ${cod} = ${val}.`);
    const c = copia(); c[ci].valores.splice(vi, 1); await guardarCodigos(c);
  }, "Valor eliminado")));
  $$(".edit-desc", el).forEach((b) => (b.onclick = () => {
    const ci = +b.dataset.ci, c0 = S.codigos[ci];
    openModal(`
      <h2>Descripción de ${esc(c0.codigo)}</h2>
      <label>Descripción<input name="descripcion" maxlength="100" value="${esc(c0.descripcion || "")}"></label>
      <p class="msg-error" hidden></p>
      <div class="modal-actions"><button class="btn btn-secondary" value="cancel" formnovalidate>Cancelar</button><button class="btn btn-primary">Guardar</button></div>`,
      async (fd) => {
        const desc = String(fd.get("descripcion")).trim();
        if (!desc) throw new Error("Falta la descripción.");
        const c = copia(); c[ci].descripcion = desc; await guardarCodigos(c); toast("Descripción guardada");
      });
  }));
  $$(".del-codigo", el).forEach((b) => (b.onclick = () => run(async () => {
    const ci = +b.dataset.ci, cod = S.codigos[ci].codigo, u = usoCodigo(cod);
    if (u.acts) throw new Error(`No se puede eliminar: ${u.acts} actividad(es) usan el código ${cod}.`);
    if (u.parts.length) throw new Error(`No se puede eliminar: lo usan como código de unidad las partidas ${u.parts.join(", ")}.`);
    if (!confirm(`¿Eliminar el código ${cod} y sus valores?`)) return;
    const c = copia(); c.splice(ci, 1); await guardarCodigos(c); toast("Código eliminado");
  })));
}

// ---------- Partidas ----------
function parametro(p) {
  if (p.modo === "cantidad") return `${fmtNum(p.rendimiento)} ${esc(p.unidad)}/día`;
  if (p.modo === "ritmo") return `${fmtNum(p.ritmo)} unid/día, ${p.duracionUnidad || 1} día(s)/unid`;
  return "—";
}
function tabPartidas(el) {
  const ed = S.puedeEditar, parts = [...S.partidas.values()];
  el.innerHTML = `
    <div class="toolbar"><p class="muted" style="margin:0">Cada actividad pertenece a una partida, que define cómo se calcula su duración.</p>
      <span class="spacer"></span>${ed ? `<button id="btn-nueva-partida" class="btn btn-primary">+ Nueva partida</button>` : ""}</div>
    ${parts.length ? `<div class="table-wrap"><table>
      <thead><tr>${ed ? `<th style="width:76px">Orden</th>` : ""}<th>ID</th><th>Nombre</th><th>Modo</th><th>Parámetro</th><th>Códigos de unidad</th><th class="num">Actividades</th></tr></thead>
      <tbody>${parts.map((p, i) => `<tr class="${ed ? "link" : ""}" data-id="${esc(p.id)}">
        ${ed ? `<td><button class="icon-btn mv-part" data-i="${i}" data-d="-1" ${i === 0 ? "disabled" : ""} aria-label="Subir">↑</button>
          <button class="icon-btn mv-part" data-i="${i}" data-d="1" ${i === parts.length - 1 ? "disabled" : ""} aria-label="Bajar">↓</button></td>` : ""}
        <td class="mono"><span class="swatch" style="background:${esc(p.color || "#808080")}"></span>${esc(p.id)}</td>
        <td>${esc(p.nombre)}</td><td>${esc(MODOS[p.modo])}</td><td>${parametro(p)}</td>
        <td>${p.modo === "ritmo" ? esc(p.codigosUnidad.join(" → ")) + (p.direccion === "descendente" ? " (desc.)" : "") : "—"}</td>
        <td class="num">${p.actividades.length}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty"><strong>Aún no hay partidas</strong>${ed ? "Crea la primera con \"Nueva partida\"." : ""}</div>`}`;
  if (!ed) return;
  $("#btn-nueva-partida").onclick = () => modalPartida(null);
  $$("tr.link", el).forEach((tr) => (tr.onclick = () => modalPartida(S.partidas.get(tr.dataset.id))));
  $$(".mv-part", el).forEach((b) => (b.onclick = async (ev) => {
    ev.stopPropagation();
    const lista = [...S.partidas.values()], i = +b.dataset.i, j = i + +b.dataset.d;
    [lista[i], lista[j]] = [lista[j], lista[i]];
    try {
      const batch = writeBatch(CTX.db);
      lista.forEach((p, k) => { if (p.orden !== k + 1) { batch.update(refPart(p.id), { orden: k + 1 }); } });
      await batch.commit();
      lista.forEach((p, k) => (p.orden = k + 1));
      S.partidas = ordenadas([...S.partidas.entries()]); render();
    } catch (e) { toast(errorMsg(e)); }
  }));
}

function modalPartida(p) {
  const nuevo = !p; p = p || { id: "", nombre: "", modo: "fija", color: "#2457A6", codigosUnidad: [], direccion: "ascendente", redondeo: "arriba" };
  const opCod = (sel) => `<option value="">—</option>` + S.codigos.map((c) => `<option ${c.codigo === sel ? "selected" : ""}>${esc(c.codigo)}</option>`).join("");
  openModal(`
    <h2>${nuevo ? "Nueva partida" : "Editar partida " + esc(p.id)}</h2>
    <div class="grid2">
      <label>ID<input name="pid" maxlength="12" value="${esc(p.id)}" ${nuevo ? "" : "disabled"} placeholder="Ej. PINT"><span class="help">Letras y números, sin guiones. No cambia después.</span></label>
      <label>Nombre<input name="nombre" maxlength="60" value="${esc(p.nombre)}" placeholder="Ej. Pintura"></label>
      <label>Modo<select name="modo">${Object.entries(MODOS).map(([k, v]) => `<option value="${k}" ${k === p.modo ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label>Color<input type="color" name="color" value="${esc(p.color || "#808080")}"></label>
    </div>
    <fieldset data-modo="cantidad"><legend>Por cantidad</legend><div class="grid2">
      <label>Unidad de medida<input name="unidad" maxlength="10" value="${esc(p.unidad || "")}" placeholder="m3"></label>
      <label>Rendimiento diario<input name="rendimiento" type="number" step="any" min="0" value="${p.rendimiento ?? ""}" placeholder="50"></label>
      <label>Redondeo<select name="redondeo"><option value="arriba" ${p.redondeo !== "normal" ? "selected" : ""}>Hacia arriba</option><option value="normal" ${p.redondeo === "normal" ? "selected" : ""}>Normal</option></select></label>
    </div></fieldset>
    <fieldset data-modo="ritmo"><legend>Por ritmo</legend><div class="grid2">
      <label>Ritmo (unidades por día)<input name="ritmo" type="number" step="any" min="0" value="${p.ritmo ?? ""}" placeholder="1,5"></label>
      <label>Duración por unidad (días)<input name="duracionUnidad" type="number" step="1" min="1" value="${p.duracionUnidad ?? 1}"></label>
      <label>Dirección de avance<select name="direccion"><option value="ascendente">Ascendente</option><option value="descendente" ${p.direccion === "descendente" ? "selected" : ""}>Descendente</option></select></label>
      <label>Código de unidad 1<select name="cu1">${opCod(p.codigosUnidad?.[0])}</select></label>
      <label>Código de unidad 2<select name="cu2">${opCod(p.codigosUnidad?.[1])}</select></label>
      <label>Código de unidad 3<select name="cu3">${opCod(p.codigosUnidad?.[2])}</select></label>
    </div><span class="help">Los códigos de unidad definen el orden de avance (ej. Piso y luego Depto).</span></fieldset>
    <p class="msg-error" hidden></p>
    <div class="modal-actions">${nuevo ? "" : `<button class="btn btn-danger left" value="delete" formnovalidate>Eliminar partida</button>`}
      <button class="btn btn-secondary" value="cancel" formnovalidate>Cancelar</button><button class="btn btn-primary" value="save">Guardar</button></div>`,
    async (fd, form, sub) => {
      if (sub?.value === "delete") {
        if (p.actividades.length) throw new Error(`No se puede eliminar: la partida tiene ${p.actividades.length} actividad(es). Elimínalas o muévelas a otra partida primero.`);
        if (!confirm(`¿Eliminar la partida ${p.id}?`)) return false;
        await deleteDoc(refPart(p.id)); S.partidas.delete(p.id); render(); toast("Partida eliminada"); return;
      }
      const g = (k) => String(fd.get(k) ?? "").trim();
      const n = (k) => (g(k) === "" ? null : Number(g(k).replace(",", ".")));
      const id = nuevo ? g("pid").toUpperCase() : p.id, modo = g("modo"), errs = [];
      if (nuevo) {
        if (!/^[A-Z0-9_]{1,12}$/.test(id)) errs.push("El ID debe tener de 1 a 12 letras o números, sin guiones ni espacios.");
        if (S.partidas.has(id)) errs.push(`Ya existe la partida ${id}.`);
      }
      if (!g("nombre")) errs.push("Falta el nombre.");
      const d = { id, nombre: g("nombre"), modo, color: g("color").toUpperCase(), unidad: null, rendimiento: null, redondeo: null, ritmo: null, codigosUnidad: [], direccion: null, duracionUnidad: null };
      if (modo === "cantidad") {
        d.unidad = g("unidad"); d.rendimiento = n("rendimiento"); d.redondeo = g("redondeo");
        if (!d.unidad) errs.push("Falta la unidad de medida.");
        if (!(d.rendimiento > 0)) errs.push("El rendimiento diario debe ser mayor que 0.");
      }
      if (modo === "ritmo") {
        d.ritmo = n("ritmo"); d.direccion = g("direccion"); d.duracionUnidad = n("duracionUnidad") ?? 1;
        if (!(Number.isInteger(d.duracionUnidad) && d.duracionUnidad >= 1)) errs.push("La duración por unidad debe ser un número entero de días (1 o más).");
        d.codigosUnidad = ["cu1", "cu2", "cu3"].map(g).filter(Boolean);
        if (!(d.ritmo > 0)) errs.push("El ritmo debe ser mayor que 0.");
        if (!d.codigosUnidad.length) errs.push("Elige al menos un código de unidad (crea los códigos en la pestaña Códigos).");
        if (new Set(d.codigosUnidad).size !== d.codigosUnidad.length) errs.push("Un código de unidad está repetido.");
      }
      if (errs.length) throw new Error(errs.join("\n"));
      if (nuevo) {
        d.orden = Math.max(0, ...[...S.partidas.values()].map((x, i) => x.orden ?? i + 1)) + 1;
        await setDoc(refPart(id), { ...d, actividades: [] }); S.partidas.set(id, { ...d, actividades: [] });
      }
      else { await updateDoc(refPart(id), d); Object.assign(S.partidas.get(id), d); }
      S.partidas = ordenadas([...S.partidas.entries()]);
      render(); toast(nuevo ? "Partida creada" : "Partida guardada");
    },
    (form) => {
      const sync = () => $$("fieldset[data-modo]", form).forEach((f) => (f.hidden = f.dataset.modo !== form.elements.modo.value));
      form.elements.modo.onchange = sync; sync();
    });
}

// ---------- Actividades: validación ----------
const cap = (m) => m[0].toUpperCase() + m.slice(1);
const validar = (a, ids) => validarActividad(a, ids, (pid) => S.partidas.get(pid), S.codigos);
function problemas() {
  const acts = todas(), ids = new Set(acts.map((a) => a.id)), out = [];
  acts.forEach((a) => validar(a, ids).forEach((m) => out.push(`${a.id}: ${m}`)));
  const ciclo = buscarCiclo(acts);
  if (ciclo) out.push(`Ciclo lógico: ${ciclo.join(" → ")}`);
  return out;
}
function siguienteId(pid) {
  const re = new RegExp(`^${pid}-(\\d{4})$`);
  const max = todas().reduce((m, a) => { const r = a.id.match(re); return r ? Math.max(m, +r[1]) : m; }, 0);
  return `${pid}-${String(max + 1).padStart(4, "0")}`;
}

// ---------- Actividades: vista ----------
function tabActividades(el) {
  const ed = S.puedeEditar, parts = [...S.partidas.values()];
  const probs = problemas();
  el.innerHTML = `
    <div class="toolbar">
      <select id="f-partida"><option value="">Todas las partidas</option>${parts.map((p) => `<option value="${esc(p.id)}">${esc(p.id)} – ${esc(p.nombre)}</option>`).join("")}</select>
      <input id="f-texto" placeholder="Buscar por ID o nombre" style="min-width:220px">
      <label class="help" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="f-criticas"> Solo críticas</label>
      <select id="f-orden"><option value="partida">Ordenar por partida</option><option value="inicio">Ordenar por inicio</option></select>
      <span class="spacer"></span>
      ${ed ? `<button id="btn-calcular" class="btn btn-secondary" ${todas().length ? "" : "disabled"}>Calcular programa</button>
        <button id="btn-nueva-act" class="btn btn-primary" ${parts.length ? "" : "disabled title='Crea primero una partida'"}>+ Nueva actividad</button>` : ""}
    </div>
    ${estadoCalculo()}
    ${probs.length ? `<div class="issues"><span class="warn">${probs.length} problema(s) por revisar</span><ul>${probs.slice(0, 15).map((m) => `<li>${esc(m)}</li>`).join("")}${probs.length > 15 ? `<li>… y ${probs.length - 15} más</li>` : ""}</ul></div>` : ""}
    <div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>Nombre</th><th>Partida</th><th class="num">Cantidad</th><th class="num">Duración (días)</th><th>Inicio</th><th>Término</th><th class="num" title="Holgura total (días)">HT</th><th class="num" title="Holgura libre (días)">HL</th><th>Predecesoras</th>
        ${S.codigos.map((c) => `<th title="${esc(c.descripcion || "")}">${esc(c.codigo)}</th>`).join("")}<th>Restricción</th></tr></thead>
      <tbody id="act-body"></tbody></table></div>`;
  const pintar = () => {
    const fp = $("#f-partida").value, ft = $("#f-texto").value.trim().toLowerCase(), fc = $("#f-criticas").checked;
    const porInicio = $("#f-orden").value === "inicio", pos = posPartida();
    const filas = todas().filter((a) => (!fp || a.partida === fp) && (!fc || a.calc?.critica) && (!ft || a.id.toLowerCase().includes(ft) || (a.nombre || "").toLowerCase().includes(ft)))
      .sort((a, b) => porInicio ? (a.calc?.ie || "9").localeCompare(b.calc?.ie || "9") || a.id.localeCompare(b.id)
        : pos.get(a.partida) - pos.get(b.partida) || a.id.localeCompare(b.id));
    $("#act-body").innerHTML = filas.map((a) => {
      const p = S.partidas.get(a.partida), dur = duracionEfectiva(a, p);
      const c = a.calc;
      return `<tr class="${ed ? "link" : ""} ${c?.critica ? "critica" : ""}" data-id="${esc(a.id)}">
        <td class="mono">${esc(a.id)}</td><td>${esc(a.nombre)}</td>
        <td><span class="swatch" style="background:${esc(p?.color || "#808080")}"></span>${esc(a.partida)}</td>
        <td class="num">${p?.modo === "cantidad" ? fmtNum(a.cantidad) + " " + esc(p.unidad) : ""}</td>
        <td class="num">${dur ?? `<span class="warn">?</span>`}${p?.modo === "cantidad" ? ' <span class="help">calc.</span>' : ""}</td>
        <td class="mono">${esc(fechaCorta(c?.ie))}</td><td class="mono">${esc(fechaCorta(c?.te))}</td>
        <td class="num ${c && c.ht <= 0 ? "warn" : ""}">${c ? c.ht : ""}</td><td class="num">${c ? c.hl : ""}</td>
        <td>${esc(predText(a.predecesoras))}</td>
        ${S.codigos.map((c) => `<td>${esc(a.codigos?.[c.codigo] || "")}</td>`).join("")}
        <td>${a.restriccion?.tipo ? esc(RESTRICCIONES[a.restriccion.tipo] + " " + fechaCL(a.restriccion.fecha)) : ""}</td></tr>`;
    }).join("") || `<tr><td colspan="${11 + S.codigos.length}" class="muted">${todas().length ? "Ninguna actividad coincide con el filtro." : "Aún no hay actividades."}</td></tr>`;
    if (ed) $$("#act-body tr.link").forEach((tr) => (tr.onclick = () => modalActividad(todas().find((a) => a.id === tr.dataset.id))));
  };
  $("#f-partida").onchange = pintar; $("#f-texto").oninput = pintar; $("#f-criticas").onchange = pintar; $("#f-orden").onchange = pintar;
  pintar();
  if (ed && todas().length) $("#btn-calcular").onclick = calcularPrograma;
  if (ed && parts.length) $("#btn-nueva-act").onclick = () => modalActividad(null, $("#f-partida").value);
}

function modalActividad(orig, partidaSugerida) {
  const nuevo = !orig, parts = [...S.partidas.values()];
  const a = orig || { id: "", nombre: "", partida: partidaSugerida || parts[0].id, cantidad: null, duracion: null, predecesoras: [], restriccion: null, codigos: {} };
  openModal(`
    <h2>${nuevo ? "Nueva actividad" : "Editar actividad " + esc(a.id)}</h2>
    <div class="grid2">
      <label>Partida<select name="partida">${parts.map((p) => `<option value="${esc(p.id)}" ${p.id === a.partida ? "selected" : ""}>${esc(p.id)} – ${esc(p.nombre)}</option>`).join("")}</select></label>
      <label>ID<input name="actid" value="${esc(a.id)}" ${nuevo ? "" : "disabled"} maxlength="17"><span class="help">Partida + correlativo de 4 dígitos. No cambia nunca.</span></label>
    </div>
    <label>Nombre<input name="nombre" value="${esc(a.nombre)}" maxlength="120" placeholder="Ej. Pintura depto 501"></label>
    <div id="campos-modo"></div>
    <fieldset><legend>Predecesoras</legend>
      <div class="table-wrap"><table class="pred-table"><thead><tr><th>Actividad</th><th style="width:120px">Relación</th><th style="width:110px">Desfase (días)</th><th style="width:40px"></th></tr></thead>
        <tbody id="pred-body"></tbody></table></div>
      <div><button type="button" class="btn btn-secondary btn-sm" id="btn-add-pred">+ Agregar predecesora</button></div>
      <datalist id="lista-ids">${todas().filter((x) => x.id !== a.id).sort((x, y) => x.id.localeCompare(y.id)).map((x) => `<option value="${esc(x.id)}">${esc(x.nombre)}</option>`).join("")}</datalist>
      <span class="help">FI: parte cuando termina la predecesora. II: parte cuando parte la predecesora. Desfase en días hábiles; negativo = traslape.</span>
    </fieldset>
    <div class="grid2">
      <label>Restricción<select name="rTipo"><option value="">Sin restricción</option>${Object.entries(RESTRICCIONES).map(([k, v]) => `<option value="${k}" ${a.restriccion?.tipo === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label>Fecha de restricción<input type="date" name="rFecha" value="${esc(a.restriccion?.fecha || "")}"></label>
    </div>
    <fieldset><legend>Activity codes</legend><div class="grid2" id="campos-codigos"></div></fieldset>
    <p class="msg-error" hidden></p>
    <div class="modal-actions">${nuevo ? "" : `<button class="btn btn-danger left" value="delete" formnovalidate>Eliminar</button>`}
      <button class="btn btn-secondary" value="cancel" formnovalidate>Cancelar</button><button class="btn btn-primary" value="save">Guardar</button></div>`,
    async (fd, form, sub) => {
      const todasAct = todas();
      if (sub?.value === "delete") {
        const usan = todasAct.filter((x) => x.predecesoras?.some((y) => y.id === a.id)).map((x) => x.id);
        if (usan.length) throw new Error(`No se puede eliminar: es predecesora de ${usan.slice(0, 6).join(", ")}${usan.length > 6 ? "…" : ""}. Quítala de esas actividades primero.`);
        if (!confirm(`¿Eliminar la actividad ${a.id}?`)) return false;
        const p = S.partidas.get(a.partida), arr = p.actividades.filter((x) => x.id !== a.id);
        await updateDoc(refPart(p.id), { actividades: arr }); p.actividades = arr; render(); toast("Actividad eliminada"); return;
      }
      const g = (k) => String(fd.get(k) ?? "").trim();
      const n = (k) => (g(k) === "" ? null : Number(g(k).replace(",", ".")));
      const partida = g("partida"), p = S.partidas.get(partida);
      const id = nuevo ? g("actid").toUpperCase() : a.id;
      const errs = [];
      if (nuevo) {
        if (!/^[A-Z0-9_]{1,12}-\d{4}$/.test(id)) errs.push("El ID debe ser partida + guion + 4 dígitos (ej. PINT-0001).");
        if (todasAct.some((x) => x.id === id)) errs.push(`Ya existe la actividad ${id}.`);
      }
      const lista = [];
      $$("#pred-body tr", form).forEach((tr) => {
        const pid = $(".pred-id", tr).value.trim().toUpperCase(); if (!pid) return;
        const t = $(".pred-des", tr).value.trim(), d = t === "" ? 0 : Number(t);
        if (!Number.isInteger(d)) errs.push(`Predecesora ${pid}: el desfase debe ser un número entero de días.`);
        lista.push({ id: pid, tipo: $(".pred-tipo", tr).value, desfase: Number.isInteger(d) ? d : 0 });
      });
      const codigos = {};
      S.codigos.forEach((c) => { const v = g("cod:" + c.codigo); if (v) codigos[c.codigo] = v; });
      const datos = {
        ...(orig || {}), id, nombre: g("nombre"), partida,
        cantidad: p.modo === "cantidad" ? n("cantidad") : null,
        duracion: p.modo === "fija" ? n("duracion") : null,
        predecesoras: lista,
        restriccion: g("rTipo") ? { tipo: g("rTipo"), fecha: g("rFecha") || null } : null,
        codigos,
      };
      ["avance", "calc", "base"].forEach((k) => { if (datos[k] === undefined) datos[k] = null; });
      const resto = todasAct.filter((x) => x.id !== (orig?.id ?? id));
      const ids = new Set([...resto.map((x) => x.id), id]);
      errs.push(...validar(datos, ids).map((m) => cap(m) + "."));
      if (!errs.length) {
        const ciclo = buscarCiclo([...resto, datos]);
        if (ciclo) errs.push(`Se formaría un ciclo lógico: ${ciclo.join(" → ")}.`);
      }
      if (errs.length) throw new Error(errs.join("\n"));
      // Guardar (si cambió de partida, se mueve entre documentos en una sola operación)
      if (orig && orig.partida !== partida) {
        const o = S.partidas.get(orig.partida);
        const arrO = o.actividades.filter((x) => x.id !== orig.id), arrD = [...p.actividades, datos];
        const b = writeBatch(CTX.db);
        b.update(refPart(o.id), { actividades: arrO }); b.update(refPart(p.id), { actividades: arrD });
        await b.commit(); o.actividades = arrO; p.actividades = arrD;
      } else {
        const arr = orig ? p.actividades.map((x) => (x.id === id ? datos : x)) : [...p.actividades, datos];
        await updateDoc(refPart(p.id), { actividades: arr }); p.actividades = arr;
      }
      render(); toast(nuevo ? `Actividad ${id} creada` : "Actividad guardada");
    },
    (form) => {
      const pintar = (primera) => {
        const p = S.partidas.get(form.elements.partida.value);
        const prev = primera ? { cantidad: a.cantidad ?? "", duracion: a.duracion ?? "", cod: a.codigos || {} }
          : { cantidad: form.elements.cantidad?.value ?? "", duracion: form.elements.duracion?.value ?? "",
              cod: Object.fromEntries(S.codigos.map((c) => [c.codigo, form.elements["cod:" + c.codigo]?.value || ""])) };
        let h = `<p class="help" style="margin:0">Modo: <strong>${esc(MODOS[p.modo])}</strong>${p.modo !== "fija" ? ` (${parametro(p)})` : ""}</p>`;
        if (p.modo === "cantidad") h += `<div class="grid2"><label>Cantidad (${esc(p.unidad)})<input name="cantidad" type="number" step="any" min="0" value="${esc(prev.cantidad)}"></label>
            <p class="help" id="dur-calc" style="align-self:end"></p></div>`;
        else if (p.modo === "ritmo") h += `<div class="grid2"><label>Duración (días)<input type="number" value="${p.duracionUnidad || 1}" disabled></label>
            <p class="help" style="align-self:end">Definida por la partida (duración por unidad). El inicio se desfasa según el ritmo.</p></div>`;
        else h += `<div class="grid2"><label>Duración (días)<input name="duracion" type="number" step="1" min="1" value="${esc(prev.duracion)}"></label><span></span></div>`;
        $("#campos-modo", form).innerHTML = h;
        $("#campos-codigos", form).innerHTML = S.codigos.length ? S.codigos.map((c) => {
          const req = p.modo === "ritmo" && p.codigosUnidad.includes(c.codigo);
          return `<label title="${esc(c.descripcion || "")}">${esc(c.codigo)}${req ? ' <span class="warn">*</span>' : ""}<select name="cod:${esc(c.codigo)}"><option value="">—</option>
            ${c.valores.map((v) => `<option value="${esc(v.valor)}" ${prev.cod[c.codigo] === v.valor ? "selected" : ""}>${esc(v.valor)}${v.descripcion ? " – " + esc(v.descripcion) : ""}</option>`).join("")}</select></label>`;
        }).join("") : `<p class="help">No hay códigos definidos en el programa.</p>`;
        if (p.modo === "cantidad") {
          const upd = () => { const d = duracionEfectiva({ cantidad: Number(form.elements.cantidad.value) }, p); $("#dur-calc", form).textContent = d ? `Duración calculada: ${d} día(s)` : ""; };
          form.elements.cantidad.oninput = upd; upd();
        }
        const fid = form.elements.actid;
        if (nuevo && !fid.dataset.tocado) fid.value = siguienteId(p.id);
      };
      const filaPred = (x = { id: "", tipo: "FS", desfase: 0 }) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td><input class="pred-id" list="lista-ids" value="${esc(x.id)}" placeholder="Ej. CERA-0001" style="width:100%"></td>
          <td><select class="pred-tipo"><option value="FS" ${x.tipo !== "SS" ? "selected" : ""}>FI (fin-inicio)</option><option value="SS" ${x.tipo === "SS" ? "selected" : ""}>II (inicio-inicio)</option></select></td>
          <td><input class="pred-des" type="number" step="1" value="${Number(x.desfase) || 0}" style="width:90px"></td>
          <td><button type="button" class="icon-btn pred-del" aria-label="Quitar">✕</button></td>`;
        $("#pred-body", form).appendChild(tr);
        return tr;
      };
      (a.predecesoras || []).forEach((x) => filaPred(x));
      $("#btn-add-pred", form).onclick = () => $(".pred-id", filaPred()).focus();
      $("#pred-body", form).onclick = (ev) => { if (ev.target.closest(".pred-del")) ev.target.closest("tr").remove(); };
      form.elements.partida.onchange = () => pintar(false);
      if (nuevo) form.elements.actid.oninput = () => (form.elements.actid.dataset.tocado = "1");
      pintar(true);
    });
}

// ---------- Cálculo del programa ----------
function estadoCalculo() {
  const k = S.prog.calculo;
  if (!todas().length) return "";
  if (!k) return `<div class="calc-box">Programa sin calcular.${S.puedeEditar ? " Presiona \"Calcular programa\" para obtener fechas, holguras y ruta crítica." : ""}</div>`;
  const vigente = k.firma === firma();
  const cuando = new Date(k.fecha).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
  return `<div class="calc-box ${vigente ? "" : "calc-old"}">
    <div><span class="help">Término del programa</span><strong>${esc(fechaCL(k.termino))}</strong></div>
    <div><span class="help">Duración</span><strong>${k.duracion} días hábiles</strong></div>
    <div><span class="help">Actividades críticas</span><strong>${k.criticas}</strong></div>
    <div><span class="help">Calculado</span><strong>${esc(cuando)}</strong></div>
    ${vigente ? "" : `<p class="warn" style="margin:0;flex-basis:100%">Hubo cambios después del último cálculo. ${S.puedeEditar ? "Presiona \"Calcular programa\" para actualizar." : "Pide al editor que recalcule."}</p>`}
  </div>`;
}

async function calcularPrograma() {
  const probs = problemas();
  if (probs.length) return toast("Corrige los problemas indicados antes de calcular.");
  const btn = $("#btn-calcular"); btn.disabled = true; btn.textContent = "Calculando…";
  try {
    const r = calcular({ actividades: todas(), partidas: Object.fromEntries(S.partidas), codigos: S.codigos, programa: S.prog, feriados: S.feriados });
    if (r.errores.length) {
      openModal(`<h2>No se pudo calcular</h2><ul>${r.errores.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>
        <div class="modal-actions"><button class="btn btn-primary" value="cancel">Entendido</button></div>`, async () => {});
      return;
    }
    const batch = writeBatch(CTX.db), nuevas = new Map();
    for (const p of S.partidas.values()) {
      const arr = p.actividades.map((a) => { const x = r.res.get(a.id); return { ...a, calc: { dur: x.dur, ie: x.ie, te: x.te, it: x.it, tt: x.tt, ht: x.ht, hl: x.hl, critica: x.critica } }; });
      nuevas.set(p.id, arr); batch.update(refPart(p.id), { actividades: arr });
    }
    const criticas = [...r.res.values()].filter((x) => x.critica).length;
    const calculo = { fecha: new Date().toISOString(), termino: r.termino, duracion: r.duracionTotal, criticas, firma: firma(), por: CTX.me.uid };
    batch.update(refProg(S.id), { calculo });
    await batch.commit();
    nuevas.forEach((arr, id) => (S.partidas.get(id).actividades = arr));
    S.prog.calculo = calculo;
    render(); toast(`Programa calculado: término ${fechaCL(r.termino)}`);
  } catch (e) { toast(errorMsg(e)); btn.disabled = false; btn.textContent = "Calcular programa"; }
}

// ---------- Exportación a Excel ----------
async function cargarXLSX() {
  if (window.XLSX) return;
  await new Promise((ok, err) => {
    const sc = document.createElement("script");
    sc.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    sc.onload = ok; sc.onerror = () => err(new Error("No se pudo cargar la librería de Excel. Revisa tu conexión."));
    document.head.appendChild(sc);
  });
}
// Fecha como número de serie de Excel (sin zona horaria) para evitar corrimientos de un día.
const aFecha = (iso) => { if (!iso) return ""; const [y, m, d] = iso.split("-").map(Number); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000; };

async function exportarExcel() {
  const btn = $("#btn-exportar"); btn.disabled = true; btn.textContent = "Exportando…";
  try {
    await cargarXLSX();
    const pos = posPartida();
    const acts = todas().sort((a, b) => pos.get(a.partida) - pos.get(b.partida) || a.id.localeCompare(b.id));
    const partidas = Object.fromEntries(S.partidas);
    const probs = problemas();
    const r = probs.length || !acts.length ? null
      : calcular({ actividades: acts, partidas, codigos: S.codigos, programa: S.prog, feriados: S.feriados });
    const ok = r && !r.errores.length;
    const X = window.XLSX, wb = X.utils.book_new();
    const hoja = (nombre, filas, anchos, colsFecha = []) => {
      const ws = X.utils.aoa_to_sheet(filas);
      for (let i = 1; i < filas.length; i++) colsFecha.forEach((c) => {
        const cell = ws[X.utils.encode_cell({ r: i, c })];
        if (cell && cell.t === "n") cell.z = "dd-mm-yyyy";
      });
      ws["!cols"] = anchos.map((w) => ({ wch: w }));
      X.utils.book_append_sheet(wb, ws, nombre);
    };

    // 1. Actividades
    const cods = S.codigos.map((c) => c.codigo);
    const cab = ["ID", "Nombre", "Partida", "Modo", "Cantidad", "Unidad", "Rendimiento diario", "Ritmo (unid/día)", "Duración (días)",
      "Predecesoras", ...cods, "Tipo restricción", "Fecha restricción",
      "Día IT (n° hábil)", "Día TT (exclusivo)", "Día IT tardío", "Día TT tardío (exclusivo)",
      "Inicio temprano", "Término temprano", "Inicio tardío", "Término tardío", "Holgura total", "Holgura libre", "Crítica"];
    const filas = [cab, ...acts.map((a) => {
      const p = partidas[a.partida], x = ok ? r.res.get(a.id) : null;
      return [a.id, a.nombre, a.partida, MODOS[p?.modo] || "", a.cantidad ?? "", p?.modo === "cantidad" ? p.unidad : "",
        p?.modo === "cantidad" ? p.rendimiento : "", p?.modo === "ritmo" ? p.ritmo : "", duracionEfectiva(a, p) ?? "",
        predText(a.predecesoras), ...cods.map((c) => a.codigos?.[c] || ""),
        a.restriccion?.tipo ? RESTRICCIONES[a.restriccion.tipo] : "", aFecha(a.restriccion?.fecha),
        x ? x.es : "", x ? x.es + x.dur : "", x ? x.ls : "", x ? x.ls + x.dur : "",
        aFecha(x?.ie), aFecha(x?.te), aFecha(x?.it), aFecha(x?.tt), x ? x.ht : "", x ? x.hl : "", x ? (x.critica ? "Sí" : "No") : ""];
    })];
    const b = 10 + cods.length; // primera columna después de los códigos
    hoja("Actividades", filas, [12, 30, 9, 13, 9, 7, 10, 9, 9, 28, ...cods.map(() => 8), 20, 12, 9, 9, 9, 9, 12, 12, 12, 12, 8, 8, 7],
      [b + 1, b + 6, b + 7, b + 8, b + 9]);

    // 2. Relaciones (lógica + ritmo)
    const rel = [["Predecesora", "Sucesora", "Tipo", "Desfase (días hábiles)", "Origen"]];
    acts.forEach((a) => (a.predecesoras || []).forEach((x) => rel.push([x.id, a.id, x.tipo === "SS" ? "II" : "FI", Number(x.desfase) || 0, "Lógica (cargada)"])));
    relacionesRitmo(acts, partidas, S.codigos).forEach((x) => rel.push([x.de, x.a, "II", x.desfase, `Ritmo ${x.de.split("-")[0]} (automática)`]));
    hoja("Relaciones", rel, [12, 12, 6, 20, 22]);

    // 3. Partidas
    hoja("Partidas", [["ID", "Nombre", "Modo", "Unidad", "Rendimiento diario", "Redondeo", "Ritmo (unid/día)", "Duración por unidad (días)", "Códigos de unidad", "Dirección", "N° actividades"],
      ...[...S.partidas.values()].map((p) => [p.id, p.nombre, MODOS[p.modo], p.unidad || "", p.rendimiento ?? "", p.redondeo || "",
        p.ritmo ?? "", p.modo === "ritmo" ? p.duracionUnidad || 1 : "", (p.codigosUnidad || []).join("; "), p.direccion || "", p.actividades.length])], [10, 26, 14, 8, 12, 10, 12, 14, 18, 12, 12]);

    // 4. Calendario
    hoja("Calendario", [["Parámetro", "Valor"], ["Programa", S.prog.nombre], ["Fecha de inicio", aFecha(S.prog.fechaInicio)],
      ["Calendario", CALENDARIOS[S.prog.calendario]], ["Término calculado", ok ? aFecha(r.termino) : "Sin calcular"], [],
      ["Convención", "Día 0 = primer día hábil desde la fecha de inicio. TT = IT + duración (exclusivo): la actividad ocupa los días IT a TT-1."],
      ["FI", "Sucesora: IT ≥ TT de la predecesora + desfase"], ["II", "Sucesora: IT ≥ IT de la predecesora + desfase"],
      ["Desfase", "En días hábiles; puede ser negativo (traslape). Texto: CERA-0001 FI+2, TABI-0002 II-1"],
      ["Ritmo", "Unidad k de una partida: desfase acumulado = ENTERO((k-1)/ritmo), ordenadas por los códigos de unidad"], [],
      ["Feriado", "Fecha"], ...S.feriados.map((f) => [f.nombre, aFecha(f.fecha)])], [18, 90], [1]);

    // 5. Días hábiles
    if (ok) {
      const cal = crearCalendario(S.prog.fechaInicio, S.prog.calendario, S.feriados);
      const dias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
      const minimo = Math.min(0, ...[...r.res.values()].map((x) => x.ls));
      const tabla = [["Día hábil", "Fecha", "Día"]];
      for (let i = minimo; i < r.duracionTotal; i++) { const f = cal.fecha(i); tabla.push([i, aFecha(f), dias[new Date(f + "T12:00:00Z").getUTCDay()]]); }
      hoja("Días hábiles", tabla, [10, 12, 11], [1]);
    }

    const nombre = `Programa_${(S.prog.nombre || "programa").replace(/[^\p{L}\p{N}]+/gu, "_")}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    X.writeFile(wb, nombre);
    toast(ok ? "Excel exportado con el cálculo actual" : "Excel exportado sin cálculo (hay problemas por corregir o no hay actividades)");
  } catch (e) { toast(errorMsg(e)); }
  finally { btn.disabled = false; btn.textContent = "Exportar a Excel"; }
}

// ---------- Importación desde Excel (programa vacío) ----------
function importarExcel() {
  if (S.partidas.size || S.codigos.length) {
    openModal(`<h2>Importar desde Excel</h2>
      <p>Este programa ya tiene ${S.codigos.length} código(s) y ${S.partidas.size} partida(s). Por ahora la importación solo carga programas vacíos;
      la actualización de un programa con datos (re-importación) viene más adelante.</p>
      <p>Para importar, crea un programa nuevo desde la lista de programas.</p>
      <div class="modal-actions"><button class="btn btn-primary" value="cancel">Entendido</button></div>`, async () => {});
    return;
  }
  let datos = null;
  openModal(`
    <h2>Importar desde Excel</h2>
    <p class="help" style="margin:0">Carga en este programa las hojas Partidas, Códigos, Calendario (inicio, días laborales y feriados) y Actividades.
      Primero se revisa el archivo; no se guarda nada hasta que presiones "Importar".</p>
    <label>Archivo Excel<input type="file" name="archivo" accept=".xlsx,.xls"></label>
    <div id="imp-res"></div>
    <p class="msg-error" hidden></p>
    <div class="modal-actions"><button class="btn btn-secondary" value="cancel" formnovalidate>Cancelar</button>
      <button class="btn btn-secondary" value="revisar">Revisar archivo</button>
      <button class="btn btn-primary" value="importar" id="btn-imp" disabled>Importar</button></div>`,
    async (fd, form, sub) => {
      if (sub?.value === "revisar") {
        const f = fd.get("archivo");
        if (!f || !f.size) throw new Error("Elige el archivo Excel.");
        $("#imp-res", form).innerHTML = `<p class="help">Revisando…</p>`;
        await cargarXLSX();
        datos = leerExcel(await f.arrayBuffer());
        const termino = {};
        const calcCon = (prog) => calcular({ actividades: datos.actividades, partidas: Object.fromEntries(datos.partidas.map((p) => [p.id, p])),
          codigos: datos.codigos, programa: prog, feriados: datos.feriados });
        const progActual = { fechaInicio: S.prog.fechaInicio, calendario: S.prog.calendario };
        const difiere = datos.programa.fechaInicio !== progActual.fechaInicio || datos.programa.calendario !== progActual.calendario;
        if (!datos.errores.length) {
          const r = calcCon(datos.programa);
          if (r.errores.length) datos.errores.push(...r.errores);
          else { termino.excel = r.termino; if (difiere) termino.programa = calcCon(progActual).termino; }
        }
        const nVal = datos.codigos?.reduce((n, c) => n + c.valores.length, 0) || 0;
        const E = datos.errores, A = datos.avisos;
        $("#imp-res", form).innerHTML = `
          ${E.length ? `<div class="issues"><span class="warn">${E.length} error(es): corrige el Excel y vuelve a revisarlo.</span>
            <ul>${E.slice(0, 40).map((m) => `<li>${esc(m)}</li>`).join("")}${E.length > 40 ? `<li>… y ${E.length - 40} más</li>` : ""}</ul></div>`
          : `<div class="calc-box">
              <div><span class="help">Actividades</span><strong>${datos.actividades.length}</strong></div>
              <div><span class="help">Partidas</span><strong>${datos.partidas.length}</strong></div>
              <div><span class="help">Códigos (valores)</span><strong>${datos.codigos.length} (${nVal})</strong></div>
              <div><span class="help">Feriados</span><strong>${datos.feriados.length}</strong></div>
              <div><span class="help">Término estimado</span><strong id="imp-term">${esc(fechaCL(termino.excel))}</strong></div></div>
            ${difiere ? `<fieldset><legend>Fecha de inicio y calendario</legend>
                <p class="warn" style="margin:0">El Excel y el programa no coinciden. Elige cuáles usar:</p>
                <label style="display:flex;gap:8px;align-items:center;font-weight:400"><input type="radio" name="usarCal" value="excel" checked>
                  Los del Excel: ${esc(fechaCL(datos.programa.fechaInicio))}, ${esc(CALENDARIOS[datos.programa.calendario])}</label>
                <label style="display:flex;gap:8px;align-items:center;font-weight:400"><input type="radio" name="usarCal" value="programa">
                  Los del programa: ${esc(fechaCL(progActual.fechaInicio))}, ${esc(CALENDARIOS[progActual.calendario])}</label>
              </fieldset>`
            : `<p class="help" style="margin:0">Inicio ${esc(fechaCL(progActual.fechaInicio))}, ${esc(CALENDARIOS[progActual.calendario])} (igual en el Excel y el programa).</p>`}`}
          ${A.length ? `<div class="help"><strong>Avisos:</strong><ul style="margin:4px 0 0;padding-left:18px">${A.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>` : ""}`;
        $("#btn-imp", form).disabled = E.length > 0;
        $$('input[name="usarCal"]', form).forEach((r) => (r.onchange = () => ($("#imp-term", form).textContent = fechaCL(termino[r.value]))));
        return false;
      }
      if (sub?.value === "importar") {
        if (!datos || datos.errores.length) throw new Error("Revisa el archivo antes de importar.");
        if (S.partidas.size || S.codigos.length) throw new Error("El programa ya tiene datos; recarga la página.");
        const db = CTX.db, b = writeBatch(db);
        if ((form.elements.usarCal?.value || "excel") === "excel")
          b.update(refProg(S.id), { fechaInicio: datos.programa.fechaInicio, calendario: datos.programa.calendario });
        b.set(refDef(), { codigos: datos.codigos, feriados: datos.feriados }, { merge: true });
        datos.partidas.forEach((p) => b.set(refPart(p.id), { ...p, actividades: datos.actividades.filter((a) => a.partida === p.id) }));
        await b.commit();
        const id = S.id; S = null;
        toast(`Importadas ${datos.actividades.length} actividades. Presiona "Calcular programa".`);
        const destino = `#programa/${id}/actividades`;
        if (location.hash !== destino) location.hash = destino; else viewPrograma(CTX, id, "actividades");
      }
    },
    (form) => { form.elements.archivo.onchange = () => { datos = null; $("#btn-imp", form).disabled = true; $("#imp-res", form).innerHTML = ""; }; });
}

// ---------- Puente con el Gantt ----------
function apiGantt() {
  return {
    S, todas, posPartida, estadoCalculo, puedeEditar: S.puedeEditar,
    abrirActividad: (a) => modalActividad(a),
    guardarLayouts: async (lista) => { await setDoc(refDef(), { layouts: lista }, { merge: true }); S.layouts = lista; },
  };
}
