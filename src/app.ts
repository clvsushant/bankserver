import express, { Request, Response, NextFunction } from "express";
import routes from "./routes";
import { requestIdMiddleware } from "./middleware/request-id";
import { securityHeadersMiddleware } from "./middleware/security-headers";
import { getContext } from "./utils/context-storage";
import { HttpError } from "./utils/errors";
import logger from "./utils/logger";

const app = express();

const ALLOWED_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5174";

app.use(requestIdMiddleware);
app.use(securityHeadersMiddleware);
app.use(express.json({ limit: "64kb" }));

app.use((req: Request, res: Response, next: NextFunction) => {
    res.header("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.header("Vary", "Origin");
    res.header(
        "Access-Control-Allow-Headers",
        "Content-Type, x-session-id, x-request-id, x-action-token"
    );
    res.header("Access-Control-Expose-Headers", "x-request-id, Retry-After");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    const start = process.hrtime();

    res.on("finish", () => {
        const [seconds, nanoseconds] = process.hrtime(start);
        const durationMs = (seconds * 1000 + nanoseconds / 1e6).toFixed(3);

        logger.info(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs}ms)`);
    });

    next();
});

app.get("/", (req: Request, res: Response) => {
    res.send("Hello, TypeScript Backend!");
});

app.use("/", routes);

// 404 fallback for unmatched routes — let the central handler format it.
app.use((req: Request, _res: Response, next: NextFunction) => {
    next(new HttpError(404, "Not Found", { details: { path: req.originalUrl } }));
});

// Centralized error handler. Translates HttpError into a structured JSON
// response and logs unknown errors as 500. The requestId is included in the
// response body and on the `x-request-id` response header so clients can
// quote it back when reporting issues.
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    const requestId = getContext()?.requestId || "unknown";

    if (res.headersSent) {
        return next(err);
    }

    if (err instanceof HttpError) {
        if (err.headers) {
            for (const [k, v] of Object.entries(err.headers)) res.setHeader(k, v);
        }

        if (err.status >= 500) {
            logger.error(`[${err.name}] ${err.publicMessage}`, {
                requestId,
                stack: err.stack,
                details: err.details,
            });
        } else {
            logger.warn(`[${err.name}] ${err.publicMessage} (${err.status})`, {
                requestId,
                details: err.details,
            });
        }

        // res.json is patched by encryptedResponse on routes that establish a
        // session, so the body below is encrypted automatically when possible.
        return res.status(err.status).json({
            success: false,
            error: {
                message: err.publicMessage,
                requestId,
                ...(err.details !== undefined ? { details: err.details } : {}),
            },
        });
    }

    logger.error(`[UnhandledError] ${err.message || "unknown"}`, {
        requestId,
        stack: err.stack,
    });

    return res.status(500).json({
        success: false,
        error: {
            message: "Internal Server Error",
            requestId,
        },
    });
});

export default app;
