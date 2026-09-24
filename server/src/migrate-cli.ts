import { migrate, pool } from './db';

await migrate();
console.log('Schema is up to date.');
await pool.end();
