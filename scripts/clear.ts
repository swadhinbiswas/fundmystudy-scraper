import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.TURSO_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function main() {
  const count = await client.execute('SELECT COUNT(*) as n FROM opportunities');
  console.log('Current records:', count.rows[0].n);
  await client.execute('DELETE FROM opportunities');
  console.log('All opportunities deleted');
}

main();
