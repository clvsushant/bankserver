import crypto from "crypto";

const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * AES-256-GCM encrypt with the session id bound as Additional Authenticated
 * Data (AAD). The session id is therefore tamper-evident on the wire even
 * though it is sent outside the ciphertext envelope.
 *
 * Wire format: base64( IV(12) || ciphertext || authTag(16) )
 */
export function encryptAES(data: unknown, key: Buffer, aad: string): { payload: string } {
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));

    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
        payload: Buffer.concat([iv, ciphertext, tag]).toString("base64"),
    };
}

export function decryptAES(payload: string, key: Buffer, aad: string): unknown {
    const buf = Buffer.from(payload, "base64");
    if (buf.length < IV_LEN + TAG_LEN) {
        throw new Error("Payload too short");
    }

    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(buf.length - TAG_LEN);
    const ciphertext = buf.subarray(IV_LEN, buf.length - TAG_LEN);

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8"));
}
