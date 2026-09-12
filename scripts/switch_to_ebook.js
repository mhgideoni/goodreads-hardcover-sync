import dotenv from 'dotenv';

dotenv.config();

const ENDPOINT = 'https://api.hardcover.app/v1/graphql';
const HC_TOKEN = process.env.HARDCOVER_API_TOKEN;
const DRY_RUN = !process.argv.includes('--live');

// reading_format_id on editions does NOT reliably distinguish physical/ebook/audio —
// verified live that Hardcover/Paperback/Kindle/Ebook/Audiobook editions can all carry
// the same reading_format_id. The real signal is the free-text edition_format field.
const isAudioFormat = (fmt) => /audio/i.test(fmt || '');
const isEbookFormat = (fmt) => /ebook|kindle/i.test(fmt || '');

async function gql(query, variables) {
    const authHeader = HC_TOKEN.startsWith('Bearer ') ? HC_TOKEN : `Bearer ${HC_TOKEN}`;
    const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ query, variables })
    });
    if (!res.ok) {
        throw new Error(`API Error ${res.status}: ${res.statusText}`);
    }
    const json = await res.json();
    if (json.errors) {
        throw new Error('GraphQL Error: ' + JSON.stringify(json.errors));
    }
    return json.data;
}

async function main() {
    if (!HC_TOKEN) {
        console.error('❌ Missing HARDCOVER_API_TOKEN.');
        process.exit(1);
    }

    console.log(`=== Switch Read Books: Physical -> Ebook (${DRY_RUN ? 'DRY RUN — nothing will change' : 'LIVE'}) ===`);

    const query = `
        query MyReadBooks {
            me {
                user_books(where: {status_id: {_eq: 3}}) {
                    id
                    edition_id
                    edition { id edition_format }
                    book {
                        id
                        title
                        default_ebook_edition_id
                        editions { id edition_format users_count }
                    }
                }
            }
        }
    `;
    const data = await gql(query);
    const userBooks = data.me?.[0]?.user_books || [];
    console.log(`Loaded ${userBooks.length} Read books.`);

    const physicalBooks = userBooks.filter(ub => {
        if (!ub.edition) return false;
        const fmt = ub.edition.edition_format;
        if (isAudioFormat(fmt)) return false; // never touch audiobooks
        if (isEbookFormat(fmt)) return false; // already an ebook edition
        if (ub.book?.default_ebook_edition_id && ub.edition_id === ub.book.default_ebook_edition_id) return false;
        return true; // Hardcover, Paperback, or unlabeled — treated as physical/print
    });
    console.log(`${physicalBooks.length} are currently on a physical (non-ebook, non-audio) edition.\n`);

    let switched = 0;
    let skippedNoEbook = 0;
    let errors = 0;

    for (const ub of physicalBooks) {
        const title = ub.book?.title || `book_id ${ub.book?.id}`;

        // The book's default ebook edition, or failing that, any cataloged ebook
        // edition (not just the one Hardcover marks as default), preferring the
        // one with the most readers.
        const altEbookEditions = (ub.book?.editions || [])
            .filter(e => isEbookFormat(e.edition_format))
            .sort((a, b) => (b.users_count || 0) - (a.users_count || 0));
        const targetEditionId = ub.book?.default_ebook_edition_id || altEbookEditions[0]?.id;

        if (!targetEditionId) {
            console.log(`[Skip] '${title}' — no ebook edition found in Hardcover's catalog for this book.`);
            skippedNoEbook++;
            continue;
        }

        if (DRY_RUN) {
            console.log(`[Dry Run] Would switch '${title}' from edition ${ub.edition_id} (format="${ub.edition.edition_format}") to ebook edition ${targetEditionId}`);
            continue;
        }

        try {
            await gql(
                `mutation UpdateFormat($id: Int!, $edition_id: Int!) { update_user_book(id: $id, object: { edition_id: $edition_id }) { id } }`,
                { id: ub.id, edition_id: targetEditionId }
            );
            console.log(`✅ Switched '${title}' to ebook edition ${targetEditionId}`);
            switched++;
        } catch (e) {
            console.error(`❌ Failed to switch '${title}': ${e.message}`);
            errors++;
        }

        // Rate limit
        await new Promise(r => setTimeout(r, 1000));
    }

    console.log('\n=== Summary ===');
    console.log(`Physical books found: ${physicalBooks.length}`);
    console.log(DRY_RUN ? `Would switch: ${physicalBooks.length - skippedNoEbook}` : `Switched: ${switched}`);
    console.log(`Skipped (no ebook edition available): ${skippedNoEbook}`);
    if (errors > 0) {
        console.log(`Errors: ${errors}`);
        process.exit(1);
    }
    console.log('Done.');
}

main().catch(e => {
    console.error('Critical Error:', e);
    process.exit(1);
});
