import dotenv from 'dotenv';
dotenv.config();

const ENDPOINT = 'https://api.hardcover.app/v1/graphql';
const HC_TOKEN = process.env.HARDCOVER_API_TOKEN;
const BOOK_ID = 377842; // The Left Hand of Darkness
const PROGRESS_FRACTION = 0.28;

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
    const query = `
        query Check {
            me {
                user_books(where: {book_id: {_eq: ${BOOK_ID}}}) {
                    id status_id edition_id
                    user_book_reads { id progress_pages started_at finished_at }
                }
            }
            books(where: {id: {_eq: ${BOOK_ID}}}) { id title pages default_physical_edition_id editions { id pages } }
        }
    `;
    const data = await gql(query);
    console.log('Existing user_book:', JSON.stringify(data.me?.[0]?.user_books, null, 2));
    console.log('Book info:', JSON.stringify(data.books, null, 2));
}

main().catch(e => { console.error('Critical Error:', e); process.exit(1); });
