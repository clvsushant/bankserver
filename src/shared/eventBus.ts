/**
 * Synchronous in-process event bus.
 *
 * Use case handlers raise domain events at the end of a SQL transaction and
 * call `bus.publish(events)`. Subscribers run synchronously in the order
 * they were registered. If we later need durability across restarts, this
 * gets swapped out for an outbox table + poller without changing handlers.
 */

export interface DomainEvent {
    readonly type: string;
}

export interface EventBus {
    subscribe<T extends DomainEvent>(type: T["type"], handler: (event: T) => void): void;
    /**
     * Subscribe to every event published on the bus, regardless of type.
     * Used by cross-cutting consumers (e.g. the audit log subscriber) so a
     * new event type is captured automatically without touching this file.
     */
    subscribeAll(handler: (event: DomainEvent) => void): void;
    publish(events: DomainEvent[]): void;
}

class InProcessEventBus implements EventBus {
    private handlers = new Map<string, Array<(event: DomainEvent) => void>>();
    private wildcards: Array<(event: DomainEvent) => void> = [];

    subscribe<T extends DomainEvent>(type: T["type"], handler: (event: T) => void): void {
        if (!this.handlers.has(type)) this.handlers.set(type, []);
        this.handlers.get(type)!.push(handler as (event: DomainEvent) => void);
    }

    subscribeAll(handler: (event: DomainEvent) => void): void {
        this.wildcards.push(handler);
    }

    publish(events: DomainEvent[]): void {
        for (const event of events) {
            const list = this.handlers.get(event.type);
            if (list) {
                for (const h of list) h(event);
            }
            for (const w of this.wildcards) {
                try {
                    w(event);
                } catch {
                    // Wildcard subscribers (typically cross-cutting like
                    // audit) MUST NOT take down a publisher. Swallow.
                }
            }
        }
    }
}

export const bus: EventBus = new InProcessEventBus();

/** Test helper to build a fresh isolated bus. */
export function createBus(): EventBus {
    return new InProcessEventBus();
}
