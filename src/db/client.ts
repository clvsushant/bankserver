import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

/**
 * Singleton SQLite + Drizzle client. Tests open separate in-memory databases
 * via `createDb` to keep state isolated between cases.
 */
const dbFile = process.env.DATABASE_URL || "./bankserver.sqlite";

const sqlite = new Database(dbFile);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export type Db = typeof db;

export function createDb(file: string = ":memory:"): Db {
    const inst = new Database(file);
    inst.pragma("journal_mode = WAL");
    inst.pragma("foreign_keys = ON");
    return drizzle(inst, { schema });
}

export { sqlite };
