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

async function main() {
    const data = await gql(`query { book_mappings(where: {platform_id: {_eq: 1}, external_id: {_eq: "18423"}}) { book_id edition_id state verified book { title } } }`);
    console.log('Left Hand of Darkness (goodreads id 18423):', JSON.stringify(data.book_mappings, null, 2));

    const data2 = await gql(`query { book_mappings(where: {platform_id: {_eq: 1}, external_id: {_eq: "18806935"}}) { book_id edition_id state verified book { title } } }`);
    console.log('Café in Berlin (goodreads id 18806935):', JSON.stringify(data2.book_mappings, null, 2));
}

main().catch(e => { console.error('Critical Error:', e); process.exit(1); });
