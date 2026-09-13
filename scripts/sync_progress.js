import dotenv from 'dotenv';
dotenv.config();

const ENDPOINT = 'https://api.hardcover.app/v1/graphql';
const HC_TOKEN = process.env.HARDCOVER_API_TOKEN;
const RSS_URL = process.env.GOODREADS_UPDATES_RSS_URL;
const DRY_RUN = !process.argv.includes('--live');
const GOODREADS_PLATFORM_ID = 1;
const CURRENTLY_READING_STATUS_ID = 2;

async function gql(query, variables, retries = 3) {
    const authHeader = HC_TOKEN.startsWith('Bearer ') ? HC_TOKEN : `Bearer ${HC_TOKEN}`;
    const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ query, variables })
    });
    if (res.status === 429) {
        if (retries > 0) {
            await new Promise(r => setTimeout(r, 3000));
            return gql(query, variables, retries - 1);
        }
        throw new Error('429 Throttled (Max Retries)');
    }
    if (!res.ok) throw new Error(`API Error ${res.status}: ${res.statusText}`);
    const json = await res.json();
    if (json.errors) throw new Error('GraphQL Error: ' + JSON.stringify(json.errors));
    return json.data;
}

// Parses Goodreads' "updates" activity feed (not a shelf feed). Progress updates
// appear as items whose guid starts with "UserStatus", titled e.g.
// "X is 28% done with Book Title". The Goodreads book id is embedded in a
// /book/show/<id>.<slug> link in the title or description, and survives even
// when the surrounding HTML is entity-escaped since the digits themselves aren't.
function parseProgressUpdates(xmlText) {
    const entries = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = itemRegex.exec(xmlText)) !== null) {
        const item = m[1];
        const guidMatch = /<guid[^>]*>([^<]+)<\/guid>/.exec(item);
        const guid = guidMatch ? guidMatch[1] : '';
        if (!guid.startsWith('UserStatus')) continue;

        const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(item);
        const rawTitle = (titleMatch ? titleMatch[1] : '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/\s+/g, ' ').trim();

        const bookIdMatch = /\/book\/show\/(\d+)\./.exec(item);
        const pctMatch = /is (\d+)% done with (.+)$/.exec(rawTitle);

        if (bookIdMatch && pctMatch) {
            entries.push({
                goodreadsBookId: bookIdMatch[1],
                percent: parseInt(pctMatch[1], 10),
                title: pctMatch[2].trim()
            });
        }
    }
    return entries;
}

async function resolveBookMapping(goodreadsBookId) {
    const data = await gql(
        `query Map($id: String!) { book_mappings(where: {platform_id: {_eq: ${GOODREADS_PLATFORM_ID}}, external_id: {_eq: $id}}, limit: 1) { book_id edition_id } }`,
        { id: goodreadsBookId }
    );
    return data.book_mappings?.[0] || null;
}

async function getExistingUserBook(bookId) {
    const data = await gql(
        `query Get($bookId: Int!) { me { user_books(where: {book_id: {_eq: $bookId}}) { id status_id edition_id user_book_reads(where: {finished_at: {_is_null: true}}, order_by: {id: desc}, limit: 1) { id progress_pages } } } }`,
        { bookId }
    );
    return data.me?.[0]?.user_books?.[0] || null;
}

async function getEditionPages(editionId) {
    if (!editionId) return null;
    const data = await gql(`query Get($id: Int!) { editions(where: {id: {_eq: $id}}) { pages } }`, { id: editionId });
    return data.editions?.[0]?.pages || null;
}

