import type { Clock } from "../../../shared/clock";
import type { EventBus } from "../../../shared/eventBus";
import { approve, reject } from "../domain/kycApplication";
import type { KycApplication } from "../domain/kycApplication";
import type { KycEvent } from "../domain/events";
import { KycNotFoundError } from "../domain/errors";
import type { KycRepo } from "./ports";

export function approveKyc(
    deps: { repo: KycRepo; clock: Clock; bus: EventBus },
    args: { applicationId: string; adminUserId: string }
): KycApplication {
    const current = deps.repo.findById(args.applicationId);
    if (!current) throw new KycNotFoundError();

    const next = approve(current, { adminUserId: args.adminUserId, at: deps.clock.now() });
    deps.repo.update(next);

    const event: KycEvent = {
        type: "KycApproved",
        userId: next.userId,
        applicationId: next.id,
        decidedAt: next.decidedAt!,
    };
    deps.bus.publish([event]);
    return next;
}

export function rejectKyc(
    deps: { repo: KycRepo; clock: Clock; bus: EventBus },
    args: { applicationId: string; adminUserId: string; reason: string }
): KycApplication {
    const current = deps.repo.findById(args.applicationId);
    if (!current) throw new KycNotFoundError();

    const next = reject(current, {
        adminUserId: args.adminUserId,
        at: deps.clock.now(),
        reason: args.reason,
    });
    deps.repo.update(next);

    const event: KycEvent = {
        type: "KycRejected",
        userId: next.userId,
        applicationId: next.id,
        reason: next.rejectReason!,
        decidedAt: next.decidedAt!,
    };
    deps.bus.publish([event]);
    return next;
}
