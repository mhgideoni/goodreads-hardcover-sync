import dotenv from 'dotenv';
dotenv.config();

const ENDPOINT = 'https://api.hardcover.app/v1/graphql';
const HC_TOKEN = process.env.HARDCOVER_API_TOKEN;

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

// The "from" edition ids logged when we switched these 39 books earlier.
const FROM_EDITION_IDS = [
    5278018, 30549542, 7055945, 30461552, 29504130, 187333, 30531599,
    30859526, 30859458, 30382015, 10130961, 8355250, 20636832, 50589,
    1250181, 2084417, 33284089, 33284091, 33284090, 30407397, 25324831,
    32094332, 30545875, 32004303, 30399189, 33043769, 24081050, 31484679,
    27176096, 32100540, 13947701, 301456, 30829594, 32145092, 31779184,
    30567441, 32238991, 31565332, 281209
];

async function main() {
    const query = `
        query CheckEditions($ids: [Int!]) {
            editions(where: {id: {_in: $ids}}) {
                id
                title
                edition_format
                audio_seconds
                reading_format_id
                book { title }
            }
        }
    `;
    const data = await gql(query, { ids: FROM_EDITION_IDS });
    console.log(`Checked ${data.editions.length} of ${FROM_EDITION_IDS.length} "from" editions.\n`);

    let audioCount = 0;
    for (const ed of data.editions) {
        const isAudio = !!ed.audio_seconds || (ed.edition_format || '').toLowerCase().includes('audio');
        if (isAudio) audioCount++;
        console.log(`${isAudio ? '🔊 AUDIO' : '  ok   '} | book="${ed.book?.title}" edition_format="${ed.edition_format}" audio_seconds=${ed.audio_seconds} reading_format_id=${ed.reading_format_id}`);
    }
    console.log(`\n=== ${audioCount} of ${data.editions.length} were actually audiobooks ===`);
}

main().catch(e => { console.error('Critical Error:', e); process.exit(1); });
