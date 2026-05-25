import app from "./app";
import { container } from "./container";
import { runDueInstructions } from "./contexts/standingInstructions/application/runDueInstructions";
import logger from "./utils/logger";

const port = Number(process.env.PORT) || 4000;
const host = process.env.HOST || "0.0.0.0";

const SI_TICK_MS = Number(process.env.SI_TICK_MS) || 60_000;

app.listen(port, host, () => {
    logger.info(`Server is running on http://localhost:${port} (bound on ${host}:${port})`);
});

// Standing-instruction runner. Fires every minute (configurable via
// SI_TICK_MS) and processes every active SI whose nextRunAt <= now.
// Disabled under NODE_ENV=test to keep test runs deterministic.
if (process.env.NODE_ENV !== "test") {
    const tick = setInterval(() => {
        try {
            const result = runDueInstructions({
                db: container.db,
                clock: container.clock,
                ids: container.ids,
                bus: container.bus,
                siRepo: container.repos.standingInstructions,
                beneficiaries: container.repos.beneficiaries,
            });
            if (result.totalDue > 0) {
                logger.info(
                    `Standing instructions tick: ${result.succeeded} ok / ${result.failed} failed of ${result.totalDue}`
                );
                if (result.failed > 0) {
                    logger.warn(
                        `Standing instruction failures: ${JSON.stringify(result.failures)}`
                    );
                }
            }
        } catch (e) {
            logger.error(
                "Standing instruction runner crashed",
                e instanceof Error ? { message: e.message, stack: e.stack } : { error: String(e) }
            );
        }
    }, SI_TICK_MS);
    tick.unref();
}
