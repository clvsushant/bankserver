import express from "express";
import path from "path";
import fs from "fs";
import { parse as parseYaml } from "yaml";
import swaggerUi from "swagger-ui-express";
import { NotFoundError } from "../utils/errors";

/**
 * Public, unencrypted API documentation at GET /api-docs (Swagger UI).
 * Spec: src/api-docs/swagger.yaml (handler JSON + encryption notes in intro).
 */

const router = express.Router();

const SWAGGER_CSP = [
    `default-src 'self'`,
    `script-src 'self' 'unsafe-inline'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data:`,
    `font-src 'self' data:`,
    `connect-src 'self'`,
    `worker-src 'self' blob:`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `object-src 'none'`,
].join("; ");

function resolveDocsDir(): string {
    const candidates = [
        path.resolve(__dirname, "..", "api-docs"),
        path.resolve(__dirname, "..", "..", "src", "api-docs"),
    ];
    return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
}

const SWAGGER_YAML = path.join(resolveDocsDir(), "swagger.yaml");

function loadSpec(): Record<string, unknown> {
    if (!fs.existsSync(SWAGGER_YAML)) {
        throw new NotFoundError("Documentation asset missing", {
            file: "swagger.yaml",
        });
    }
    return parseYaml(fs.readFileSync(SWAGGER_YAML, "utf8")) as Record<string, unknown>;
}

const spec = loadSpec();

router.use((_req, res, next) => {
    res.setHeader("Content-Security-Policy", SWAGGER_CSP);
    next();
});

router.use(swaggerUi.serve);
router.use(
    swaggerUi.setup(spec, {
        customSiteTitle: "Sentinel BankServer API",
        swaggerOptions: {
            deepLinking: true,
            defaultModelsExpandDepth: 0,
            defaultModelExpandDepth: 0,
            tagsSorter: "alpha",
            operationsSorter: (
                a: { get: (key: string) => unknown },
                b: { get: (key: string) => unknown }
            ) => {
                const oa = Number(a.get("x-call-order") ?? 999);
                const ob = Number(b.get("x-call-order") ?? 999);
                if (oa !== ob) return oa - ob;
                return String(a.get("path")).localeCompare(String(b.get("path")));
            },
        },
    })
);

export default router;
