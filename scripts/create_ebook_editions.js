import dotenv from 'dotenv';
dotenv.config();

const ENDPOINT = 'https://api.hardcover.app/v1/graphql';
const HC_TOKEN = process.env.HARDCOVER_API_TOKEN;
const AMAZON_PLATFORM_ID = 19;

// Real Kindle ASINs found via web search, verified against title/author match.
// "Pure" appears twice because Hardcover has two separate book_id entries for it.
const BOOKS_TO_FIX = [
    { book_id: 380, title: "Start-up Nation", asin: "B004QZ9P6K" },
    { book_id: 109629, title: "Larry's Party", asin: "B00316UNE8" },
    { book_id: 505692, title: "The Queen of the Tambourine", asin: "B079MFZV4W" },
    { book_id: 431052, title: "Fugitive Pieces", asin: "B001ODEQ0W" },
    { book_id: 241607, title: "Pure", asin: "B0052RMN1U" },
    { book_id: 867329, title: "Pure", asin: "B0052RMN1U" },
    { book_id: 228642, title: "Home", asin: "B0018QSNYU" },
    { book_id: 261401, title: "Small Island", asin: "B002TXZTNY" },
    { book_id: 14369, title: "The Tenderness of Wolves", asin: "B01MRGRVWI" },
    { book_id: 512405, title: "A Crime in the Neighborhood", asin: "B00DV790DM" },
    { book_id: 925374, title: "Improve Your Social Skills", asin: "B00NJNQ3U6" },
    { book_id: 654304, title: "Beware the Past", asin: "B078GWN38X" },
    { book_id: 435050, title: "May We Be Forgiven", asin: "B007V65ORK" },
    { book_id: 13888, title: "Behind the Scenes at the Museum", asin: "B0031RSAAG" },
    { book_id: 377318, title: "English Passengers", asin: "B001NJMBFO" },
    { book_id: 457596, title: "The Chronicles of Amber", asin: "B075V7ZVKR" },
    { book_id: 2945863, title: "The Rainbow", asin: "B00PHV81QM" },
    { book_id: 469119, title: "Aberystwyth Mon Amour", asin: "B004BSFMBY" },
    { book_id: 431231, title: "Golden Hill", asin: "B01FQVWXPW" },
    { book_id: 864899, title: "Swing Hammer Swing!", asin: "B009PMBXN2" },
    { book_id: 15350, title: "The Road Home", asin: "B0031RS6YQ" },
    { book_id: 553243, title: "Theory of War", asin: "B006WG1HM6" },
    { book_id: 482435, title: "The Complete Stories, Volume 1", asin: "B0BW4KTCRY" },
    { book_id: 80837, title: "The Glorious Heresies", asin: "B0180T0J2G" },
];

async function gql(query, variables) {
    const authHeader = HC_TOKEN.startsWith('Bearer ') ? HC_TOKEN : `Bearer ${HC_TOKEN}`;
    const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ query, variables })
    });
    const json = await res.json();
    if (json.errors) throw new Error('GraphQL Error: ' + JSON.stringify(json.errors));
    return json.data;
}

async function main() {
    const pilotOnly = process.argv.includes('--pilot');
    const list = pilotOnly ? BOOKS_TO_FIX.slice(0, 1) : BOOKS_TO_FIX;

    console.log(`=== Creating ebook editions (${pilotOnly ? 'PILOT: 1 book only' : `${list.length} books`}) ===\n`);

    for (const b of list) {
        try {
            const result = await gql(
                `mutation Upsert($book: CreateBookFromPlatformInput!) { upsert_book(book: $book) { id status errors edition_id book { id title } } }`,
                { book: { book_id: b.book_id, external_id: b.asin, platform_id: AMAZON_PLATFORM_ID } }
            );
            const r = result.upsert_book;
            const ok = !r.errors || r.errors.length === 0;
            console.log(`${ok ? '✅' : '❌'} '${b.title}' (book_id=${b.book_id}) -> ${JSON.stringify(r)}`);
        } catch (e) {
            console.error(`❌ Failed for '${b.title}' (book_id=${b.book_id}): ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 1500));
    }
    console.log('\nDone.');
}

main().catch(e => { console.error('Critical Error:', e); process.exit(1); });
