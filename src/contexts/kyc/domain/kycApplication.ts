import type { AccountType } from "../../accounts/domain/account";
import { isAccountType } from "../../accounts/domain/account";
import { KycInvalidTransitionError, KycInvalidPanError } from "./errors";

export type KycStatus = "Submitted" | "Approved" | "Rejected";

export interface KycApplication {
    readonly id: string;
    readonly userId: string;
    readonly fullName: string;
    readonly dob: string; // ISO YYYY-MM-DD
    readonly pan: string;
    readonly address: string;
    readonly docB64?: string;
    readonly requestedAccountType: AccountType;
    status: KycStatus;
    readonly submittedAt: Date;
    decidedAt?: Date;
    decidedByUserId?: string;
    rejectReason?: string;
}

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export function submit(input: {
    id: string;
    userId: string;
    fullName: string;
    dob: string;
    pan: string;
    address: string;
    docB64?: string;
    requestedAccountType?: AccountType;
    submittedAt: Date;
}): KycApplication {
    if (!input.fullName.trim()) throw new Error("Full name required");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dob)) throw new Error("Invalid DOB format");
    const pan = input.pan.toUpperCase();
    if (!PAN_REGEX.test(pan)) throw new KycInvalidPanError();
    if (!input.address.trim()) throw new Error("Address required");
    const requestedAccountType: AccountType = isAccountType(input.requestedAccountType)
        ? input.requestedAccountType
        : "savings";

    return {
        id: input.id,
        userId: input.userId,
        fullName: input.fullName.trim(),
        dob: input.dob,
        pan,
        address: input.address.trim(),
        docB64: input.docB64,
        requestedAccountType,
        status: "Submitted",
        submittedAt: input.submittedAt,
    };
}

export function approve(
    app: KycApplication,
    by: { adminUserId: string; at: Date }
): KycApplication {
    if (app.status !== "Submitted") {
        throw new KycInvalidTransitionError(app.status, "Approved");
    }
    return {
        ...app,
        status: "Approved",
        decidedAt: by.at,
        decidedByUserId: by.adminUserId,
    };
}

export function reject(
    app: KycApplication,
    by: { adminUserId: string; at: Date; reason: string }
): KycApplication {
    if (app.status !== "Submitted") {
        throw new KycInvalidTransitionError(app.status, "Rejected");
    }
    if (!by.reason.trim()) throw new Error("Reject reason required");
    return {
        ...app,
        status: "Rejected",
        decidedAt: by.at,
        decidedByUserId: by.adminUserId,
        rejectReason: by.reason.trim(),
    };
}
