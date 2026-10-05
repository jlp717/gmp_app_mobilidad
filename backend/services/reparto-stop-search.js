'use strict';

function normalizeSearch(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}

function documentLabels(stop) {
    const serie = String(stop?.serie || '').trim();
    const serieFactura = String(stop?.serieFactura || '').trim();
    const terminal = stop?.terminal == null ? '' : String(stop.terminal).trim();
    const numero = stop?.numero == null ? '' : String(stop.numero).trim();
    const numeroFactura = stop?.numeroFactura == null
        ? ''
        : String(stop.numeroFactura).trim();
    const labels = [];
    if (serie && numero) {
        labels.push(numero);
        labels.push(`${serie}-${numero}`);
        if (terminal) labels.push(`${serie}-${terminal}-${numero}`);
    } else if (numero) {
        labels.push(numero);
    }
    if (serieFactura && numeroFactura) {
        labels.push(numeroFactura);
        labels.push(`${serieFactura}-${numeroFactura}`);
        if (terminal) labels.push(`${serieFactura}-${terminal}-${numeroFactura}`);
    } else if (numeroFactura) {
        labels.push(numeroFactura);
    }
    return labels;
}

function includesQuery(haystack, query) {
    const text = normalizeSearch(haystack);
    const q = normalizeSearch(query);
    if (!q) return false;
    if (text.includes(q)) return true;
    const compactNeedle = text.replace(/[\s./_-]+/g, '');
    const compactQuery = q.replace(/[\s./_-]+/g, '');
    return compactQuery.length > 0 && compactNeedle.includes(compactQuery);
}

function matchesClient(stop, query) {
    if (!normalizeSearch(query)) return true;
    return includesQuery(stop?.nombreCliente, query)
        || includesQuery(stop?.codigoCliente, query)
        || includesQuery(stop?.poblacion, query);
}

function matchesDocument(stop, query) {
    const q = normalizeSearch(query);
    if (!q) return true;
    const structured = /[a-zñáéíóúü]|-|\//i.test(String(query));
    if (structured) {
        return documentLabels(stop).some((label) => includesQuery(label, query));
    }
    const numero = String(stop?.numero ?? '');
    const numeroFactura = String(stop?.numeroFactura ?? '');
    return numero.toLowerCase().includes(q) || numeroFactura.toLowerCase().includes(q);
}

function matchesOrden(stop, query) {
    const q = String(query ?? '').trim();
    if (!q) return true;
    if (stop?.ordenPreparacion == null || stop.ordenPreparacion === '') return false;
    return String(stop.ordenPreparacion).includes(q);
}

function matchesStopSearch(stop, query = {}) {
    const search = String(query.search || '').trim();
    if (search
        && !matchesClient(stop, search)
        && !matchesDocument(stop, search)
        && !matchesOrden(stop, search)) {
        return false;
    }
    const searchClient = String(query.searchClient || '').trim();
    if (searchClient && !matchesClient(stop, searchClient)) return false;
    const searchAlbaran = String(query.searchAlbaran || '').trim();
    if (searchAlbaran && !matchesDocument(stop, searchAlbaran)) return false;
    const searchOrden = String(query.searchOrden || '').trim();
    if (searchOrden && !matchesOrden(stop, searchOrden)) return false;
    return true;
}

module.exports = {
    matchesStopSearch,
    documentLabels,
};
