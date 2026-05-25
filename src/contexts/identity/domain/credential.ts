export type AuthenticatorTransport =
    | "ble"
    | "cable"
    | "hybrid"
    | "internal"
    | "nfc"
    | "smart-card"
    | "usb";

export type CredentialDeviceType = "singleDevice" | "multiDevice";

export interface WebAuthnCredential {
    readonly id: string; // base64url
    readonly userId: string;
    readonly publicKey: Uint8Array;
    counter: number;
    readonly transports?: AuthenticatorTransport[];
    readonly deviceType: CredentialDeviceType;
    readonly backedUp: boolean;
    readonly createdAt: Date;
    /** Phase 4 #1 — stamped on every successful authentication. */
    lastUsedAt?: Date;
    /** Phase 4 #1 — user-provided friendly name; null until set. */
    label?: string;
}
