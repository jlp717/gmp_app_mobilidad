'use strict';

const closing = 'Quedamos a su disposición.\nUn cordial saludo,\nGranja Mari Pepa';

function greeting(date = new Date()) {
    const hour = Number(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Madrid',
        hour: 'numeric',
        hourCycle: 'h23',
    }).format(date));
    if (hour < 14) return 'Buenos días';
    if (hour < 21) return 'Buenas tardes';
    return 'Buenas noches';
}

function euros(amount) {
    const value = Number(amount);
    const safe = Number.isFinite(value) ? value : 0;
    const negative = safe < 0;
    const [ints, dec] = Math.abs(safe).toFixed(2).split('.');
    let grouped = '';
    for (let i = 0; i < ints.length; i += 1) {
        const left = ints.length - i;
        if (i > 0 && left % 3 === 0) grouped += '.';
        grouped += ints[i];
    }
    return `${negative ? '-' : ''}${grouped},${dec} €`;
}

function displayDate(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slash) {
        return `${slash[1].padStart(2, '0')}/${slash[2].padStart(2, '0')}/${slash[3]}`;
    }
    return text;
}

function hello(clientName, now) {
    const greet = greeting(now);
    const name = String(clientName || '').replace(/\s+/g, ' ').trim();
    if (!name || name.toLowerCase() === 'cliente') return `${greet},`;
    return `${greet}, ${name},`;
}

function commercialShareMessage({
    clientName,
    kind,
    documentLabel,
    date,
    total,
    albaranLabel,
    now,
} = {}) {
    const helloLine = hello(clientName, now);
    const label = String(documentLabel || '').trim();
    const when = displayDate(date);
    const money = euros(total);
    const albaran = String(albaranLabel || '').trim();
    const normalized = String(kind || '').toLowerCase();
    let sentence;
    if (normalized.startsWith('fact') && albaran) {
        sentence = `${helloLine} le enviamos su factura ${label}, correspondiente al albarán ${albaran}${when ? `, emitido el ${when}` : ''}, por un importe de ${money}.`;
    } else if (normalized.startsWith('fact')) {
        sentence = `${helloLine} le enviamos su factura ${label}${when ? `, emitida el ${when}` : ''}, por un importe de ${money}.`;
    } else if (normalized.startsWith('nota')) {
        sentence = `${helloLine} le enviamos la nota de entrega del albarán ${label}${when ? `, emitido el ${when}` : ''}, por un importe de ${money}.`;
    } else {
        sentence = `${helloLine} le enviamos su albarán ${label}${when ? `, emitido el ${when}` : ''}, por un importe de ${money}.`;
    }
    return `${sentence}\n\n${closing}`;
}

function productSheetMessage({ clientName, productName, productCode, now } = {}) {
    const helloLine = hello(clientName, now);
    const name = String(productName || '').trim() || 'producto';
    const code = String(productCode || '').trim();
    const reference = code ? `, referencia ${code}` : '';
    return `${helloLine} le enviamos la ficha técnica de ${name}${reference}.\n\n${closing}`;
}

module.exports = {
    greeting,
    euros,
    displayDate,
    commercialShareMessage,
    productSheetMessage,
};
