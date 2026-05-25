import { eq } from "drizzle-orm";
import type { Db } from "../../../db/client";
import { webauthnCredentials } from "../../../db/schema";
import type {
    AuthenticatorTransport,
    CredentialDeviceType,
    WebAuthnCredential,
} from "../domain/credential";
import type { CredentialRepo } from "../application/ports";

function toDomain(row: typeof webauthnCredentials.$inferSelect): WebAuthnCredential {
    return {
        id: row.id,
        userId: row.userId,
        publicKey: new Uint8Array(row.publicKey),
        counter: row.counter,
        transports: row.transports
            ? (JSON.parse(row.transports) as AuthenticatorTransport[])
            : undefined,
        deviceType: row.deviceType as CredentialDeviceType,
        backedUp: row.backedUp,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt ?? undefined,
        label: row.label ?? undefined,
    };
}

export function makeCredentialRepo(db: Db): CredentialRepo {
    return {
        findById(id) {
            const [row] = db
                .select()
                .from(webauthnCredentials)
                .where(eq(webauthnCredentials.id, id))
                .limit(1)
                .all();
            return row ? toDomain(row) : undefined;
        },
        listByUserId(userId) {
            const rows = db
                .select()
                .from(webauthnCredentials)
                .where(eq(webauthnCredentials.userId, userId))
                .all();
            return rows.map(toDomain);
        },
        countByUserId(userId) {
            const rows = db
                .select({ id: webauthnCredentials.id })
                .from(webauthnCredentials)
                .where(eq(webauthnCredentials.userId, userId))
                .all();
            return rows.length;
        },
        insert(cred) {
            db.insert(webauthnCredentials)
                .values({
                    id: cred.id,
                    userId: cred.userId,
                    publicKey: Buffer.from(cred.publicKey),
                    counter: cred.counter,
                    transports: cred.transports ? JSON.stringify(cred.transports) : null,
                    deviceType: cred.deviceType,
                    backedUp: cred.backedUp,
                    createdAt: cred.createdAt,
                    lastUsedAt: cred.lastUsedAt ?? null,
                    label: cred.label ?? null,
                })
                .run();
        },
        updateCounter(id, counter) {
            db.update(webauthnCredentials)
                .set({ counter })
                .where(eq(webauthnCredentials.id, id))
                .run();
        },
        updateUsage(id, lastUsedAt, counter) {
            db.update(webauthnCredentials)
                .set({ counter, lastUsedAt })
                .where(eq(webauthnCredentials.id, id))
                .run();
        },
        setLabel(id, label) {
            db.update(webauthnCredentials)
                .set({ label: label ?? null })
                .where(eq(webauthnCredentials.id, id))
                .run();
        },
        delete(id) {
            db.delete(webauthnCredentials)
                .where(eq(webauthnCredentials.id, id))
                .run();
        },
    };
}
