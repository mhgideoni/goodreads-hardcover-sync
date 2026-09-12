import dotenv from 'dotenv';

dotenv.config();

const ENDPOINT = 'https://api.hardcover.app/v1/graphql';
const HC_TOKEN = process.env.HARDCOVER_API_TOKEN;
const DRY_RUN = !process.argv.includes('--live');

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

    // Resolve the physical-print reading_format id dynamically rather than hardcoding it,
    // since Hardcover doesn't document these ids publicly. Hardcover's actual format set
    // is Read / Listened / Both / Ebook — "Read" is the print/physical one (as opposed to
    // "Listened" for audio), there's no format literally named "Physical".
    const formatsData = await gql(`query { reading_formats { id format } }`);
    const physicalFormat = formatsData.reading_formats.find(f => f.format.toLowerCase() === 'read');
    if (!physicalFormat) {
        console.error('❌ Could not find the "Read" (print/physical) reading format. Formats seen:', formatsData.reading_formats);
        process.exit(1);
    }
    console.log(`Reading formats in your account: ${formatsData.reading_formats.map(f => `${f.id}=${f.format}`).join(', ')}`);
    console.log(`Treating "${physicalFormat.format}" (id ${physicalFormat.id}) as physical.\n`);

    const query = `
        query MyReadBooks {
            me {
                user_books(where: {status_id: {_eq: 3}}) {
                    id
                    edition_id
                    edition { id reading_format_id }
                    book { id title default_ebook_edition_id }
                }
            }
        }
    `;
    const data = await gql(query);
    const userBooks = data.me?.[0]?.user_books || [];
    console.log(`Loaded ${userBooks.length} Read books.`);

    const physicalBooks = userBooks.filter(ub => ub.edition && ub.edition.reading_format_id === physicalFormat.id);
    console.log(`${physicalBooks.length} are currently on a physical edition.\n`);

    let switched = 0;
    let skippedNoEbook = 0;
    let errors = 0;

    for (const ub of physicalBooks) {
        const title = ub.book?.title || `book_id ${ub.book?.id}`;
        const targetEditionId = ub.book?.default_ebook_edition_id;

        if (!targetEditionId) {
            console.log(`[Skip] '${title}' — no ebook edition found in Hardcover's catalog for this book.`);
            skippedNoEbook++;
            continue;
        }

        if (DRY_RUN) {
            console.log(`[Dry Run] Would switch '${title}' from edition ${ub.edition_id} to ebook edition ${targetEditionId}`);
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
