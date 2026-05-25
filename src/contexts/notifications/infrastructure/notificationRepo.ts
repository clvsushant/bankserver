import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "../../../db/client";
import { notifications } from "../../../db/schema";
import type { Notification, NotificationKind } from "../domain/notification";
import type { NotificationRepo } from "../application/ports";

function toDomain(row: typeof notifications.$inferSelect): Notification {
    return {
        id: row.id,
        userId: row.userId,
        kind: row.kind as NotificationKind,
        title: row.title,
        body: row.body,
        readAt: row.readAt ?? undefined,
        relatedEntityType: row.relatedEntityType ?? undefined,
        relatedEntityId: row.relatedEntityId ?? undefined,
        createdAt: row.createdAt,
    };
}

export function makeNotificationRepo(db: Db): NotificationRepo {
    return {
        findById(id) {
            const [row] = db
                .select()
                .from(notifications)
                .where(eq(notifications.id, id))
                .limit(1)
                .all();
            return row ? toDomain(row) : undefined;
        },
        listByUser(userId, opts) {
            const limit = opts?.limit ?? 100;
            const where = opts?.unreadOnly
                ? and(eq(notifications.userId, userId), isNull(notifications.readAt))
                : eq(notifications.userId, userId);
            const rows = db
                .select()
                .from(notifications)
                .where(where)
                .orderBy(desc(notifications.createdAt))
                .limit(limit)
                .all();
            return rows.map(toDomain);
        },
        countUnread(userId) {
            const rows = db
                .select({ id: notifications.id })
                .from(notifications)
                .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
                .all();
            return rows.length;
        },
        insert(n) {
            db.insert(notifications)
                .values({
                    id: n.id,
                    userId: n.userId,
                    kind: n.kind,
                    title: n.title,
                    body: n.body,
                    readAt: n.readAt ?? null,
                    relatedEntityType: n.relatedEntityType ?? null,
                    relatedEntityId: n.relatedEntityId ?? null,
                    createdAt: n.createdAt,
                })
                .run();
        },
        markRead(id, at) {
            db.update(notifications)
                .set({ readAt: at })
                .where(eq(notifications.id, id))
                .run();
        },
        markAllRead(userId, at) {
            db.update(notifications)
                .set({ readAt: at })
                .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
                .run();
        },
    };
}
