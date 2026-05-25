export class CardNotFoundError extends Error {
    constructor() {
        super("Card not found");
    }
}

export class CardInvalidStateError extends Error {
    constructor(from: string, to: string) {
        super(`Cannot transition card from ${from} to ${to}`);
    }
}
