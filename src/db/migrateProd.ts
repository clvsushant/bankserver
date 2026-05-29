/**
 * Production migration runner. Applies versioned SQL from `drizzle/` via the
 * Drizzle migrator (see `npm run db:generate` when schema.ts changes).
 */

import path from "path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "./client";

export function migrateProd(): void {
    migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
}

if (require.main === module) {
    migrateProd();
    // eslint-disable-next-line no-console
    console.log("bankserver schema migrated (production).");
}
