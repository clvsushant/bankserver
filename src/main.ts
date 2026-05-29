import app from "./app";
import { container } from "./container";
import { runDueInstructions } from "./contexts/standingInstructions/application/runDueInstructions";
import { matureFixedDeposits } from "./contexts/accounts/application/matureFixedDeposits";
import { settlePendingTransfers } from "./contexts/payments/application/settlePendingTransfers";
import { runMigrations } from "./db/runMigrations";
import logger from "./utils/logger";

const port = Number(process.env.PORT) || 4000;
const host = process.env.HOST || "0.0.0.0";

const SI_TICK_MS = Number(process.env.SI_TICK_MS) || 60_000;
const FD_TICK_MS = Number(process.env.FD_TICK_MS) || 60_000;
const SETTLE_TICK_MS = Number(process.env.SETTLE_TICK_MS) || 120_000;

runMigrations();

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
                notifications: container.repos.notifications,
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

    const fdTick = setInterval(() => {
        try {
            const result = matureFixedDeposits({
                db: container.db,
                fixedDeposits: container.repos.fixedDeposits,
                clock: container.clock,
                ids: container.ids,
            });
            if (result.matured > 0) {
                logger.info(
                    `FD maturity tick: ${result.matured} matured / ${result.failed} failed`
                );
            }
        } catch (e) {
            logger.error(
                "FD maturity runner crashed",
                e instanceof Error ? { message: e.message, stack: e.stack } : { error: String(e) }
            );
        }
    }, FD_TICK_MS);
    fdTick.unref();

    const settleTick = setInterval(() => {
        try {
            const neft = settlePendingTransfers(
                {
                    db: container.db,
                    clock: container.clock,
                    ids: container.ids,
                    bus: container.bus,
                },
                "neft"
            );
            const rtgs = settlePendingTransfers(
                {
                    db: container.db,
                    clock: container.clock,
                    ids: container.ids,
                    bus: container.bus,
                },
                "rtgs"
            );
            const total = neft.settled + rtgs.settled;
            if (total > 0) {
                logger.info(
                    `Rail settlement tick: NEFT ${neft.settled}/${neft.failed}, RTGS ${rtgs.settled}/${rtgs.failed}`
                );
            }
        } catch (e) {
            logger.error(
                "Rail settlement runner crashed",
                e instanceof Error ? { message: e.message, stack: e.stack } : { error: String(e) }
            );
        }
    }, SETTLE_TICK_MS);
    settleTick.unref();
}
