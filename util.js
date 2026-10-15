// Utilidades compartidas de interfaz.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const ROLES = { editor: "Editor", lector: "Lector" };
export const CALENDARIOS = { LV: "Lunes a viernes", LS: "Lunes a sábado" };
export const MODOS = { fija: "Duración fija", cantidad: "Por cantidad", ritmo: "Por ritmo" };
export const RESTRICCIONES = {
  SNET: "Inicio no antes de", FNLT: "Término no después de",
  MSO: "Inicio obligatorio", MFO: "Término obligatorio",
};
export const fmtNum = (n) => (n === null || n === undefined || n === "" ? "" : Number(n).toLocaleString("es-CL"));

export function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._h); toast._h = setTimeout(() => (t.hidden = true), 3000);
}
export function errorMsg(e) {
  console.error(e);
  if (e?.code === "permission-denied") return "No se pudo guardar: no tienes la edición del programa (expiró o la tomó otra persona) o los datos cambiaron mientras tanto. Presiona Recargar e inténtalo de nuevo.";
  return e?.message && !e.code ? e.message : "No se pudo completar la acción. Revisa tu conexión e inténtalo de nuevo.";
}
// Modal: onSubmit recibe (FormData, form). Si lanza error, se muestra y el modal sigue abierto.
export function openModal(html, onSubmit, onRender) {
  const dlg = $("#modal"), form = $("#modal-form");
  form.innerHTML = html;
  form.onsubmit = async (ev) => {
    if (ev.submitter?.value === "cancel") return;
    ev.preventDefault();
    const err = form.querySelector(".msg-error");
    if (err) err.hidden = true;
    try { if ((await onSubmit(new FormData(form), form, ev.submitter)) !== false) dlg.close(); }
    catch (e) { if (err) { err.textContent = errorMsg(e); err.hidden = false; err.scrollIntoView({ block: "nearest" }); } }
  };
  onRender?.(form);
  dlg.showModal();
}
export const closeModal = () => $("#modal").close();
