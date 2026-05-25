export class StandingInstructionNotFoundError extends Error {
    constructor() {
        super("Standing instruction not found");
    }
}

export class StandingInstructionInvalidStateError extends Error {
    constructor(from: string, to: string) {
        super(`Cannot transition standing instruction from ${from} to ${to}`);
    }
}
