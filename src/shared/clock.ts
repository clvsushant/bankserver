/**
 * Domain code never reads `Date.now()` directly; it asks the Clock port.
 * Tests inject a fixed clock to make timestamps deterministic.
 */
export interface Clock {
    now(): Date;
}

export const systemClock: Clock = {
    now: () => new Date(),
};
