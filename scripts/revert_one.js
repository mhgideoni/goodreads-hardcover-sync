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
    const query = `
        query FindBook {
            me {
                user_books(where: {status_id: {_eq: 3}}) {
                    id
                    edition_id
                    book { title }
                }
            }
        }
    `;
    const data = await gql(query);
    const target = data.me?.[0]?.user_books.find(ub => ub.book?.title === 'The Big Four');
    if (!target) {
        console.error('Could not find "The Big Four" in Read books.');
        process.exit(1);
    }
    console.log(`Found 'The Big Four': user_book id=${target.id}, current edition_id=${target.edition_id}`);

    const ORIGINAL_AUDIO_EDITION_ID = 30549542;
    if (target.edition_id === ORIGINAL_AUDIO_EDITION_ID) {
        console.log('Already back on the original audiobook edition — nothing to do.');
        return;
    }

    await gql(
        `mutation Revert($id: Int!, $edition_id: Int!) { update_user_book(id: $id, object: { edition_id: $edition_id }) { id } }`,
        { id: target.id, edition_id: ORIGINAL_AUDIO_EDITION_ID }
    );
    console.log(`✅ Reverted 'The Big Four' back to audiobook edition ${ORIGINAL_AUDIO_EDITION_ID}`);
}

main().catch(e => { console.error('Critical Error:', e); process.exit(1); });
