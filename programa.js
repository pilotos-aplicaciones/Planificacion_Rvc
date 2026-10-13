// Detalle de un programa: resumen y miembros, códigos, partidas y actividades.
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, writeBatch }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { $, $$, esc, ROLES, CALENDARIOS, MODOS, RESTRICCIONES, fmtNum, toast, errorMsg, openModal } from "./util.js";

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
  S.tab = ["resumen", "codigos", "partidas", "actividades"].includes(tab) ? tab : "resumen";
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
  const partidas = new Map(parts.docs.map((d) => [d.id, { actividades: [], ...d.data(), id: d.id }])
    .sort((a, b) => a[0].localeCompare(b[0])));
  return {
    id, prog, partidas, tab: "resumen",
    codigos: dSnap.exists() ? dSnap.data().codigos || [] : [],
    usuarios: me.admin ? await CTX.loadUsuarios() : [],
    puedeEditar: me.admin || prog.miembros?.[me.uid] === "editor",
  };
}

const todas = () => [...S.partidas.values()].flatMap((p) => p.actividades.map((a) => ({ ...a, partida: p.id })));
const fechaCL = (iso) => (iso ? iso.split("-").reverse().join("-") : "");

export function duracionEfectiva(a, p) {
  if (!p) return null;
  if (p.modo === "fija") return a.duracion ?? null;
  if (p.modo === "ritmo") return a.duracion || 1;
  if (!(a.cantidad > 0) || !(p.rendimiento > 0)) return null;
  const d = a.cantidad / p.rendimiento;
  return p.redondeo === "normal" ? Math.max(1, Math.round(d)) : Math.ceil(d - 1e-9);
}

