// App de Planificación RVC – Sesión 3: acceso, usuarios, roles y programas (base).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, getDocs,
  query, where, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ROLES = { editor: "Editor", lector: "Lector" };
const CALENDARIOS = { LV: "Lunes a viernes", LS: "Lunes a sábado" };

let me = null;          // { uid, nombre, email, admin }
let usuariosCache = []; // solo admin

// ---------- Utilidades de interfaz ----------
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._h); toast._h = setTimeout(() => (t.hidden = true), 2800);
}
function errorMsg(e) {
  console.error(e);
  if (e?.code === "permission-denied") return "No tienes permiso para esta acción.";
  return "No se pudo completar la acción. Revisa tu conexión e inténtalo de nuevo.";
}
function openModal(html, onSubmit) {
  const dlg = $("#modal"), form = $("#modal-form");
  form.innerHTML = html;
  form.onsubmit = async (ev) => {
    if (ev.submitter?.value === "cancel") return; // cierra sin guardar
    ev.preventDefault();
    const err = form.querySelector(".msg-error");
    try { await onSubmit(new FormData(form)); dlg.close(); }
    catch (e) { if (err) { err.textContent = e.message || errorMsg(e); err.hidden = false; } }
  };
  dlg.showModal();
}

// ---------- Acceso ----------
$("#btn-login").onclick = async () => {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (e) { const el = $("#login-error"); el.textContent = "No se pudo ingresar: " + (e.code || e.message); el.hidden = false; }
};
$("#btn-logout").onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  if (!user) { me = null; $("#app").hidden = true; $("#login").hidden = false; return; }
  try {
    const ref = doc(db, "usuarios", user.uid);
    let snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { nombre: user.displayName || user.email, email: user.email, admin: false, creado: serverTimestamp() });
      snap = await getDoc(ref);
    }
    me = { uid: user.uid, ...snap.data() };
  } catch (e) {
    $("#login-error").textContent = errorMsg(e); $("#login-error").hidden = false; return;
  }
  $("#login").hidden = true; $("#app").hidden = false;
  $("#user-name").textContent = me.nombre;
  $("#user-admin").hidden = !me.admin;
  document.querySelectorAll(".admin-only").forEach((el) => (el.hidden = !me.admin));
  route();
});

// ---------- Navegación ----------
window.addEventListener("hashchange", route);
function route() {
  if (!me) return;
  const [view, id] = (location.hash.slice(1) || "programas").split("/");
  document.querySelectorAll(".nav-item").forEach((a) =>
    a.classList.toggle("active", a.dataset.view === (view === "programa" ? "programas" : view)));
  $("#fab").hidden = !(me.admin && view === "programas");
  if (view === "usuarios" && me.admin) return viewUsuarios();
  if (view === "programa" && id) return viewPrograma(id);
  return viewProgramas();
}

// ---------- Programas ----------
async function loadUsuarios() {
  const snap = await getDocs(collection(db, "usuarios"));
  usuariosCache = snap.docs.map((d) => ({ uid: d.id, ...d.data() }))
    .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
  return usuariosCache;
}

async function viewProgramas() {
  const main = $("#main");
  main.innerHTML = `<div class="page-head"><div><h1>Programas</h1><p>Programas de obra a los que tienes acceso.</p></div></div><p>Cargando…</p>`;
  try {
    const q = me.admin ? collection(db, "programas")
      : query(collection(db, "programas"), where("miembrosUids", "array-contains", me.uid));
    const snap = await getDocs(q);
    const progs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (!progs.length) {
      main.lastElementChild.outerHTML = me.admin
        ? `<div class="empty"><strong>Aún no hay programas</strong>Crea el primero con el botón "Nuevo programa".</div>`
        : `<div class="empty"><strong>No tienes programas asignados</strong>Pide al administrador que te agregue como editor o lector de un programa.</div>`;
      return;
    }
    const grupos = {};
    progs.forEach((p) => (grupos[p.proyecto || "Sin proyecto"] ||= []).push(p));
    main.lastElementChild.outerHTML = Object.keys(grupos).sort().map((proy) => `
      <section class="group"><h3>${esc(proy)}</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Etapa</th><th>Programa</th><th>Inicio</th><th>Tu rol</th></tr></thead>
          <tbody>${grupos[proy].sort((a, b) => (a.etapa || "").localeCompare(b.etapa || "")).map((p) => {
            const rol = p.miembros?.[me.uid];
            const badge = rol ? `<span class="badge badge-${rol}">${ROLES[rol]}</span>` : `<span class="badge badge-lector">Administrador</span>`;
            return `<tr class="link" data-id="${esc(p.id)}"><td>${esc(p.etapa)}</td><td>${esc(p.nombre)}</td><td>${esc(p.fechaInicio)}</td><td>${badge}</td></tr>`;
          }).join("")}</tbody>
        </table></div>
      </section>`).join("");
    main.querySelectorAll("tr.link").forEach((tr) => (tr.onclick = () => (location.hash = "programa/" + tr.dataset.id)));
  } catch (e) { main.lastElementChild.outerHTML = `<p class="msg-error">${esc(errorMsg(e))}</p>`; }
}

