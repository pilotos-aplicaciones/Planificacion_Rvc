// Lectura del Excel de carga: Partidas, Códigos, Calendario y Actividades.
// Requiere la librería global XLSX (SheetJS).
import { parsePredecesoras, validarActividad, buscarCiclo, unidadesDuplicadas, msgDuplicada } from "./validacion.js";
import { RESTRICCIONES } from "./util.js";

const txt = (v) => String(v ?? "").trim();
const num = (v) => (txt(v) === "" ? null : Number(txt(v).replace(",", ".")));
function fechaISO(v) {
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}` : null;
  }
  const m = txt(v).match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

export function leerExcel(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const errores = [], avisos = [];
  const falta = ["Actividades", "Partidas", "Códigos", "Calendario"].filter((n) => !wb.Sheets[n]);
  if (falta.length) return { errores: falta.map((n) => `Falta la hoja "${n}".`), avisos };
  const filasDe = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: "" });

  // ---- Códigos ----
  const codMap = {}, descCod = {};
  const filasCod = filasDe("Códigos");
  const tieneDescCod = filasCod.length && "Descripción del código" in filasCod[0];
  filasCod.forEach((r, i) => {
    const fila = i + 2, codigo = txt(r["Código"]), valor = txt(r["Valor"]);
    if (!codigo && !valor) return;
    if (!codigo || !valor) return errores.push(`Códigos, fila ${fila}: falta el código o el valor.`);
    if (!/^[\p{L}\p{N} _]{1,30}$/u.test(codigo)) return errores.push(`Códigos, fila ${fila}: el código "${codigo}" debe tener solo letras, números o espacios.`);
    const orden = num(r["Orden"]);
    if (orden === null || !Number.isFinite(orden)) errores.push(`Códigos, fila ${fila}: el orden debe ser un número.`);
    const lista = (codMap[codigo] ||= []);
    if (lista.some((v) => v.valor === valor)) errores.push(`Códigos, fila ${fila}: el valor "${valor}" está repetido en ${codigo}.`);
    lista.push({ valor, descripcion: txt(r["Descripción"]), orden: orden ?? 0 });
    if (tieneDescCod && txt(r["Descripción del código"]) && !descCod[codigo]) descCod[codigo] = txt(r["Descripción del código"]);
  });
  const codigos = Object.entries(codMap).map(([codigo, valores]) => ({
    codigo, descripcion: descCod[codigo] || codigo,
    valores: valores.sort((a, b) => a.orden - b.orden).map((v, i) => ({ ...v, orden: i + 1 })),
  }));
  const sinDesc = codigos.filter((c) => !descCod[c.codigo]).map((c) => c.codigo);
  if (sinDesc.length) avisos.push(`Códigos sin descripción (se usará el nombre): ${sinDesc.join(", ")}. Puedes agregar la columna "Descripción del código" o editarla después en la app.`);

  // ---- Partidas ----
  const partidas = [];
  filasDe("Partidas").forEach((r, i) => {
    const fila = i + 2, id = txt(r["ID partida"]).toUpperCase();
    if (!id && !txt(r["Nombre"])) return;
    const err = (m) => errores.push(`Partidas, fila ${fila} (${id || "sin ID"}): ${m}`);
    if (!/^[A-Z0-9_]{1,12}$/.test(id)) err("el ID debe tener de 1 a 12 letras o números, sin guiones ni espacios.");
    if (partidas.some((p) => p.id === id)) err("el ID está repetido.");
    const nombre = txt(r["Nombre"]); if (!nombre) err("falta el nombre.");
    const modo = { fija: "fija", cantidad: "cantidad", ritmo: "ritmo" }[txt(r["Modo"]).toLowerCase()];
    if (!modo) err('el modo debe ser "Fija", "Cantidad" o "Ritmo".');
    const p = { id, nombre, modo: modo || "fija", unidad: null, rendimiento: null, redondeo: null, ritmo: null, codigosUnidad: [], direccion: null, color: "#808080" };
    if (modo === "cantidad") {
      p.unidad = txt(r["Unidad de medida"]); if (!p.unidad) err("falta la unidad de medida.");
      p.rendimiento = num(r["Rendimiento diario"]); if (!(p.rendimiento > 0)) err("el rendimiento diario debe ser mayor que 0.");
      p.redondeo = txt(r["Redondeo"]).toLowerCase() === "normal" ? "normal" : "arriba";
    }
    if (modo === "ritmo") {
      p.ritmo = num(r["Ritmo (unid/día)"]); if (!(p.ritmo > 0)) err("el ritmo debe ser mayor que 0.");
      p.codigosUnidad = txt(r["Códigos de unidad"]).split(";").map(txt).filter(Boolean);
      if (!p.codigosUnidad.length) err("faltan los códigos de unidad (ej. Piso; Depto).");
      p.codigosUnidad.forEach((c) => { if (!codMap[c]) err(`el código de unidad "${c}" no existe en la hoja Códigos.`); });
      p.direccion = txt(r["Dirección de avance"]).toLowerCase() === "descendente" ? "descendente" : "ascendente";
      p.duracionUnidad = num(r["Duración por unidad (días)"]) ?? 1;
      if (!(Number.isInteger(p.duracionUnidad) && p.duracionUnidad >= 1)) err("la duración por unidad debe ser un número entero de días mayor o igual a 1.");
    }
    const color = txt(r["Color"]).replace("#", "");
    if (color) { if (/^[0-9A-Fa-f]{6}$/.test(color)) p.color = "#" + color.toUpperCase(); else err("el color debe tener 6 caracteres (ej. 2E75B6)."); }
    p.orden = partidas.length + 1;
    partidas.push(p);
  });
  if (!partidas.length) errores.push("La hoja Partidas no tiene partidas.");

  // ---- Calendario ----
  const filasCal = XLSX.utils.sheet_to_json(wb.Sheets["Calendario"], { header: 1, defval: "" });
  const valorDe = (etq) => filasCal.find((f) => txt(f[0]) === etq)?.[1];
  const fechaInicio = fechaISO(valorDe("Inicio del programa"));
  if (!fechaInicio) errores.push('Calendario: falta o no es válida la fecha de "Inicio del programa".');
  const calendario = { "lunes a viernes": "LV", "lunes a sábado": "LS" }[txt(valorDe("Días laborales")).toLowerCase()];
  if (!calendario) errores.push('Calendario: "Días laborales" debe ser "Lunes a viernes" o "Lunes a sábado".');
  const feriados = [];
  const iFer = filasCal.findIndex((f) => txt(f[0]) === "Feriado");
  if (iFer >= 0) filasCal.slice(iFer + 1).forEach((f, k) => {
    if (!txt(f[0]) && !txt(f[1])) return;
    const fecha = fechaISO(f[1]);
    if (!fecha) errores.push(`Calendario, fila ${iFer + k + 2}: la fecha de "${txt(f[0])}" no es válida.`);
    else if (!feriados.some((x) => x.fecha === fecha)) feriados.push({ nombre: txt(f[0]) || "Feriado", fecha });
  });
  feriados.sort((a, b) => a.fecha.localeCompare(b.fecha));

  // ---- Actividades ----
  const restrPorNombre = Object.fromEntries(Object.entries(RESTRICCIONES).map(([k, v]) => [v.toLowerCase(), k]));
  const actividades = [], filaDe = {};
  const filasAct = filasDe("Actividades");
  const cols = filasAct.length ? Object.keys(filasAct[0]) : [];
  const colsCod = codigos.map((c) => c.codigo).filter((c) => cols.includes(c));
  const conocidas = new Set(["ID", "Nombre", "Partida", "Modo (de la partida)", "Cantidad", "Duración (días)", "Predecesoras", "Tipo restricción", "Fecha restricción", ...colsCod]);
  const ignoradas = cols.filter((c) => !conocidas.has(c) && !c.startsWith("__EMPTY"));
  if (ignoradas.length) avisos.push(`Actividades: columnas que no son códigos y se ignoran: ${ignoradas.join(", ")}.`);
  filasAct.forEach((r, i) => {
    const fila = i + 2, id = txt(r["ID"]).toUpperCase();
    if (!id && !txt(r["Nombre"])) return;
    const err = (m) => errores.push(`Actividades, fila ${fila} (${id || "sin ID"}): ${m}`);
    if (!/^[A-Z0-9_]{1,12}-\d{4}$/.test(id)) err("el ID debe ser partida + guion + 4 dígitos (ej. PINT-0001).");
    if (filaDe[id]) err(`el ID está repetido (también en la fila ${filaDe[id]}).`);
    filaDe[id] = fila;
    const { lista, errs } = parsePredecesoras(r["Predecesoras"]); errs.forEach(err);
    const tipoR = txt(r["Tipo restricción"]);
    let restriccion = null;
    if (tipoR) {
      const t = restrPorNombre[tipoR.toLowerCase()];
      if (!t) err(`el tipo de restricción "${tipoR}" no es válido.`);
      else restriccion = { tipo: t, fecha: fechaISO(r["Fecha restricción"]) };
    }
    const codigosA = {};
    colsCod.forEach((c) => { const v = txt(r[c]); if (v) codigosA[c] = v; });
    const dur = num(r["Duración (días)"]);
    actividades.push({ id, nombre: txt(r["Nombre"]), partida: txt(r["Partida"]).toUpperCase(),
      cantidad: num(r["Cantidad"]), duracion: dur, predecesoras: lista, restriccion, codigos: codigosA,
      avance: null, calc: null, base: null });
  });
  if (!actividades.length) errores.push("La hoja Actividades no tiene actividades.");

  // Validación de conjunto (mismas reglas que la edición manual)
  const pMap = new Map(partidas.map((p) => [p.id, p]));
  const ids = new Set(actividades.map((a) => a.id));
  const cantIgnorada = [], durIgnorada = [];
  actividades.forEach((a) => {
    const p = pMap.get(a.partida);
    if (p?.modo === "cantidad") a.duracion = null;
    if (p && p.modo !== "cantidad" && a.cantidad !== null) cantIgnorada.push(filaDe[a.id]);
    if (p?.modo !== "cantidad") a.cantidad = null;
    if (p?.modo === "ritmo") { if (a.duracion !== null) durIgnorada.push(filaDe[a.id]); a.duracion = null; }
    validarActividad(a, ids, (pid) => pMap.get(pid), codigos)
      .forEach((m) => errores.push(`Actividades, fila ${filaDe[a.id]} (${a.id}): ${m}.`));
  });
  if (cantIgnorada.length) avisos.push(`Se ignora la cantidad en ${cantIgnorada.length} actividad(es) de partidas fijas o por ritmo, porque no se usa (filas ${cantIgnorada.slice(0, 10).join(", ")}${cantIgnorada.length > 10 ? "…" : ""}).`);
  if (durIgnorada.length) avisos.push(`Se ignora la duración en ${durIgnorada.length} actividad(es) de partidas por ritmo: la define la partida ("Duración por unidad (días)", 1 si no se indica). Filas ${durIgnorada.slice(0, 10).join(", ")}${durIgnorada.length > 10 ? "…" : ""}.`);
  const ciclo = buscarCiclo(actividades);
  if (ciclo) errores.push(`Ciclo lógico entre predecesoras: ${ciclo.join(" → ")}.`);
  unidadesDuplicadas(actividades, (pid) => pMap.get(pid))
    .forEach((d) => errores.push(`Actividades, fila ${filaDe[d.id]}: ${msgDuplicada(d)}. Cada unidad va una sola vez por partida.`));

  return { errores, avisos, partidas, codigos, actividades, programa: { fechaInicio, calendario }, feriados };
}
