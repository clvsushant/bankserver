import type { Notification } from "../domain/notification";

export interface NotificationRepo {
    findById(id: string): Notification | undefined;
    listByUser(userId: string, opts?: { unreadOnly?: boolean; limit?: number }): Notification[];
    countUnread(userId: string): number;
    insert(n: Notification): void;
    markRead(id: string, at: Date): void;
    markAllRead(userId: string, at: Date): void;
}