$("#fab").onclick = () => openModal(`
  <h2>Nuevo programa</h2>
  <label>Proyecto RVC<input name="proyecto" required maxlength="80" placeholder="Ej. Edificio Los Aromos"></label>
  <label>Etapa<input name="etapa" required maxlength="40" placeholder="Ej. Etapa 1"></label>
  <label>Nombre del programa<input name="nombre" required maxlength="80" placeholder="Ej. Programa de obra"></label>
  <label>Fecha de inicio<input name="fechaInicio" type="date" required></label>
  <label>Calendario<select name="calendario">${Object.entries(CALENDARIOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
  <p class="msg-error" hidden></p>
  <div class="modal-actions"><button class="btn btn-secondary" value="cancel" formnovalidate>Cancelar</button><button class="btn btn-primary">Crear programa</button></div>`,
  async (fd) => {
    const data = Object.fromEntries(fd.entries());
    const ref = await addDoc(collection(db, "programas"), {
      ...data, estado: "activo", programaTipo: null,
      miembros: { [me.uid]: "editor" }, miembrosUids: [me.uid],
      creado: serverTimestamp(), creadoPor: me.uid,
    });
    toast("Programa creado");
    location.hash = "programa/" + ref.id;
  });

async function viewPrograma(id) {
  const main = $("#main");
  main.innerHTML = `<a href="#programas" class="back">‹ Programas</a><p>Cargando…</p>`;
  let p;
  try {
    const snap = await getDoc(doc(db, "programas", id));
    if (!snap.exists()) { main.lastElementChild.outerHTML = `<p class="msg-error">El programa no existe o fue eliminado.</p>`; return; }
    p = { id, ...snap.data() };
    if (me.admin) await loadUsuarios();
  } catch (e) { main.lastElementChild.outerHTML = `<p class="msg-error">${esc(errorMsg(e))}</p>`; return; }

  const miRol = p.miembros?.[me.uid];
  const nombreDe = (uid) => usuariosCache.find((u) => u.uid === uid) || { nombre: uid, email: "" };
  const filas = Object.entries(p.miembros || {}).map(([uid, rol]) => {
    const u = nombreDe(uid);
    const ctrl = me.admin
      ? `<select data-uid="${esc(uid)}" class="sel-rol">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === rol ? "selected" : ""}>${v}</option>`).join("")}</select>
         <button class="btn btn-danger btn-quitar" data-uid="${esc(uid)}">Quitar</button>`
      : `<span class="badge badge-${rol}">${ROLES[rol]}</span>`;
    return `<tr><td>${esc(u.nombre)}</td><td>${esc(u.email)}</td><td>${ctrl}</td></tr>`;
  }).join("");

  const disponibles = usuariosCache.filter((u) => !p.miembros?.[u.uid]);
  main.innerHTML = `
    <a href="#programas" class="back">‹ Programas</a>
    <div class="page-head"><div><h1>${esc(p.nombre)}</h1><p>${esc(p.proyecto)} · ${esc(p.etapa)}</p></div>
      <span class="badge ${miRol ? "badge-" + miRol : "badge-lector"}">${miRol ? ROLES[miRol] : "Administrador"}</span></div>
    <dl class="meta">
      <div><dt>Fecha de inicio</dt><dd>${esc(p.fechaInicio)}</dd></div>
      <div><dt>Calendario</dt><dd>${esc(CALENDARIOS[p.calendario] || p.calendario)}</dd></div>
      <div><dt>Estado</dt><dd><span class="badge badge-ok">${esc(p.estado)}</span></dd></div>
      <div><dt>Programa tipo</dt><dd>${p.programaTipo ? esc(p.programaTipo.nombre) : "Sin asignar"}</dd></div>
    </dl>
    <h2>Miembros</h2>
    <div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Email</th><th>Rol</th></tr></thead><tbody>${filas || `<tr><td colspan="3">Sin miembros.</td></tr>`}</tbody></table></div>
    ${me.admin ? `<div class="row-actions">
        <select id="nuevo-miembro"><option value="">Agregar usuario…</option>${disponibles.map((u) => `<option value="${esc(u.uid)}">${esc(u.nombre)} (${esc(u.email)})</option>`).join("")}</select>
        <select id="nuevo-rol">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        <button id="btn-agregar" class="btn btn-primary">Agregar</button>
      </div>
      <p style="color:var(--muted);font-size:.9rem">¿No aparece la persona? Debe ingresar una vez a la app con su cuenta Google para quedar registrada.</p>
      <div class="row-actions" style="margin-top:32px"><button id="btn-eliminar" class="btn btn-danger">Eliminar programa</button></div>` : ""}`;

  if (!me.admin) return;
  const guardarMiembros = async (miembros) => {
    await updateDoc(doc(db, "programas", id), { miembros, miembrosUids: Object.keys(miembros) });
  };
  main.querySelectorAll(".sel-rol").forEach((s) => (s.onchange = async () => {
    try { await guardarMiembros({ ...p.miembros, [s.dataset.uid]: s.value }); toast("Rol actualizado"); viewPrograma(id); }
    catch (e) { toast(errorMsg(e)); }
  }));
  main.querySelectorAll(".btn-quitar").forEach((b) => (b.onclick = async () => {
    const u = nombreDe(b.dataset.uid);
    if (!confirm(`¿Quitar a ${u.nombre} de este programa?`)) return;
    const m = { ...p.miembros }; delete m[b.dataset.uid];
    try { await guardarMiembros(m); toast("Miembro quitado"); viewPrograma(id); } catch (e) { toast(errorMsg(e)); }
  }));
  $("#btn-agregar").onclick = async () => {
    const uid = $("#nuevo-miembro").value; if (!uid) return toast("Elige un usuario");
    try { await guardarMiembros({ ...p.miembros, [uid]: $("#nuevo-rol").value }); toast("Miembro agregado"); viewPrograma(id); }
    catch (e) { toast(errorMsg(e)); }
  };
  $("#btn-eliminar").onclick = async () => {
    const txt = prompt(`Esta acción no se puede deshacer.\nEscribe el nombre del programa para eliminarlo:\n${p.nombre}`);
    if (txt !== p.nombre) { if (txt !== null) toast("El nombre no coincide; no se eliminó"); return; }
    try { await deleteDoc(doc(db, "programas", id)); toast("Programa eliminado"); location.hash = "programas"; }
    catch (e) { toast(errorMsg(e)); }
  };
}

// ---------- Usuarios (solo admin) ----------
async function viewUsuarios() {
  const main = $("#main");
  main.innerHTML = `<div class="page-head"><div><h1>Usuarios</h1><p>Personas que han ingresado a la app. Los roles por programa se asignan dentro de cada programa.</p></div></div><p>Cargando…</p>`;
  try {
    const us = await loadUsuarios();
    main.lastElementChild.outerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Nombre</th><th>Email</th><th>Administrador</th></tr></thead>
      <tbody>${us.map((u) => `<tr><td>${esc(u.nombre)}</td><td>${esc(u.email)}</td><td>
        ${u.uid === me.uid ? `<span class="badge badge-editor">Tú</span>`
          : `<label><input type="checkbox" class="chk-admin" data-uid="${esc(u.uid)}" ${u.admin ? "checked" : ""}> Administrador</label>`}
      </td></tr>`).join("")}</tbody></table></div>`;
    main.querySelectorAll(".chk-admin").forEach((c) => (c.onchange = async () => {
      try { await updateDoc(doc(db, "usuarios", c.dataset.uid), { admin: c.checked }); toast(c.checked ? "Ahora es administrador" : "Ya no es administrador"); }
      catch (e) { c.checked = !c.checked; toast(errorMsg(e)); }
    }));
  } catch (e) { main.lastElementChild.outerHTML = `<p class="msg-error">${esc(errorMsg(e))}</p>`; }
}
