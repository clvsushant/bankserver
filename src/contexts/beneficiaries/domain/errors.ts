export class BeneficiaryNotFoundError extends Error {
    constructor() {
        super("Beneficiary not found");
    }
}

export class BeneficiaryAlreadyExistsError extends Error {
    constructor() {
        super("Beneficiary already saved");
    }
}

export class BeneficiarySelfTargetError extends Error {
    constructor() {
        super("Cannot save your own account as a beneficiary");
    }
}

export class BeneficiaryUnknownAccountError extends Error {
    constructor() {
        super("No account exists with that number");
    }
}

export class BeneficiaryCoolingPeriodError extends Error {
    constructor() {
        super("Beneficiary is in cooling period; transfers not allowed yet");
    }
}
