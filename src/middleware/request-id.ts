import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { runWithContext, type RequestContext } from "../utils/context-storage";

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction) => {
    // Honor an inbound x-request-id if the caller supplies one (capped) so a
    // chain of services can correlate logs; otherwise mint a fresh uuid.
    const inbound = req.headers["x-request-id"];
    const requestId =
        typeof inbound === "string" && inbound.length > 0 && inbound.length <= 128
            ? inbound
            : randomUUID();

    res.setHeader("x-request-id", requestId);

    const context: RequestContext = { requestId };
    runWithContext(context, () => {
        next();
    });
};
