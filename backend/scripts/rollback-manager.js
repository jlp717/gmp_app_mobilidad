/**
 * GMP App - Rollback Manager
 * ==========================
 * Automated rollback system via git hooks
 * Triggered on test failures to restore stable state
 * Run: node scripts/rollback-manager.js [action]
 */

const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
    projectRoot: path.resolve(__dirname, '../..'),
    backupTag: 'pre-optimization-backup',
    rollbackHistoryFile: path.join(__dirname, '../.rollback-history.json'),
};

/**
 * Logger
 */
const log = {
    info: (msg) => console.log(`[ROLLBACK] ℹ️  ${msg}`),
    success: (msg) => console.log(`[ROLLBACK] ✅ ${msg}`),
    warn: (msg) => console.log(`[ROLLBACK] ⚠️  ${msg}`),
    error: (msg) => console.log(`[ROLLBACK] ❌ ${msg}`),
};

/**
 * Execute git command
 */
function git(command) {
    try {
        return execSync(`git ${command}`, {
            cwd: CONFIG.projectRoot,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
    } catch (error) {
        throw new Error(`Git command failed: git ${command}\n${error.message}`);
    }
}

/**
 * Check if working directory is clean
 */
function checkWorkingDirectory() {
    const status = git('status --porcelain');
    return status.length === 0;
}

/**
 * Get current commit hash
 */
function getCurrentCommit() {
    return git('rev-parse HEAD');
}

/**
 * Get current branch name
 */
function getCurrentBranch() {
    return git('rev-parse --abbrev-ref HEAD');
}

/**
 * Check if backup tag exists
 */
function backupTagExists() {
    try {
        git(`rev-parse ${CONFIG.backupTag}`);
        return true;
    } catch {
        return false;
    }
}

/**
 * Create automatic backup before changes
 */
function createAutoBackup(reason = 'auto') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupBranch = `backup/${timestamp}-${reason}`;

    // Create backup branch
    git(`branch ${backupBranch}`);
    log.success(`Created backup branch: ${backupBranch}`);

    // Record in history
    recordRollbackHistory('backup', {
        branch: backupBranch,
        commit: getCurrentCommit(),
        reason,
    });

    return backupBranch;
}

/**
 * Rollback to backup tag
 */
function rollbackToBackup() {
    if (!backupTagExists()) {
        throw new Error(`Backup tag '${CONFIG.backupTag}' does not exist!`);
    }

    const currentCommit = getCurrentCommit();
    const currentBranch = getCurrentBranch();

    log.warn('Starting rollback to pre-optimization state...');

    // Check for uncommitted changes
    if (!checkWorkingDirectory()) {
        log.warn('Uncommitted changes detected. Stashing...');
        git('stash push -m "Auto-stash before rollback"');
    }

    // Create emergency backup
    const emergencyBackup = createAutoBackup('pre-rollback');

    // Perform rollback
    git(`checkout ${CONFIG.backupTag}`);

    // Record rollback
    recordRollbackHistory('rollback', {
        fromCommit: currentCommit,
        fromBranch: currentBranch,
        toBackup: CONFIG.backupTag,
        emergencyBackup,
    });

    log.success(`Rolled back to ${CONFIG.backupTag}`);
    log.info(`Emergency backup created at: ${emergencyBackup}`);

    return {
        success: true,
        fromCommit: currentCommit,
        emergencyBackup,
    };
}

/**
 * Rollback specific number of commits
 */
function rollbackCommits(count = 1) {
    const currentCommit = getCurrentCommit();

    log.warn(`Rolling back ${count} commit(s)...`);

    // Create backup first
    const backup = createAutoBackup('before-commit-rollback');

    // Soft reset to keep changes staged
    git(`reset --soft HEAD~${count}`);

    recordRollbackHistory('commit-rollback', {
        fromCommit: currentCommit,
        count,
        backup,
    });

    log.success(`Rolled back ${count} commit(s)`);
    return { success: true, backup };
}

/**
 * Record rollback history for audit
 */
function recordRollbackHistory(action, data) {
    let history = [];

    if (fs.existsSync(CONFIG.rollbackHistoryFile)) {
        try {
            history = JSON.parse(fs.readFileSync(CONFIG.rollbackHistoryFile, 'utf8'));
        } catch {
            history = [];
        }
    }

    history.push({
        timestamp: new Date().toISOString(),
        action,
        ...data,
    });

    // Keep only last 100 entries
    if (history.length > 100) {
        history = history.slice(-100);
    }

    fs.writeFileSync(CONFIG.rollbackHistoryFile, JSON.stringify(history, null, 2));
}

/**
 * Show rollback history
 */
function showHistory() {
    if (!fs.existsSync(CONFIG.rollbackHistoryFile)) {
        log.info('No rollback history found.');
        return [];
    }

    const history = JSON.parse(fs.readFileSync(CONFIG.rollbackHistoryFile, 'utf8'));

    console.log('\n' + '='.repeat(60));
    console.log('ROLLBACK HISTORY');
    console.log('='.repeat(60));

    for (const entry of history.slice(-10)) {
        console.log(`\n  [${entry.timestamp}] ${entry.action.toUpperCase()}`);
        if (entry.branch) console.log(`    Branch: ${entry.branch}`);
        if (entry.commit) console.log(`    Commit: ${entry.commit}`);
        if (entry.reason) console.log(`    Reason: ${entry.reason}`);
    }

    console.log('\n' + '='.repeat(60));
    return history;
}

/**
 * Status check
 */
function status() {
    console.log('\n' + '='.repeat(60));
    console.log('ROLLBACK MANAGER STATUS');
    console.log('='.repeat(60));

    console.log(`  Current Branch: ${getCurrentBranch()}`);
    console.log(`  Current Commit: ${getCurrentCommit().substring(0, 8)}`);
    console.log(`  Backup Tag:     ${backupTagExists() ? '✅ Exists' : '❌ Not found'}`);
    console.log(`  Working Dir:    ${checkWorkingDirectory() ? '✅ Clean' : '⚠️ Has changes'}`);

    console.log('='.repeat(60) + '\n');
}

/**
 * Run validation and rollback on failure
 */
async function validateAndRollback(validationScript) {
    log.info(`Running validation: ${validationScript}`);

    return new Promise((resolve, reject) => {
        exec(`node ${validationScript}`, {
            cwd: CONFIG.projectRoot,
        }, (error, stdout, stderr) => {
            console.log(stdout);

            if (error) {
                console.error(stderr);
                log.error('Validation failed! Initiating rollback...');

                try {
                    const result = rollbackToBackup();
                    resolve({ validationPassed: false, rolledBack: true, ...result });
                } catch (rollbackError) {
                    reject(new Error(`Validation and rollback both failed: ${rollbackError.message}`));
                }
            } else {
                log.success('Validation passed!');
                resolve({ validationPassed: true, rolledBack: false });
            }
        });
    });
}

/**
 * Main entry point
 */
async function main() {
    const action = process.argv[2] || 'status';

    try {
        switch (action) {
            case 'status':
                status();
                break;

            case 'backup':
                if (!backupTagExists()) {
                    git(`tag ${CONFIG.backupTag}`);
                    log.success(`Created backup tag: ${CONFIG.backupTag}`);
                } else {
                    log.warn(`Backup tag '${CONFIG.backupTag}' already exists.`);
                }
                break;

            case 'rollback':
                rollbackToBackup();
                break;

            case 'undo':
                const count = parseInt(process.argv[3], 10) || 1;
                rollbackCommits(count);
                break;

            case 'history':
                showHistory();
                break;

            case 'validate':
                const script = process.argv[3];
                if (!script) {
                    log.error('Please provide validation script path');
                    process.exit(1);
                }
                const result = await validateAndRollback(script);
                if (!result.validationPassed) {
                    process.exit(1);
                }
                break;

            default:
                console.log(`
Usage: node rollback-manager.js [action] [options]

Actions:
  status    - Show current status
  backup    - Create backup tag
  rollback  - Rollback to backup tag
  undo [n]  - Undo last n commits (default: 1)
  history   - Show rollback history
  validate [script] - Run validation and rollback on failure
        `);
        }
    } catch (error) {
        log.error(error.message);
        process.exit(1);
    }
}

// Export for testing
module.exports = {
    getCurrentCommit,
    getCurrentBranch,
    backupTagExists,
    rollbackToBackup,
    rollbackCommits,
};

// Run if called directly
if (require.main === module) {
    main();
}