async function main() {
    if (!HC_TOKEN || !RSS_URL) {
        console.error('❌ Missing HARDCOVER_API_TOKEN or GOODREADS_UPDATES_RSS_URL.');
        process.exit(1);
    }

    console.log(`=== Sync Reading Progress (${DRY_RUN ? 'DRY RUN — nothing will change' : 'LIVE'}) ===\n`);

    const res = await fetch(RSS_URL);
    const text = await res.text();
    const updates = parseProgressUpdates(text);

    // Feed is newest-first; keep only the latest update per book.
    const latestByBook = new Map();
    for (const u of updates) {
        if (!latestByBook.has(u.goodreadsBookId)) latestByBook.set(u.goodreadsBookId, u);
    }

    console.log(`Found ${latestByBook.size} book(s) with a recent progress update.\n`);

    let updated = 0, skipped = 0, errors = 0;

    for (const [goodreadsBookId, update] of latestByBook) {
        try {
            const mapping = await resolveBookMapping(goodreadsBookId);
            if (!mapping) {
                console.log(`[Skip] '${update.title}' — no Hardcover mapping for Goodreads book ${goodreadsBookId}.`);
                skipped++;
                continue;
            }

            let userBook = await getExistingUserBook(mapping.book_id);

            if (DRY_RUN) {
                const currentPct = userBook?.user_book_reads?.[0]
                    ? `${userBook.user_book_reads[0].progress_pages} pages logged`
                    : 'not yet tracked';
                console.log(`[Dry Run] '${update.title}' -> ${update.percent}% (currently: ${currentPct}, status_id=${userBook?.status_id ?? 'not in library'})`);
                continue;
            }

            if (!userBook) {
                const insertResult = await gql(
                    `mutation Insert($book_id: Int!) { insert_user_book(object: { book_id: $book_id, status_id: ${CURRENTLY_READING_STATUS_ID} }) { id } }`,
                    { book_id: mapping.book_id }
                );
                userBook = { id: insertResult.insert_user_book.id, status_id: CURRENTLY_READING_STATUS_ID, edition_id: null, user_book_reads: [] };
                console.log(`  Added '${update.title}' to library as Currently Reading.`);
            } else if (userBook.status_id !== CURRENTLY_READING_STATUS_ID) {
                await gql(
                    `mutation UpdateStatus($id: Int!) { update_user_book(id: $id, object: { status_id: ${CURRENTLY_READING_STATUS_ID} }) { id } }`,
                    { id: userBook.id }
                );
                console.log(`  Set '${update.title}' status to Currently Reading.`);
            }

            const editionId = userBook.edition_id || mapping.edition_id;
            const pages = await getEditionPages(editionId);
            if (!pages) {
                console.log(`[Skip] '${update.title}' — no page count available to compute progress.`);
                skipped++;
                continue;
            }
            const progressPages = Math.round((update.percent / 100) * pages);

            const existingRead = userBook.user_book_reads?.[0];
            if (existingRead) {
                await gql(
                    `mutation UpdateProgress($id: Int!, $object: DatesReadInput!) { update_user_book_read(id: $id, object: $object) { id } }`,
                    { id: existingRead.id, object: { progress_pages: progressPages } }
                );
            } else {
                await gql(
                    `mutation InsertProgress($user_book_id: Int!, $object: DatesReadInput!) { insert_user_book_read(user_book_id: $user_book_id, user_book_read: $object) { id } }`,
                    { user_book_id: userBook.id, object: { progress_pages: progressPages } }
                );
            }
            console.log(`✅ '${update.title}': ${update.percent}% -> ${progressPages}/${pages} pages`);
            updated++;
        } catch (e) {
            console.error(`❌ Error syncing '${update.title}': ${e.message}`);
            errors++;
        }
        await new Promise(r => setTimeout(r, 1000));
    }

    console.log('\n=== Summary ===');
    console.log(DRY_RUN ? `Would update: ${latestByBook.size - skipped}` : `Updated: ${updated}`);
    console.log(`Skipped (no mapping or page count): ${skipped}`);
    if (errors > 0) {
        console.log(`Errors: ${errors}`);
        process.exit(1);
    }
    console.log('Done.');
}

main().catch(e => { console.error('Critical Error:', e); process.exit(1); });
