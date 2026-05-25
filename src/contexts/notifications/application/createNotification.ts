import type { Clock } from "../../../shared/clock";
import type { IdGenerator } from "../../../shared/ids";
import { createNotification, type Notification, type NotificationKind } from "../domain/notification";
import type { NotificationRepo } from "./ports";

export function emitNotification(
    deps: { repo: NotificationRepo; ids: IdGenerator; clock: Clock },
    args: {
        userId: string;
        kind: NotificationKind;
        title: string;
        body: string;
        relatedEntityType?: string;
        relatedEntityId?: string;
    }
): Notification {
    const n = createNotification({
        id: deps.ids.uuid(),
        userId: args.userId,
        kind: args.kind,
        title: args.title,
        body: args.body,
        relatedEntityType: args.relatedEntityType,
        relatedEntityId: args.relatedEntityId,
        createdAt: deps.clock.now(),
    });
    deps.repo.insert(n);
    return n;
}
