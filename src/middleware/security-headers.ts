import { Request, Response, NextFunction } from "express";

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5174";

/**
 * Layer 1: HTTP-level XSS hardening.
 *
 * - CSP locks the page down so injected JS can't load remote code, exec
 *   strings, or post to arbitrary origins.
 * - `require-trusted-types-for 'script'` blocks string -> DOM sinks
 *   (innerHTML, eval, setTimeout("..."), new Function, ...). React 19 plays
 *   nicely with it.
 * - The other headers stop content-type sniffing, force same-origin window
 *   isolation, and disable powerful browser APIs by default.
 *
 * NOTE: this middleware sits on the API server. In a real deployment the
 * SAME headers should be returned from whatever serves the static frontend
 * bundle (vite preview / nginx / CDN). The CSP `script-src` etc. only
 * govern the document that the browser is currently rendering; sending
 * them from a JSON API has no effect on a separate React app.
 *
 * In dev, Vite injects inline scripts and uses HMR via WebSocket. We relax
 * `script-src` and `connect-src` only when NODE_ENV !== "production".
 */
export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction) {
    const isProd = process.env.NODE_ENV === "production";

    const scriptSrc = isProd
        ? ["'self'", "'strict-dynamic'"]
        : ["'self'", "'unsafe-inline'", "'unsafe-eval'"];

    const connectSrc = isProd
        ? ["'self'", FRONTEND_ORIGIN]
        : ["'self'", FRONTEND_ORIGIN, "ws:", "wss:"]; // Vite HMR

    const csp = [
        `default-src 'self'`,
        `script-src ${scriptSrc.join(" ")}`,
        `style-src 'self' 'unsafe-inline'`,
        `img-src 'self' data:`,
        `font-src 'self' data:`,
        `connect-src ${connectSrc.join(" ")}`,
        `frame-ancestors 'none'`,
        `base-uri 'none'`,
        `object-src 'none'`,
        `form-action 'self'`,
        `worker-src 'self' blob:`, // Layer 4 worker is bundled by Vite into a same-origin URL
        ...(isProd ? [`upgrade-insecure-requests`] : []),
        ...(isProd
            ? [`require-trusted-types-for 'script'`, `trusted-types default react`]
            : []),
    ].join("; ");

    res.setHeader("Content-Security-Policy", csp);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader(
        "Permissions-Policy",
        ["geolocation=()", "camera=()", "microphone=()", "payment=()"].join(", ")
    );
    if (isProd) {
        res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }

    next();
}
