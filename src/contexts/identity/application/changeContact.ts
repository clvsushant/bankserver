import type { UserRepo } from "./ports";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^\+?[1-9]\d{9,14}$/;

export function changeEmail(
    deps: { users: UserRepo },
    input: { userId: string; email: string }
): void {
    const email = input.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new Error("Invalid email");
    deps.users.setEmail(input.userId, email);
}

export function changeMobile(
    deps: { users: UserRepo },
    input: { userId: string; mobile: string }
): void {
    const mobile = input.mobile.trim();
    if (!MOBILE_RE.test(mobile)) throw new Error("Invalid mobile number");
    deps.users.setMobile(input.userId, mobile);
}
