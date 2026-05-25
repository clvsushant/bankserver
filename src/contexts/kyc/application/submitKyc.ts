import type { Clock } from "../../../shared/clock";
import type { IdGenerator } from "../../../shared/ids";
import type { EventBus } from "../../../shared/eventBus";
import type { KycRepo } from "./ports";
import { submit } from "../domain/kycApplication";
import type { KycApplication } from "../domain/kycApplication";
import type { AccountType } from "../../accounts/domain/account";
import { KycAlreadyExistsError } from "../domain/errors";
import type { KycSubmittedEvent } from "../domain/events";

export interface SubmitKycInput {
    userId: string;
    fullName: string;
    dob: string;
    pan: string;
    address: string;
    docB64?: string;
    requestedAccountType?: AccountType;
}

export function submitKyc(
    deps: { repo: KycRepo; ids: IdGenerator; clock: Clock; bus?: EventBus },
    input: SubmitKycInput
): KycApplication {
    const existing = deps.repo.listByUserId(input.userId);
    const blocking = existing.find((a) => a.status === "Submitted" || a.status === "Approved");
    if (blocking) throw new KycAlreadyExistsError();

    const app = submit({
        id: deps.ids.uuid(),
        userId: input.userId,
        fullName: input.fullName,
        dob: input.dob,
        pan: input.pan,
        address: input.address,
        docB64: input.docB64,
        requestedAccountType: input.requestedAccountType,
        submittedAt: deps.clock.now(),
    });
    deps.repo.insert(app);

    if (deps.bus) {
        const event: KycSubmittedEvent = {
            type: "KycSubmitted",
            userId: app.userId,
            applicationId: app.id,
            submittedAt: app.submittedAt,
        };
        deps.bus.publish([event]);
    }
    return app;
}
