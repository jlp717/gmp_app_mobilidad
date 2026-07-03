'use strict';

const { checkAuthPinHashReadiness, resetAuthPinReadinessCache } = require('../services/auth-pin-readiness');
const { backfillVendorPinHashes } = require('./migrate-pin-hashes');

function parseArgs(argv) {
    const args = new Set(argv);
    return {
        json: args.has('--json'),
        backfillIfNeeded: args.has('--backfill-if-needed'),
    };
}

function printResult(result, json) {
    if (json) {
        console.log(JSON.stringify(result));
        return;
    }

    console.log(`auth_pin_hashes=${result.status}`);
    console.log(`total_active_vendors=${result.totalActiveVendors}`);
    console.log(`hashed_vendors=${result.hashedVendors}`);
    console.log(`missing_hashes=${result.missingHashes}`);
    if (result.missingExamples?.length) {
        console.log(`missing_examples=${result.missingExamples.join(',')}`);
    }
    if (result.error) {
        console.log(`error=${result.error}`);
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    let result = await checkAuthPinHashReadiness({ force: true, cacheMs: 0 });

    if (options.backfillIfNeeded && result.status !== 'ready') {
        await backfillVendorPinHashes();
        resetAuthPinReadinessCache();
        result = await checkAuthPinHashReadiness({ force: true, cacheMs: 0 });
    }

    printResult(result, options.json);
    process.exit(result.status === 'ready' ? 0 : 1);
}

if (require.main === module) {
    main().catch((error) => {
        console.error(JSON.stringify({ status: 'error', error: error.message }));
        process.exit(1);
    });
}

module.exports = { parseArgs };
