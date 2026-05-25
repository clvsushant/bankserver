export class UsernameTakenError extends Error {
    constructor() {
        super("Username already taken");
    }
}

export class UnknownUserError extends Error {
    constructor() {
        super("Unknown user");
    }
}

export class UnknownCredentialError extends Error {
    constructor() {
        super("Unknown credential");
    }
}

export class WeakPasswordError extends Error {
    constructor(reason: string) {
        super(reason);
    }
}

export class AccountLockedError extends Error {
    constructor() {
        super("Account is locked");
    }
}

export class InvalidCredentialsError extends Error {
    constructor() {
        super("Invalid credentials");
    }
}

export class InvalidEmailError extends Error {
    constructor() {
        super("Invalid email");
    }
}