// ---------- Estructura de la vista ----------
function render() {
  const p = S.prog, me = CTX.me, miRol = p.miembros?.[me.uid];
  const nAct = todas().length;
  const tabs = [["resumen", "Resumen", ""], ["codigos", "Códigos", S.codigos.length],
    ["partidas", "Partidas", S.partidas.size], ["actividades", "Actividades", nAct]];
  $("#main").innerHTML = `
    <a href="#programas" class="back">‹ Programas</a>
    <div class="page-head">
      <div><h1>${esc(p.nombre)}</h1><p>${esc(p.proyecto)}, ${esc(p.etapa)}</p></div>
      <div class="toolbar" style="margin:0">
        <span class="badge ${miRol ? "badge-" + miRol : "badge-lector"}">${miRol ? ROLES[miRol] : "Administrador"}</span>
        <button id="btn-recargar" class="btn btn-secondary btn-sm">Recargar</button>
      </div>
    </div>
    <nav class="tabs">${tabs.map(([k, t, n]) =>
      `<a class="tab ${S.tab === k ? "active" : ""}" href="#programa/${esc(S.id)}/${k}">${t}${n !== "" ? `<span class="count">${n}</span>` : ""}</a>`).join("")}</nav>
    <div id="tab"></div>`;
  $("#btn-recargar").onclick = () => { const t = S.tab; S = null; viewPrograma(CTX, location.hash.split("/")[1], t); };
  ({ resumen: tabResumen, codigos: tabCodigos, partidas: tabPartidas, actividades: tabActividades })[S.tab]($("#tab"));
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
  el.innerHTML = `
    <dl class="meta">
      <div><dt>Fecha de inicio</dt><dd>${esc(fechaCL(p.fechaInicio))}</dd></div>
      <div><dt>Calendario</dt><dd>${esc(CALENDARIOS[p.calendario] || p.calendario)}</dd></div>
      <div><dt>Estado</dt><dd><span class="badge badge-ok">${esc(p.estado)}</span></dd></div>
      <div><dt>Programa tipo</dt><dd>${p.programaTipo ? esc(p.programaTipo.nombre) : "Sin asignar"}</dd></div>
    </dl>
    <h2>Miembros</h2>
    <div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Email</th><th>Rol</th></tr></thead><tbody>${filas || `<tr><td colspan="3">Sin miembros.</td></tr>`}</tbody></table></div>
    ${me.admin ? `<div class="row-actions">
        <select id="nuevo-miembro"><option value="">Agregar usuario…</option>${disponibles.map((u) => `<option value="${esc(u.uid)}">${esc(u.nombre)} (${esc(u.email)})</option>`).join("")}</select>
        <select id="nuevo-rol">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        <button id="btn-agregar" class="btn btn-primary">Agregar</button></div>
      <p class="help">¿No aparece la persona? Debe ingresar una vez a la app con su cuenta Google para quedar registrada.</p>
      <div class="row-actions" style="margin-top:32px"><button id="btn-eliminar" class="btn btn-danger">Eliminar programa</button></div>` : ""}`;
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
  if (p.modo === "ritmo") return `${fmtNum(p.ritmo)} unid/día`;
  return "—";
}
function tabPartidas(el) {
  const ed = S.puedeEditar, parts = [...S.partidas.values()];
  el.innerHTML = `
    <div class="toolbar"><p class="muted" style="margin:0">Cada actividad pertenece a una partida, que define cómo se calcula su duración.</p>
      <span class="spacer"></span>${ed ? `<button id="btn-nueva-partida" class="btn btn-primary">+ Nueva partida</button>` : ""}</div>
    ${parts.length ? `<div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>Nombre</th><th>Modo</th><th>Parámetro</th><th>Códigos de unidad</th><th class="num">Actividades</th></tr></thead>
      <tbody>${parts.map((p) => `<tr class="${ed ? "link" : ""}" data-id="${esc(p.id)}">
        <td class="mono"><span class="swatch" style="background:${esc(p.color || "#808080")}"></span>${esc(p.id)}</td>
        <td>${esc(p.nombre)}</td><td>${esc(MODOS[p.modo])}</td><td>${parametro(p)}</td>
        <td>${p.modo === "ritmo" ? esc(p.codigosUnidad.join(" → ")) + (p.direccion === "descendente" ? " (desc.)" : "") : "—"}</td>
        <td class="num">${p.actividades.length}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty"><strong>Aún no hay partidas</strong>${ed ? "Crea la primera con \"Nueva partida\"." : ""}</div>`}`;
  if (!ed) return;
  $("#btn-nueva-partida").onclick = () => modalPartida(null);
  $$("tr.link", el).forEach((tr) => (tr.onclick = () => modalPartida(S.partidas.get(tr.dataset.id))));
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
      const d = { id, nombre: g("nombre"), modo, color: g("color").toUpperCase(), unidad: null, rendimiento: null, redondeo: null, ritmo: null, codigosUnidad: [], direccion: null };
      if (modo === "cantidad") {
        d.unidad = g("unidad"); d.rendimiento = n("rendimiento"); d.redondeo = g("redondeo");
        if (!d.unidad) errs.push("Falta la unidad de medida.");
        if (!(d.rendimiento > 0)) errs.push("El rendimiento diario debe ser mayor que 0.");
      }
      if (modo === "ritmo") {
        d.ritmo = n("ritmo"); d.direccion = g("direccion");
        d.codigosUnidad = ["cu1", "cu2", "cu3"].map(g).filter(Boolean);
        if (!(d.ritmo > 0)) errs.push("El ritmo debe ser mayor que 0.");
        if (!d.codigosUnidad.length) errs.push("Elige al menos un código de unidad (crea los códigos en la pestaña Códigos).");
        if (new Set(d.codigosUnidad).size !== d.codigosUnidad.length) errs.push("Un código de unidad está repetido.");
      }
      if (errs.length) throw new Error(errs.join("\n"));
      if (nuevo) { await setDoc(refPart(id), { ...d, actividades: [] }); S.partidas.set(id, { ...d, actividades: [] }); }
      else { await updateDoc(refPart(id), d); Object.assign(S.partidas.get(id), d); }
      S.partidas = new Map([...S.partidas.entries()].sort((a, b) => a[0].localeCompare(b[0])));
      render(); toast(nuevo ? "Partida creada" : "Partida guardada");
    },
    (form) => {
      const sync = () => $$("fieldset[data-modo]", form).forEach((f) => (f.hidden = f.dataset.modo !== form.elements.modo.value));
      form.elements.modo.onchange = sync; sync();
    });
}

// ---------- Actividades: validación ----------
export function parsePredecesoras(txt) {
  const lista = [], errs = [];
  String(txt || "").split(";").map((s) => s.trim()).filter(Boolean).forEach((tok) => {
    const m = tok.match(/^(\S+?)(?:\s+(FI|FS|II|SS))?$/i);
    if (!m) errs.push(`La predecesora "${tok}" no tiene un formato válido (ej. CERA-0001 o CERA-0001 II).`);
    else lista.push({ id: m[1].toUpperCase(), tipo: /^(II|SS)$/i.test(m[2] || "") ? "SS" : "FS" });
  });
  return { lista, errs };
}
const predText = (arr) => (arr || []).map((x) => x.id + (x.tipo === "SS" ? " II" : "")).join("; ");

function validar(a, ids) {
  const e = [], p = S.partidas.get(a.partida);
  if (!a.nombre) e.push("falta el nombre");
  if (!p) { e.push(`la partida ${a.partida} no existe`); return e; }
  if (p.modo === "fija" && !(Number.isInteger(a.duracion) && a.duracion > 0)) e.push("la duración debe ser un número entero de días mayor que 0");
  if (p.modo === "cantidad" && !(a.cantidad > 0)) e.push(`falta la cantidad en ${p.unidad} (mayor que 0)`);
  if (p.modo === "ritmo") {
    if (a.duracion !== null && !(Number.isInteger(a.duracion) && a.duracion > 0)) e.push("la duración debe ser un número entero de días mayor que 0");
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
    const def = S.codigos.find((k) => k.codigo === c);
    if (!def) e.push(`el código ${c} ya no existe`);
    else if (!def.valores.some((x) => x.valor === v)) e.push(`el valor ${v} no existe en el código ${c}`);
  });
  return e;
}
function buscarCiclo(acts) {
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
      <span class="spacer"></span>
      ${ed ? `<button id="btn-nueva-act" class="btn btn-primary" ${parts.length ? "" : "disabled title='Crea primero una partida'"}>+ Nueva actividad</button>` : ""}
    </div>
    ${probs.length ? `<div class="issues"><span class="warn">${probs.length} problema(s) por revisar</span><ul>${probs.slice(0, 15).map((m) => `<li>${esc(m)}</li>`).join("")}${probs.length > 15 ? `<li>… y ${probs.length - 15} más</li>` : ""}</ul></div>` : ""}
    <div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>Nombre</th><th>Partida</th><th class="num">Cantidad</th><th class="num">Duración (días)</th><th>Predecesoras</th>
        ${S.codigos.map((c) => `<th title="${esc(c.descripcion || "")}">${esc(c.codigo)}</th>`).join("")}<th>Restricción</th></tr></thead>
      <tbody id="act-body"></tbody></table></div>`;
  const pintar = () => {
    const fp = $("#f-partida").value, ft = $("#f-texto").value.trim().toLowerCase();
    const filas = todas().filter((a) => (!fp || a.partida === fp) && (!ft || a.id.toLowerCase().includes(ft) || (a.nombre || "").toLowerCase().includes(ft)))
      .sort((a, b) => a.partida.localeCompare(b.partida) || a.id.localeCompare(b.id));
    $("#act-body").innerHTML = filas.map((a) => {
      const p = S.partidas.get(a.partida), dur = duracionEfectiva(a, p);
      return `<tr class="${ed ? "link" : ""}" data-id="${esc(a.id)}">
        <td class="mono">${esc(a.id)}</td><td>${esc(a.nombre)}</td>
        <td><span class="swatch" style="background:${esc(p?.color || "#808080")}"></span>${esc(a.partida)}</td>
        <td class="num">${p?.modo === "cantidad" ? fmtNum(a.cantidad) + " " + esc(p.unidad) : ""}</td>
        <td class="num">${dur ?? `<span class="warn">?</span>`}${p?.modo === "cantidad" ? ' <span class="help">calc.</span>' : ""}</td>
        <td>${esc(predText(a.predecesoras))}</td>
        ${S.codigos.map((c) => `<td>${esc(a.codigos?.[c.codigo] || "")}</td>`).join("")}
        <td>${a.restriccion?.tipo ? esc(RESTRICCIONES[a.restriccion.tipo] + " " + fechaCL(a.restriccion.fecha)) : ""}</td></tr>`;
    }).join("") || `<tr><td colspan="${7 + S.codigos.length}" class="muted">${todas().length ? "Ninguna actividad coincide con el filtro." : "Aún no hay actividades."}</td></tr>`;
    if (ed) $$("#act-body tr.link").forEach((tr) => (tr.onclick = () => modalActividad(todas().find((a) => a.id === tr.dataset.id))));
  };
  $("#f-partida").onchange = pintar; $("#f-texto").oninput = pintar;
  pintar();
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
    <label>Predecesoras<input name="predecesoras" value="${esc(predText(a.predecesoras))}" placeholder="CERA-0001; TABI-0002 II">
      <span class="help">Separadas por punto y coma. Sin sufijo = fin-inicio; con II = inicio-inicio. Desfase 0.</span></label>
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
      const { lista, errs: ePred } = parsePredecesoras(g("predecesoras")); errs.push(...ePred);
      const codigos = {};
      S.codigos.forEach((c) => { const v = g("cod:" + c.codigo); if (v) codigos[c.codigo] = v; });
      const datos = {
        ...(orig || {}), id, nombre: g("nombre"), partida,
        cantidad: p.modo === "cantidad" ? n("cantidad") : null,
        duracion: p.modo === "cantidad" ? null : n("duracion"),
        predecesoras: lista,
        restriccion: g("rTipo") ? { tipo: g("rTipo"), fecha: g("rFecha") || null } : null,
        codigos,
      };
      ["avance", "calc", "base"].forEach((k) => { if (datos[k] === undefined) datos[k] = null; });
      const resto = todasAct.filter((x) => x.id !== (orig?.id ?? id));
      const ids = new Set([...resto.map((x) => x.id), id]);
      errs.push(...validar(datos, ids).map((m) => m[0].toUpperCase() + m.slice(1) + "."));
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
        else h += `<div class="grid2"><label>Duración (días)<input name="duracion" type="number" step="1" min="1" value="${esc(prev.duracion)}" ${p.modo === "ritmo" ? 'placeholder="1"' : ""}></label>
            ${p.modo === "ritmo" ? `<p class="help" style="align-self:end">Vacía = 1 día. El inicio se desfasa según el ritmo.</p>` : "<span></span>"}</div>`;
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
      form.elements.partida.onchange = () => pintar(false);
      if (nuevo) form.elements.actid.oninput = () => (form.elements.actid.dataset.tocado = "1");
      pintar(true);
    });
}
