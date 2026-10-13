// App de Planificación RVC – núcleo: acceso, navegación, lista de programas y usuarios.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, addDoc, collection, getDocs, query, where, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { $, $$, esc, ROLES, CALENDARIOS, toast, errorMsg, openModal } from "./util.js";
import { viewPrograma, resetPrograma } from "./programa.js";

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);
const ctx = { db, me: null, loadUsuarios };

$("#btn-login").onclick = async () => {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (e) { const el = $("#login-error"); el.textContent = "No se pudo ingresar: " + (e.code || e.message); el.hidden = false; }
};
$("#btn-logout").onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  if (!user) { ctx.me = null; $("#app").hidden = true; $("#login").hidden = false; return; }
  try {
    const ref = doc(db, "usuarios", user.uid);
    let snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { nombre: user.displayName || user.email, email: user.email, admin: false, creado: serverTimestamp() });
      snap = await getDoc(ref);
    }
    ctx.me = { uid: user.uid, ...snap.data() };
  } catch (e) { $("#login-error").textContent = errorMsg(e); $("#login-error").hidden = false; return; }
  const me = ctx.me;
  $("#login").hidden = true; $("#app").hidden = false;
  $("#user-name").textContent = me.nombre;
  $("#user-admin").hidden = !me.admin;
  $$(".admin-only").forEach((el) => (el.hidden = !me.admin));
  route();
});

window.addEventListener("hashchange", route);
function route() {
  const me = ctx.me; if (!me) return;
  const [view, id, tab] = (location.hash.slice(1) || "programas").split("/");
  $$(".nav-item").forEach((a) => a.classList.toggle("active", a.dataset.view === (view === "programa" ? "programas" : view)));
  $("#fab").hidden = !(me.admin && view === "programas");
  if (view === "usuarios" && me.admin) { resetPrograma(); return viewUsuarios(); }
  if (view === "programa" && id) return viewPrograma(ctx, id, tab || "resumen");
  resetPrograma();
  return viewProgramas();
}

async function loadUsuarios() {
  const snap = await getDocs(collection(db, "usuarios"));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() })).sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
}

// ---------- Lista de programas ----------
async function viewProgramas() {
  const me = ctx.me, main = $("#main");
  main.innerHTML = `<div class="page-head"><div><h1>Programas</h1><p>Programas de obra a los que tienes acceso.</p></div></div><p>Cargando…</p>`;
  try {
    const q = me.admin ? collection(db, "programas")
      : query(collection(db, "programas"), where("miembrosUids", "array-contains", me.uid));
    const progs = (await getDocs(q)).docs.map((d) => ({ id: d.id, ...d.data() }));
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
          }).join("")}</tbody></table></div></section>`).join("");
    $$("tr.link", main).forEach((tr) => (tr.onclick = () => (location.hash = "programa/" + tr.dataset.id)));
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
    const me = ctx.me;
    const ref = await addDoc(collection(db, "programas"), {
      ...Object.fromEntries(fd.entries()), estado: "activo", programaTipo: null,
      miembros: { [me.uid]: "editor" }, miembrosUids: [me.uid], creado: serverTimestamp(), creadoPor: me.uid,
    });
    toast("Programa creado");
    location.hash = "programa/" + ref.id;
  });

// ---------- Usuarios (solo admin) ----------
async function viewUsuarios() {
  const me = ctx.me, main = $("#main");
  main.innerHTML = `<div class="page-head"><div><h1>Usuarios</h1><p>Personas que han ingresado a la app. Los roles por programa se asignan dentro de cada programa.</p></div></div><p>Cargando…</p>`;
  try {
    const us = await loadUsuarios();
    main.lastElementChild.outerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Nombre</th><th>Email</th><th>Administrador</th></tr></thead>
      <tbody>${us.map((u) => `<tr><td>${esc(u.nombre)}</td><td>${esc(u.email)}</td><td>
        ${u.uid === me.uid ? `<span class="badge badge-editor">Tú</span>`
          : `<label><input type="checkbox" class="chk-admin" data-uid="${esc(u.uid)}" ${u.admin ? "checked" : ""}> Administrador</label>`}
      </td></tr>`).join("")}</tbody></table></div>`;
    $$(".chk-admin", main).forEach((c) => (c.onchange = async () => {
      try { await updateDoc(doc(db, "usuarios", c.dataset.uid), { admin: c.checked }); toast(c.checked ? "Ahora es administrador" : "Ya no es administrador"); }
      catch (e) { c.checked = !c.checked; toast(errorMsg(e)); }
    }));
  } catch (e) { main.lastElementChild.outerHTML = `<p class="msg-error">${esc(errorMsg(e))}</p>`; }
}
