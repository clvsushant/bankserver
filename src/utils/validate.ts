const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
    return typeof value === "string" && UUID_RE.test(value);
}

export function isNonEmptyString(value: unknown, maxLength = Infinity): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}
