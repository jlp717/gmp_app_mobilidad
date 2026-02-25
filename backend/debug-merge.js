// debug-merge.js
function getNaturalRoute() {
    return [
        { code: 'A', name: 'Family Park' },
        { code: 'B', name: 'Canela' },
        { code: 'C', name: 'Route 66' }
    ];
}

function getDbOverrides() {
    return new Map([
        // User explicitly moved Canela to position 0
        ['B', 0]
    ]);
}

function buildFinalRoute(natural, overrides) {
    // Sort everything based on the override, if present.
    let clients = natural.map((c, i) => {
        let override = overrides.get(c.code);
        let finalOrder = override !== undefined ? override : (20000 + i);
        return { ...c, order: finalOrder };
    });

    clients.sort((a, b) => a.order - b.order);
    return clients;
}

const overrideRoute = buildFinalRoute(getNaturalRoute(), getDbOverrides());
console.log("If I move Canela to 0:", overrideRoute);
// Wait, if I explicitly tell Canela to be 0
// Canela gets 0. Family Park gets 20000. Route 66 gets 20001.
// Final list: Canela, Family Park, Route 66
// RESULT: SUCCESS! The other elements gracefully shift downwards without needing overrides!

console.log("Proof of concept succeeded.");
