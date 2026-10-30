import argon2 from 'argon2';
import { writeFile } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthService } from '../src/auth/service.js';
import { loadConfig } from '../src/config.js';
import { createDatabasePool } from '../src/database/pool.js';

const USER_COUNT = 10;
const PRODUCT_ID = '40000000-0000-4000-8000-000000000051';

export async function preparePerformance(outputArgument = 'postman/performance/.generated-checkout-data.json'): Promise<void> {
  const config = loadConfig();
  if (config.NODE_ENV !== 'test' || !config.DATABASE_NAME.endsWith('_test')) throw new Error('Refusing performance preparation outside a database ending _test');
  const outputRoot = resolve('postman/performance');
  const outputPath = resolve(outputArgument);
  const fromRoot = relative(outputRoot, outputPath);
  if (fromRoot.startsWith('..') || basename(outputPath).startsWith('.generated-') === false) throw new Error('Performance data must use a .generated-* filename under postman/performance');
  const pool = createDatabasePool(config);
  try {
    const [products] = await pool.query<Array<{ id: string } & import('mysql2/promise').RowDataPacket>>('SELECT id FROM products WHERE id = ?', [PRODUCT_ID]);
    if (!products[0]) throw new Error('Run the guarded test seed before performance preparation');
    await pool.query("UPDATE products SET publication_status = 'published', stock_quantity = 100000, published_at = COALESCE(published_at, NOW(3)) WHERE id = ?", [PRODUCT_ID]);
    const password = 'B12LoadPass123!';
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const auth = new AuthService(pool);
    const data: Array<{ accessToken: string; userIndex: number }> = [];
    for (let index = 1; index <= USER_COUNT; index++) {
      const suffix = String(index).padStart(4, '0');
      const userId = `c1200000-0000-4000-8000-00000000${suffix}`;
      const basketId = `c1210000-0000-4000-8000-00000000${suffix}`;
      const email = `b12.load.${suffix}@example.test`;
      await pool.query(`INSERT INTO users (id, email, password_hash, display_name, email_verified_at) VALUES (?, ?, ?, ?, NOW(3))
        ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), display_name = VALUES(display_name), email_verified_at = NOW(3)`, [userId, email, passwordHash, `B12 Load User ${index}`]);
      await pool.query("INSERT IGNORE INTO user_roles (user_id, role) VALUES (?, 'customer')", [userId]);
      await pool.query('INSERT INTO baskets (id, user_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE id = id', [basketId, userId]);
      await pool.query(`INSERT INTO basket_items (basket_id, product_id, quantity, observed_price_minor)
        SELECT ?, id, 1, price_minor FROM products WHERE id = ?
        ON DUPLICATE KEY UPDATE quantity = 1, observed_price_minor = VALUES(observed_price_minor)`, [basketId, PRODUCT_ID]);
      const login = await auth.login(email, password);
      data.push({ accessToken: login.tokens.accessToken, userIndex: index });
    }
    await writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    process.stdout.write(`Prepared ${data.length} isolated checkout identities in ${config.DATABASE_NAME}; runtime token file is git-ignored.\n`);
  } finally { await pool.end(); }
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  void preparePerformance(process.argv[2]).catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
