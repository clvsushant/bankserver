import crypto from "crypto";
import { promisify } from "util";

const generateKeyPairAsync = promisify(crypto.generateKeyPair);

/**
 * Layer 3: ECDH (P-256) instead of RSA.
 *
 * Both sides generate their own ephemeral P-256 keypair and exchange public
 * keys over the wire. Each side then runs ECDH + HKDF locally to derive a
 * 32-byte AES-GCM key. The raw key bytes never travel on the wire and on
 * the client they never enter the main JS heap (see Layer 4: derivation
 * happens inside a Web Worker and the resulting CryptoKey is created with
 * `extractable: false`, so XSS cannot exfiltrate the key bytes).
 */

export interface EcdhKeyPair {
    publicJwk: JsonWebKey;
    privateKey: crypto.KeyObject;
}

export async function generateEcdhKeyPair(): Promise<EcdhKeyPair> {
    const { publicKey, privateKey } = await generateKeyPairAsync("ec", {
        namedCurve: "P-256",
    });
    return {
        publicJwk: publicKey.export({ format: "jwk" }) as JsonWebKey,
        privateKey,
    };
}

/**
 * Derives the shared 32-byte AES-256 key from our private ECDH key + the
 * peer's public ECDH JWK using ECDH then HKDF-SHA-256.
 *
 * The HKDF `info` parameter must match the client. We use a stable label
 * combining the protocol version and a salt that is sent on the wire as
 * part of the handshake. The salt is included so the same ephemeral
 * keypair never produces the same AES key twice across protocol revisions.
 */
export function deriveAesKey(
    ourPrivate: crypto.KeyObject,
    peerPublicJwk: JsonWebKey,
    salt: Buffer
): Buffer {
    const peerPublic = crypto.createPublicKey({ key: peerPublicJwk, format: "jwk" });
    const sharedSecret = crypto.diffieHellman({ privateKey: ourPrivate, publicKey: peerPublic });

    // hkdfSync returns ArrayBuffer; convert to Buffer.
    const info = Buffer.from("sbe/v1/aes-256-gcm", "utf8");
    const derivedAb = crypto.hkdfSync("sha256", sharedSecret, salt, info, 32);
    return Buffer.from(derivedAb);
}
