// Deletes the local embedded database so the next server start re-creates the schema and synthetic fixtures.
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve(process.env.LEXIA_DATA_DIR || './.data/pg');
if (process.env.LEXIA_ENV === 'production') {
  console.error('Refusing to reset the database when LEXIA_ENV=production.');
  process.exit(1);
}
if (!dir.includes('.data')) {
  console.error(`Refusing to delete ${dir}: only paths under a .data folder are reset by this script.`);
  process.exit(1);
}
rmSync(dir, { recursive: true, force: true });
console.log(`Removed ${dir}. Restart the server to re-seed synthetic fixtures.`);
