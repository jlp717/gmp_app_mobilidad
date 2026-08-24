'use strict';

/** Deterministic suggestion based on DB2 delivery windows and coordinates. */
const { parseCrutHour, preferredStartMinute, buildWindowLabel, isClosedOnDate, formatMinuteLabel } = require('../services/repartidor-rutero-orden-service');

const STRATEGIES = new Set(['windows_first', 'balanced', 'distance_first']);
const DEFAULT_SERVICE_MINUTES = 8;
const DEFAULT_AVG_KMH = 32;

function resolveDepartureMinute(options = {}) {
  const raw = options.departureMinute ?? process.env.RUTERO_DEPARTURE_MINUTE;
  if (raw === undefined || raw === null || raw === '') return null;
  const minute = Number(raw);
  return Number.isInteger(minute) && minute >= 0 && minute < 1440 ? minute : null;
}
function validCoordinate(value, min, max) { return Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max; }
function isValidSpain(lat,lng){ return Number.isFinite(lat) && Number.isFinite(lng) && lat>=27 && lat<=44 && lng>=-18 && lng<=5; }
function normalizeOrigin(origin) {
  if (!origin || !validCoordinate(origin.lat, -90, 90) || !validCoordinate(origin.lng, -180, 180)) return null;
  return { lat: Number(origin.lat), lng: Number(origin.lng) };
}
function haversineKm(lat1, lng1, lat2, lng2) {
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
  const rad = (v) => (v * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function averageKmh(value) {
  const speed = Number(value ?? process.env.RUTERO_ROUTE_AVG_KMH);
  return Number.isFinite(speed) && speed >= 8 && speed <= 120 ? speed : DEFAULT_AVG_KMH;
}
function estimateTravelMinutes(distanceKm, speed = DEFAULT_AVG_KMH) {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return null;
  return Math.max(1, Math.round((distanceKm / averageKmh(speed)) * 60));
}
function geoForStop(stop, geoByCliente) {
  if (validCoordinate(stop?.lat, -90, 90) && validCoordinate(stop?.lng, -180, 180)) return { lat: Number(stop.lat), lng: Number(stop.lng) };
  return normalizeOrigin(geoByCliente instanceof Map ? geoByCliente.get(String(stop?.cliente || '').trim()) : null);
}
function tie(a, b) { return String(a.documentId).localeCompare(String(b.documentId)) || a.originalIndex - b.originalIndex; }
function inf(value) { return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY; }
function makeStop(stop, originalIndex, dateYmd, windowsByCliente, geoByCliente) {
  const cliente = String(stop?.cliente || stop?.clienteCodigo || stop?.codigoCliente || '').trim();
  const window = windowsByCliente.get(cliente) || stop?.window || null;
  const geo = geoForStop({ ...stop, cliente }, geoByCliente);
  return { documentId: String(stop?.documentId || stop?.id || '').trim(), cliente: cliente || null, originalIndex, geo, lat: geo?.lat ?? null, lng: geo?.lng ?? null, hasGps: Boolean(geo) && isValidSpain(geo?.lat, geo?.lng), closedDay: isClosedOnDate(window, dateYmd), startMinute: preferredStartMinute(window), endMinute: parseCrutHour(window?.horaRepartoHasta ?? window?.HORAREPARTOHASTA), preferredMinute: preferredStartMinute(window), windowLabel: buildWindowLabel(window), observaciones: String(window?.observacionesReparto || window?.OBSERVACIONESREPARTO || stop?.observaciones || '').trim() || null };
}
function project(stop, state, options) {
  const distanceKm = state.cursor && stop.geo ? haversineKm(state.cursor.lat, state.cursor.lng, stop.geo.lat, stop.geo.lng) : null;
  const travelMinutes = estimateTravelMinutes(distanceKm, options.avgKmh);
  const etaMinute = state.clock !== null && travelMinutes !== null ? state.clock + travelMinutes : null;
  const waitMinutes = etaMinute !== null && stop.startMinute !== null ? Math.max(0, stop.startMinute - etaMinute) : 0;
  const latenessMinutes = etaMinute !== null && stop.endMinute !== null ? Math.max(0, etaMinute - stop.endMinute) : 0;
  return { ...stop, distanceKmFromPrev: distanceKm === null ? null : Math.round(distanceKm * 100) / 100, travelMinutesFromPrev: travelMinutes, etaMinute, etaLabel: formatMinuteLabel(etaMinute), waitMinutes, late: latenessMinutes > 0, latenessMinutes, feasible: !stop.closedDay && latenessMinutes === 0, conflict: stop.closedDay || latenessMinutes > 0, _nextClock: etaMinute === null ? null : etaMinute + waitMinutes + options.serviceMinutes };
}
function comparator(strategy) {
  return (a, b) => {
    const feasible = (a.projected.feasible ? 0 : 1) - (b.projected.feasible ? 0 : 1);
    const late = inf(a.projected.latenessMinutes) - inf(b.projected.latenessMinutes);
    const deadline = inf(a.stop.endMinute) - inf(b.stop.endMinute);
    const start = inf(a.stop.startMinute) - inf(b.stop.startMinute);
    const travel = inf(a.projected.travelMinutesFromPrev) - inf(b.projected.travelMinutesFromPrev);
    const wait = inf(a.projected.waitMinutes) - inf(b.projected.waitMinutes);
    if (strategy === 'distance_first') return feasible || travel || deadline || start || tie(a.stop, b.stop);
    if (strategy === 'windows_first') return late || deadline || start || travel || tie(a.stop, b.stop);
    return feasible || late || wait || travel || deadline || start || tie(a.stop, b.stop);
  };
}
function reason(row, position, options) {
  const out = [];
  if (row.closedDay) out.push('Cliente cerrado en esta fecha; se conserva al final sin programar entrega');
  if (!options.origin) out.push('Sin punto de salida: no se puede estimar el primer tramo');
  if (!row.hasGps) out.push('Sin coordenadas del cliente: distancia y ETA no disponibles');
  if (row.windowLabel) out.push(`Ventana ${row.windowLabel}`);
  if (row.waitMinutes > 0) out.push(`Espera ${row.waitMinutes} min hasta la apertura`);
  if (row.late) out.push(`Fuera de ventana por ${row.latenessMinutes} min`);
  if (position === 0 && out.length === 0) out.push('Primera parada según el criterio elegido');
  return out.length ? out.join('. ') : 'Ordenado por horario y distancia al punto anterior';
}
function optionsFor(raw = {}) {
  const origin = normalizeOrigin(raw.origin);
  return { origin, departureMinute: resolveDepartureMinute(raw), serviceMinutes: Number.isInteger(Number(raw.serviceMinutes)) ? Math.max(1, Math.min(120, Number(raw.serviceMinutes))) : DEFAULT_SERVICE_MINUTES, avgKmh: averageKmh(raw.avgKmh) };
}
function finalize(row, posicion, options) {
  const { _nextClock, ...visible } = row;
  return { ...visible, posicion, departureMinute: options.departureMinute, departureLabel: formatMinuteLabel(options.departureMinute), reason: reason(visible, posicion, options) };
}

function totalDistanceKm(orden, origin){
  let total=0; let prev=origin;
  for(const r of orden){
    if(prev && r.geo) { const d=haversineKm(prev.lat, prev.lng, r.geo.lat, r.geo.lng); if(d!=null) total+=d; prev=r.geo; }
    else if(r.geo) prev=r.geo;
  }
  return total;
}
function twoOpt(orden, options){
  if(orden.length < 4) return orden;
  let best=[...orden];
  let improved=true; let iter=0;
  while(improved && iter<2){
    improved=false; iter++;
    const baseDist=totalDistanceKm(best, options.origin);
    const baseLates=best.filter(r=>r.late).length;
    for(let i=0;i<best.length-2;i++){
      for(let k=i+2;k<best.length;k++){
        if(best[i].closedDay || best[k].closedDay) continue;
        const cand=[...best];
        const segment=cand.slice(i+1,k+1).reverse();
        cand.splice(i+1, k-i, ...segment);
        // Recompute timeline for candidate to validate windows
        let state={cursor: options.origin, clock: options.departureMinute};
        let candLate=0; let candDist=0; let prev=options.origin;
        let feasible=true;
        for(const r of cand){
          if(r.closedDay) continue;
          const dist= prev && r.geo ? haversineKm(prev.lat, prev.lng, r.geo.lat, r.geo.lng) : null;
          const travel=estimateTravelMinutes(dist, options.avgKmh);
          const eta= state.clock!==null && travel!==null ? state.clock+travel : null;
          const lateMin= eta!==null && r.endMinute!==null ? Math.max(0, eta - r.endMinute) : 0;
          if(lateMin>0) candLate++;
          if(dist!=null) candDist+=dist;
          const wait= eta!==null && r.startMinute!==null ? Math.max(0, r.startMinute-eta) : 0;
          state={cursor: r.geo || state.cursor, clock: eta===null?null:eta+wait+options.serviceMinutes};
          if(r.geo) prev=r.geo;
        }
        if(candLate <= baseLates && candDist < baseDist - 0.05){
          best=cand; improved=true; break;
        }
      }
      if(improved) break;
    }
  }
  return best;
}

function optimizeStopsHybrid(stops, dateYmd, windowsByCliente = new Map(), rawOptions = {}) {
  const strategy = STRATEGIES.has(rawOptions.strategy) ? rawOptions.strategy : 'balanced';
  const options = optionsFor(rawOptions);
  const geoByCliente = rawOptions.geoByCliente instanceof Map ? rawOptions.geoByCliente : new Map();
  const candidates = (Array.isArray(stops) ? stops : []).map((stop, index) => makeStop(stop, index, dateYmd, windowsByCliente, geoByCliente));
  const remaining = candidates.filter((stop) => !stop.closedDay);
  const closed = candidates.filter((stop) => stop.closedDay).sort(tie);
  const result = [];
  let state = { cursor: options.origin, clock: options.departureMinute };
  while (remaining.length) {
    const projected = remaining.map((stop) => ({ stop, projected: project(stop, state, options) })).sort(comparator(strategy));
    const selected = projected[0];
    result.push(selected.projected);
    remaining.splice(remaining.indexOf(selected.stop), 1);
    state = { cursor: selected.stop.geo || state.cursor, clock: selected.projected._nextClock };
  }
  for (const stop of closed) result.push(project(stop, state, options));
  return result.map((row, index) => finalize(row, index, options));
}
function annotateRouteTimeline(stops, rawOptions = {}) {
  const options = optionsFor(rawOptions);
  let state = { cursor: options.origin, clock: options.departureMinute };
  return (Array.isArray(stops) ? stops : []).map((raw, index) => {
    const geo = geoForStop(raw, new Map());
    const stop = { ...raw, originalIndex: Number.isInteger(raw.originalIndex) ? raw.originalIndex : index, geo, lat: geo?.lat ?? raw.lat ?? null, lng: geo?.lng ?? raw.lng ?? null, hasGps: Boolean(geo), startMinute: raw.startMinute ?? raw.preferredMinute ?? null, endMinute: raw.endMinute ?? null, closedDay: Boolean(raw.closedDay) };
    const row = project(stop, state, options);
    state = { cursor: geo || state.cursor, clock: row._nextClock };
    return finalize(row, index, options);
  });
}
function buildRouteExplanation(orden, rawOptions = {}) {
  const total = orden.length;
  const withGps = orden.filter((row) => row.hasGps).length;
  const estimatedKm = Math.round(orden.reduce((sum, row) => sum + (row.distanceKmFromPrev || 0), 0) * 100) / 100;
  const estimatedEnd = [...orden].reverse().find((row) => row.etaMinute !== null)?.etaMinute ?? null;
  const conflicts = orden.filter((row) => row.conflict).length;
  const missingMsg= total-withGps>0 ? `${total-withGps} sin GPS (revisa direcciones, pide alta)` : 'Todas con GPS';
  const stratLabel= rawOptions.strategy==='distance_first' ? 'Prioridad: menos km' : rawOptions.strategy==='windows_first' ? 'Prioridad: horarios cliente' : 'Equilibrada: horario + distancia';
  const winInfo= orden.filter((r)=>r.windowLabel).length ? ` · ${orden.filter((r)=>r.windowLabel).length} con ventana` : '';
  return { summary: `Ruta sugerida: ${total} paradas · ${estimatedKm} km estimados` + winInfo + (estimatedEnd? ` · fin aprox ${formatMinuteLabel(estimatedEnd)}` : '') + (orden.filter((r)=>r.windowLabel).length? ' · ventanas consideradas' : ''), strategy: rawOptions.strategy || 'balanced', originKnown: Boolean(normalizeOrigin(rawOptions.origin)), departureMinute: resolveDepartureMinute(rawOptions), departureLabel: formatMinuteLabel(resolveDepartureMinute(rawOptions)), factors: [`${total} paradas: ${withGps} con GPS · ${missingMsg}`, `${stratLabel} · ${orden.filter((r)=>r.windowLabel).length} con ventana horaria`, conflicts ? `${conflicts} avisos: revisa cierres o llegadas tardías` : 'Horarios compatibles', normalizeOrigin(rawOptions.origin) ? `Salida: ${rawOptions.origin.lat.toFixed(3)},${rawOptions.origin.lng.toFixed(3)}` : 'Sin salida: fija tu ubicación para ETAs reales'], estimatedKm, estimatedEnd, estimatedEndLabel: formatMinuteLabel(estimatedEnd), total, withGps, missingGps: total - withGps, windowed: orden.filter((row) => row.startMinute !== null || row.endMinute !== null).length, conflicts };
}
function optimizeRoutePackage(stops, dateYmd, windowsByCliente = new Map(), options = {}) {
  const orden = optimizeStopsHybrid(stops, dateYmd, windowsByCliente, options);
  const explanation = buildRouteExplanation(orden, options);
  return { algorithm: 'time_window_route_v1', orden, explanation, summary: { total: explanation.total, withGps: explanation.withGps, missingGps: explanation.missingGps, windowed: explanation.windowed, conflicts: explanation.conflicts, estimatedKm: explanation.estimatedKm, estimatedEnd: explanation.estimatedEnd, estimatedEndLabel: explanation.estimatedEndLabel } };
}
module.exports = { STRATEGIES, resolveDepartureMinute, normalizeOrigin, haversineKm, estimateTravelMinutes, annotateRouteTimeline, buildRouteExplanation, optimizeStopsHybrid, optimizeRoutePackage, DEFAULT_SERVICE_MINUTES, DEFAULT_AVG_KMH };
