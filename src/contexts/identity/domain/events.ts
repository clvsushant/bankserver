/**
 * Identity-context domain events. The wildcard audit subscriber in
 * `container.ts` translates each into an audit row via `fromBusEvent`.
 *
 * Other identity events (`PasswordChanged`, `PasskeyRevoked`) are still
 * defined inline at their publish sites for historical reasons; new events
 * should live here.
 */

export interface PasskeyEnrolledAdditionalEvent {
    type: "PasskeyEnrolledAdditional";
    userId: string;
    username: string;
    credentialId: string;
    enrolledAt: Date;
}

export interface RecoveryCodeIssuedEvent {
    type: "RecoveryCodeIssued";
    userId: string;
    username: string;
    recoveryId: string;
    issuedByAdminId: string;
    purpose: "passkey-add";
    expiresAt: Date;
    issuedAt: Date;
}

export interface RecoveryCodeConsumedEvent {
    type: "RecoveryCodeConsumed";
    userId: string;
    recoveryId: string;
    purpose: "passkey-add";
    consumedAt: Date;
}

export type IdentityRecoveryEvent =
    | PasskeyEnrolledAdditionalEvent
    | RecoveryCodeIssuedEvent
    | RecoveryCodeConsumedEvent;
