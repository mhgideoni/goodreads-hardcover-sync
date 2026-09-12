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
    const platforms = await gql(`query { platforms { id name } }`);
    console.log('Platforms:', JSON.stringify(platforms.platforms, null, 2));

    const query = `
        query MyReadBooks {
            me {
                user_books(where: {status_id: {_eq: 3}}) {
                    edition_id
                    edition { edition_format }
                    book {
                        id
                        title
                        default_ebook_edition_id
                        contributions { author { name } }
                        editions { edition_format }
                    }
                }
            }
        }
    `;
    const data = await gql(query);
    const userBooks = data.me?.[0]?.user_books || [];

    const isAudioFormat = (fmt) => /audio/i.test(fmt || '');
    const isEbookFormat = (fmt) => /ebook|kindle/i.test(fmt || '');

    const noEbook = userBooks.filter(ub => {
        if (!ub.edition) return false;
        const fmt = ub.edition.edition_format;
        if (isAudioFormat(fmt)) return false;
        if (isEbookFormat(fmt)) return false;
        if (ub.book?.default_ebook_edition_id) return false;
        const hasAltEbook = (ub.book?.editions || []).some(e => isEbookFormat(e.edition_format));
        if (hasAltEbook) return false;
        return true;
    });

    console.log(`\n${noEbook.length} books with no ebook edition:\n`);
    noEbook.forEach(ub => {
        const authors = (ub.book?.contributions || []).map(c => c.author?.name).filter(Boolean).join(', ');
        console.log(`book_id=${ub.book?.id}\ttitle="${ub.book?.title}"\tauthor="${authors}"`);
    });
}

main().catch(e => { console.error('Critical Error:', e); process.exit(1); });
