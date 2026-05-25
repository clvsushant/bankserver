import express from "express";
import { container } from "../../../container";
import { isUuid } from "../../../utils/validate";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../../utils/errors";

export const notificationsRouter = express.Router();

notificationsRouter.get("/", (req, res, next) => {
    try {
        const user = req.user!;
        const unreadOnly = req.query.unread === "true" || req.query.unread === "1";
        const rawLimit = Number(req.query.limit);
        const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50;
        const list = container.repos.notifications.listByUser(user.id, { unreadOnly, limit });
        const unreadCount = container.repos.notifications.countUnread(user.id);
        res.json({ notifications: list.map(serialize), unreadCount });
    } catch (err) {
        next(err);
    }
});

notificationsRouter.post("/:id/read", (req, res, next) => {
    try {
        const user = req.user!;
        const { id } = req.params;
        if (!isUuid(id)) return next(new BadRequestError("Invalid id"));
        const n = container.repos.notifications.findById(id);
        if (!n) return next(new NotFoundError("Notification not found"));
        if (n.userId !== user.id) return next(new ForbiddenError("Not your notification"));
        container.repos.notifications.markRead(id, container.clock.now());
        res.json({ success: true });
    } catch (err) {
        next(err);
    }
});

notificationsRouter.post("/mark-all-read", (req, res, next) => {
    try {
        const user = req.user!;
        container.repos.notifications.markAllRead(user.id, container.clock.now());
        res.json({ success: true });
    } catch (err) {
        next(err);
    }
});

function serialize(n: ReturnType<typeof container.repos.notifications.findById>) {
    if (!n) return null;
    return {
        id: n.id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        readAt: n.readAt?.toISOString(),
        relatedEntityType: n.relatedEntityType,
        relatedEntityId: n.relatedEntityId,
        createdAt: n.createdAt.toISOString(),
    };
}
