import { migrate } from "./migrate";
import { migrateProd } from "./migrateProd";

export function runMigrations(): void {
    if (process.env.NODE_ENV === "test") return;
    if (process.env.NODE_ENV === "production") {
        migrateProd();
    } else {
        migrate();
    }
}
