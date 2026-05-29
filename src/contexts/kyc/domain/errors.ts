export class KycAlreadyExistsError extends Error {
    constructor() {
        super("Active or approved KYC application already exists");
    }
}

export class KycNotFoundError extends Error {
    constructor() {
        super("KYC application not found");
    }
}

export class KycInvalidTransitionError extends Error {
    constructor(from: string, to: string) {
        super(`Invalid KYC state transition: ${from} -> ${to}`);
    }
}

export class KycInvalidPanError extends Error {
    constructor() {
        super("Invalid PAN format");
    }
}

export class KycBankingAccessDeniedError extends Error {
    constructor(message = "Banking access requires approved KYC and an active account") {
        super(message);
    }
}
