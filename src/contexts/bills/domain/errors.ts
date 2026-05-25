export class BillerNotFoundError extends Error {
    constructor() {
        super("Biller not found");
    }
}

export class BillerInactiveError extends Error {
    constructor() {
        super("Biller is not active");
    }
}
