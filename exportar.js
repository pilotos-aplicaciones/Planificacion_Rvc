// Construcción del Excel de exportación.
// Las hojas Actividades, Partidas, Códigos y Calendario usan el MISMO formato que la importación,
// para poder copiar un programa (Exportar → programa nuevo → Importar). Las hojas de análisis van al final
// y la importación las ignora.
import { RESTRICCIONES } from "./util.js";
import { duracionEfectiva, relacionesRitmo } from "./cpm.js";
import { predText } from "./validacion.js";

const MODO_TXT = { fija: "Fija", cantidad: "Cantidad", ritmo: "Ritmo" };
const CAL_TXT = { LV: "Lunes a viernes", LS: "Lunes a sábado" };
// Fecha como número de serie de Excel (sin zona horaria) para evitar corrimientos de un día.
export const aFecha = (iso) => { if (!iso) return ""; const [y, m, d] = iso.split("-").map(Number); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000; };

// d: { prog, partidas (array en orden), codigos, feriados, acts (en orden), r (resultado de calcular o null), base, cal }
export function construirLibro(X, d) {
  const { prog, partidas, codigos, feriados, acts, r, base, cal } = d;
  const wb = X.utils.book_new(), pMap = Object.fromEntries(partidas.map((p) => [p.id, p]));
  const hoja = (nombre, filas, anchos, colsFecha = []) => {
    const ws = X.utils.aoa_to_sheet(filas);
    for (let i = 1; i < filas.length; i++) colsFecha.forEach((c) => {
      const cell = ws[X.utils.encode_cell({ r: i, c })];
      if (cell && cell.t === "n") cell.z = "dd-mm-yyyy";
    });
    ws["!cols"] = anchos.map((w) => ({ wch: w }));
    X.utils.book_append_sheet(wb, ws, nombre);
  };
  const cods = codigos.map((c) => c.codigo);

  // 1. Actividades (formato de importación)
  hoja("Actividades", [
    ["ID", "Nombre", "Partida", "Modo (de la partida)", "Cantidad", "Duración (días)", "Predecesoras", "Tipo restricción", "Fecha restricción", ...cods],
    ...acts.map((a) => {
      const p = pMap[a.partida];
      return [a.id, a.nombre, a.partida, MODO_TXT[p?.modo] || "", p?.modo === "cantidad" ? a.cantidad ?? "" : "",
        p?.modo === "fija" ? a.duracion ?? "" : "", predText(a.predecesoras),
        a.restriccion?.tipo ? RESTRICCIONES[a.restriccion.tipo] : "", aFecha(a.restriccion?.fecha),
        ...cods.map((c) => a.codigos?.[c] || "")];
    }),
  ], [12, 34, 9, 12, 10, 10, 30, 20, 12, ...cods.map(() => 9)], [8]);

  // 2. Partidas (formato de importación)
  hoja("Partidas", [
    ["ID partida", "Nombre", "Modo", "Unidad de medida", "Rendimiento diario", "Redondeo", "Ritmo (unid/día)", "Duración por unidad (días)", "Códigos de unidad", "Dirección de avance", "Color"],
    ...partidas.map((p) => [p.id, p.nombre, MODO_TXT[p.modo], p.modo === "cantidad" ? p.unidad || "" : "", p.modo === "cantidad" ? p.rendimiento ?? "" : "",
      p.modo === "cantidad" ? (p.redondeo === "normal" ? "Normal" : "Arriba") : "",
      p.modo === "ritmo" ? p.ritmo ?? "" : "", p.modo === "ritmo" ? p.duracionUnidad || 1 : "",
      p.modo === "ritmo" ? (p.codigosUnidad || []).join("; ") : "", p.modo === "ritmo" ? (p.direccion === "descendente" ? "Descendente" : "Ascendente") : "",
      (p.color || "").replace("#", "")]),
  ], [10, 28, 10, 10, 12, 10, 12, 14, 18, 14, 9]);

  // 3. Códigos (formato de importación)
  hoja("Códigos", [
    ["Código", "Orden", "Valor", "Descripción", "Descripción del código"],
    ...codigos.flatMap((c) => c.valores.map((v, i) => [c.codigo, i + 1, v.valor, v.descripcion || "", i === 0 ? c.descripcion || "" : ""])),
  ], [14, 7, 10, 26, 40]);

  // 4. Calendario (formato de importación: las filas se buscan por su etiqueta; los feriados van al final)
  hoja("Calendario", [
    ["Parámetro", "Valor"],
    ["Inicio del programa", aFecha(prog.fechaInicio)],
    ["Días laborales", CAL_TXT[prog.calendario] || "Lunes a viernes"],
    ["Programa (referencia)", prog.nombre || ""],
    [],
    ["Feriado", "Fecha"], ...feriados.map((f) => [f.nombre, aFecha(f.fecha)]),
  ], [22, 18], [1]);

  // 5. Resultados (análisis; no se importa)
  const ok = r && !r.errores?.length;
  hoja("Resultados", [
    ["ID", "Nombre", "Partida", "Duración (días)", "Inicio temprano", "Término temprano", "Inicio tardío", "Término tardío",
      "Holgura total", "Holgura libre", "Crítica", "Día IT (n° hábil)", "Día TT (exclusivo)",
      "Estado", "Inicio real", "Término real", "% avance", "Cantidad ejecutada", "Duración remanente",
      `Inicio base${base ? " (" + base.nombre + ")" : ""}`, "Término base", "Desviación término (días hábiles)"],
    ...acts.map((a) => {
      const x = ok ? r.res.get(a.id) : null, lb = base?.actividades?.[a.id];
      return [a.id, a.nombre, a.partida, duracionEfectiva(a, pMap[a.partida]) ?? "",
        aFecha(x?.ie), aFecha(x?.te), aFecha(x?.it), aFecha(x?.tt), x?.ht ?? "", x?.hl ?? "", x ? (x.critica ? "Sí" : "No") : "",
        x ? x.es : "", x ? x.es + x.dur : "",
        { no: "No iniciada", curso: "En curso", term: "Terminada" }[a.avance?.estado || "no"], aFecha(a.avance?.inicioReal), aFecha(a.avance?.terminoReal),
        a.avance?.pct ?? "", a.avance?.ejecutado ?? "", x ? x.rem : "",
        aFecha(lb?.[0]), aFecha(lb?.[1]), x && lb && x.te ? cal.W(x.te) - cal.W(lb[1]) : ""];
    }),
    [],
    ["Fecha de corte", prog.fechaCorte ? aFecha(prog.fechaCorte) : "Sin corte"],
    ["Término calculado", ok ? aFecha(r.termino) : "Sin calcular"],
    ["Convención", "Día 0 = primer día hábil desde la fecha de inicio. TT = IT + duración (exclusivo)."],
  ], [12, 30, 9, 9, 12, 12, 12, 12, 8, 8, 7, 9, 9, 11, 12, 12, 8, 10, 10, 12, 12, 12], [4, 5, 6, 7, 14, 15, 19, 20]);

  // 6. Relaciones (análisis; incluye las de ritmo que genera la app)
  const rel = [["Predecesora", "Sucesora", "Tipo", "Desfase (días hábiles)", "Origen"]];
  acts.forEach((a) => (a.predecesoras || []).forEach((x) => rel.push([x.id, a.id, x.tipo === "SS" ? "II" : "FI", Number(x.desfase) || 0, "Lógica (cargada)"])));
  relacionesRitmo(acts, pMap, codigos).forEach((x) => rel.push([x.de, x.a, "II", x.desfase, `Ritmo ${x.de.split("-")[0]} (automática)`]));
  hoja("Relaciones", rel, [12, 12, 6, 20, 22]);

  // 7. Días hábiles (análisis)
  if (ok) {
    const dias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
    const minimo = Math.min(0, ...[...r.res.values()].map((x) => x.ls));
    const tabla = [["Día hábil", "Fecha", "Día"]];
    for (let i = minimo; i < r.duracionTotal; i++) { const f = cal.fecha(i); tabla.push([i, aFecha(f), dias[new Date(f + "T12:00:00Z").getUTCDay()]]); }
    hoja("Días hábiles", tabla, [10, 12, 11], [1]);
  }
  return { wb, ok };
}
