import { SyncEngine } from '../shared/core.js';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

// Load .env
dotenv.config();

const STATE_DIR = path.join(process.cwd(), '.sync-state');

function loadState(shelfKey) {
    const file = path.join(STATE_DIR, `${shelfKey}.json`);
    try {
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf-8'));
        }
    } catch (e) {
        console.warn(`⚠️ Could not read state file ${file}, starting fresh: ${e.message}`);
    }
    return {};
}

function saveState(shelfKey, state) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const file = path.join(STATE_DIR, `${shelfKey}.json`);
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
    return file;
}

// Each shelf reads its RSS URL from its own env var and syncs to a different
// place in Hardcover: a status (Want to Read / Read) or a named list.
const SHELF_CONFIGS = {
    read: {
        envVar: 'GOODREADS_RSS_URL',
        target: { type: 'status', statusId: 3, trackReadDate: true }
    },
    toread: {
        envVar: 'GOODREADS_RSS_URL_TOREAD',
        target: { type: 'status', statusId: 1, trackReadDate: false }
    },
    bookclub: {
        envVar: 'GOODREADS_RSS_URL_BOOKCLUB',
        target: { type: 'list', listSlug: 'book-club' }
    }
};

/**
 * Main Entry Point for Node.js
 */
async function main() {
    console.log("=== Kindle Sync (Node.js) ===");

    // 1. Get Config
    const shelfArgIndex = process.argv.indexOf('--shelf');
    const shelfKey = shelfArgIndex > -1 ? process.argv[shelfArgIndex + 1] : 'read';
    const config = SHELF_CONFIGS[shelfKey];

    if (!config) {
        console.error(`❌ Unknown --shelf '${shelfKey}'. Valid options: ${Object.keys(SHELF_CONFIGS).join(', ')}`);
        process.exit(1);
    }

    const RSS_URL = process.env[config.envVar];
    const HC_TOKEN = process.env.HARDCOVER_API_TOKEN;
    const DRY_RUN = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');

    if (!RSS_URL || !HC_TOKEN) {
        console.error(`❌ Stats: Missing Configuration. Please set ${config.envVar} and HARDCOVER_API_TOKEN.`);
        process.exit(1);
    }

    // Parse Limit
    const limitArgIndex = process.argv.indexOf('--limit');
    const LIMIT = limitArgIndex > -1 ? parseInt(process.argv[limitArgIndex + 1]) : 20;

    // 2. Initialize Engine
    const previousState = loadState(shelfKey);
    const engine = new SyncEngine({
        hcToken: HC_TOKEN,
        rssUrl: RSS_URL,
        isDryRun: DRY_RUN,
        limit: LIMIT,
        target: config.target,
        previousState,
        onLog: (msg, type) => {
            // We can colorize output here if we want terminal colors
            // For now, pure log is fine
            // console.log already handles it in the engine for debug, but we can customize
        }
    });

    // 3. Run
    try {
        const results = await engine.run();
        console.log("\n=== Sync Summary ===");
        console.log(`New Books Added: ${results.newBooks}`);
        if(results.added.length > 0) {
            results.added.forEach(b => console.log(` - ${b.title} (ID: ${b.id})`));
        }
        if(results.removed && results.removed.length > 0) {
            console.log(`Books Removed: ${results.removed.length}`);
            results.removed.forEach(t => console.log(` - ${t}`));
        }
        if (!DRY_RUN && results.state) {
            const savedTo = saveState(shelfKey, results.state);
            console.log(`State saved to ${savedTo}`);
        }
        if(results.errors.length > 0) {
             console.log("\nErrors encountered:");
             results.errors.forEach(e => console.log(` - ${e}`));
             process.exit(1);
        }
        console.log("Done.");
    } catch (e) {
        console.error("Critical Error:", e);
        process.exit(1);
    }
}

main();
