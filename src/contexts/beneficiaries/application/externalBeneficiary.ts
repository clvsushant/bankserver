import type { Clock } from "../../../shared/clock";
import type { IdGenerator } from "../../../shared/ids";
import { BENEFICIARY_COOLING_MS } from "../domain/beneficiary";
import {
    createExternalBeneficiary,
    type ExternalBeneficiary,
} from "../domain/externalBeneficiary";
import type { ExternalBeneficiaryRepo } from "./ports";

export function addExternalBeneficiary(
    deps: { repo: ExternalBeneficiaryRepo; ids: IdGenerator; clock: Clock },
    input: {
        ownerUserId: string;
        nickname: string;
        accountNumber: string;
        ifsc: string;
        bankName: string;
        beneficiaryName: string;
        vpa?: string;
        preferredRail?: "imps" | "neft" | "rtgs" | "upi";
    }
): ExternalBeneficiary {
    const existing = deps.repo.findByOwnerAccountIfsc(
        input.ownerUserId,
        input.accountNumber,
        input.ifsc.toUpperCase()
    );
    if (existing) throw new Error("External beneficiary already saved");

    const now = deps.clock.now();
    const b = createExternalBeneficiary({
        id: deps.ids.uuid(),
        ownerUserId: input.ownerUserId,
        nickname: input.nickname,
        accountNumber: input.accountNumber,
        ifsc: input.ifsc,
        bankName: input.bankName,
        beneficiaryName: input.beneficiaryName,
        vpa: input.vpa,
        preferredRail: input.preferredRail,
        status: "pending",
        activatedAt: new Date(now.getTime() + BENEFICIARY_COOLING_MS),
        createdAt: now,
    });
    deps.repo.insert(b);
    return b;
}

export function listExternalBeneficiaries(
    deps: { repo: ExternalBeneficiaryRepo },
    ownerUserId: string
): ExternalBeneficiary[] {
    return deps.repo.listByOwner(ownerUserId);
}
