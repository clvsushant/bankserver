import express from "express";
import path from "path";
import fs from "fs";
import { NotFoundError } from "../utils/errors";

/**
 * Public, unencrypted, unauthenticated API documentation.
 *
 *   GET /api-docs                  — landing page (links to all viewers)
 *   GET /api-docs/swagger-ui       — interactive Swagger UI ("Try it out")
 *   GET /api-docs/redoc            — live Redoc viewer (loads YAML over HTTP)
 *   GET /api-docs/docs.html        — pre-built Redoc bundle (offline-friendly)
 *   GET /api-docs/swagger.yaml     — raw OpenAPI 3.1 spec
 *   GET /api-docs/openapi.yaml     — alias of swagger.yaml
 *
 * The two source assets (`swagger.yaml` + `docs.html`) live under
 * `src/api-docs/`. The folder is resolved at runtime relative to this
 * module, so it works from `ts-node src/main.ts` (dev) and from
 * `node dist/main.js` (after `npm run build` mirrors the folder into
 * `dist/api-docs/`).
 */

const router = express.Router();

/**
 * Relaxed CSP applied only to the viewer HTML pages. These pages legitimately
 * pull Swagger UI / Redoc bundles and CSS from CDNs and need inline
 * scripts / styles to bootstrap. The default app-wide CSP (set by
 * `securityHeadersMiddleware`) is far stricter and is restored for every
 * other route.
 */
const VIEWER_CSP = [
    `default-src 'self'`,
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.redocly.com https://cdn.jsdelivr.net`,
    `style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com https://cdn.jsdelivr.net`,
    `font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net`,
    `img-src 'self' data: https:`,
    // CSS / JS source-map fetches go through connect-src, as do any
    // runtime fetch() calls Swagger UI / Redoc make against their bundles.
    `connect-src 'self' https://unpkg.com https://cdn.redocly.com https://cdn.jsdelivr.net`,
    `worker-src 'self' blob:`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `object-src 'none'`,
].join("; ");

function sendViewerHtml(res: express.Response, html: string): void {
    res.setHeader("Content-Security-Policy", VIEWER_CSP);
    res.type("text/html; charset=utf-8").send(html);
}

/**
 * Computes the URL prefix the browser needs to anchor relative links to,
 * regardless of where this router is mounted or whether a reverse proxy
 * adds its own prefix.
 *
 *   - `req.baseUrl` is whatever path the router is mounted at, e.g.
 *     `/api-docs` or `/v1/api-docs` or `""` when mounted at `/`.
 *   - `X-Forwarded-Prefix` is the standard header reverse proxies set when
 *     they strip a path prefix before forwarding (so the browser sees
 *     `/edge/api-docs` but Express only sees `/api-docs`).
 *
 * The result is always one path segment ending in `/`, so emitting it as
 * `<base href="...">` makes every relative URL in the document resolve
 * back under this router — even if the user hits the URL without a
 * trailing slash.
 */
function basePath(req: express.Request): string {
    const safe = (s: unknown): string =>
        typeof s === "string" ? s.replace(/[^A-Za-z0-9._~/%-]/g, "") : "";
    const prefix = safe(req.headers["x-forwarded-prefix"]).replace(/\/+$/, "");
    const mount = safe(req.baseUrl);
    return (prefix + mount + "/").replace(/\/+/g, "/");
}

/**
 * Resolves the docs directory at runtime. Tries (in order):
 *   1. `<this module>/../api-docs`      — works for both `src/` (ts-node)
 *                                          and `dist/` after `npm run build`
 *                                          copies the folder.
 *   2. `<this module>/../../src/api-docs` — fallback for `node dist/main.js`
 *                                          when only `tsc` ran without the
 *                                          asset copy step.
 */
function resolveDocsDir(): string {
    const candidates = [
        path.resolve(__dirname, "..", "api-docs"),
        path.resolve(__dirname, "..", "..", "src", "api-docs"),
    ];
    return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
}

const DOCS_DIR = resolveDocsDir();

const SWAGGER_YAML = path.join(DOCS_DIR, "swagger.yaml");
const DOCS_HTML = path.join(DOCS_DIR, "docs.html");

function sendFileOr404(
    res: express.Response,
    next: express.NextFunction,
    filePath: string,
    contentType: string
): void {
    if (!fs.existsSync(filePath)) {
        return next(
            new NotFoundError("Documentation asset missing", {
                file: path.basename(filePath),
            })
        );
    }
    res.type(contentType);
    res.sendFile(filePath, (err) => {
        if (err) next(err);
    });
}

router.get("/swagger.yaml", (_req, res, next) => {
    sendFileOr404(res, next, SWAGGER_YAML, "application/yaml; charset=utf-8");
});

router.get("/openapi.yaml", (_req, res, next) => {
    sendFileOr404(res, next, SWAGGER_YAML, "application/yaml; charset=utf-8");
});

router.get("/docs.html", (_req, res, next) => {
    if (!fs.existsSync(DOCS_HTML)) {
        return next(
            new NotFoundError("Documentation asset missing", {
                file: path.basename(DOCS_HTML),
            })
        );
    }
    res.setHeader("Content-Security-Policy", VIEWER_CSP);
    res.type("text/html; charset=utf-8");
    res.sendFile(DOCS_HTML, (err) => {
        if (err) next(err);
    });
});

function renderSwaggerUi(base: string): string {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <base href="${base}" />
    <title>Sentinel BankServer — Swagger UI</title>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <link
      rel="stylesheet"
      href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css"
    />
    <style>
      body { margin: 0; background: #fafafa; }
      .topbar { display: none; }
      /* Surfaces the x-decrypted-request / x-decrypted-response schema
         explorer below the wire-level envelope. Visually distinct so it's
         obvious these are *documentation* views, not separate endpoints. */
      .decrypted-panel {
        margin: 12px 0 20px 0;
        padding: 12px 16px;
        border-left: 3px solid #4990e2;
        background: rgba(73, 144, 226, 0.06);
        border-radius: 0 4px 4px 0;
      }
      .decrypted-panel__title {
        margin: 0 0 8px 0;
        font-size: 13px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #3b3b3b;
      }
      .decrypted-panel__title code {
        background: rgba(0, 0, 0, 0.06);
        padding: 1px 6px;
        border-radius: 3px;
        font-size: 12px;
        text-transform: none;
        letter-spacing: 0;
      }
      .decrypted-panel__subtitle {
        margin: -4px 0 10px 0;
        font-size: 12px;
        font-style: italic;
        color: #6b6b6b;
      }
      .decrypted-panel__subtitle code {
        font-style: normal;
        background: rgba(0, 0, 0, 0.05);
        padding: 0 4px;
        border-radius: 3px;
      }
      .decrypted-panel .model-box,
      .decrypted-panel .model-container { background: transparent; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js" crossorigin></script>
    <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-standalone-preset.js" crossorigin></script>
    <script>
      // -----------------------------------------------------------------
      // DecryptedShapesPlugin
      //
      // Wire-level requestBody / responses always reference the opaque
      // EnvelopedRequest / EnvelopedResponse schemas. The actual JSON the
      // route handler reads/returns is documented per-operation via the
      // \`x-decrypted-request\` / \`x-decrypted-response\` extensions in
      // swagger.yaml. Stock Swagger UI doesn't render \`x-\` extensions,
      // so this plugin appends a "Decrypted body / Decrypted response"
      // panel that reuses Swagger UI's own \`Model\` schema explorer.
      // -----------------------------------------------------------------
      var DecryptedShapesPlugin = function (system) {
        var React = system.React;

        function lookup(props, key) {
          // props.specPath points directly to "requestBody" or "responses.<status_code>"
          var sp = props.specPath;
          if (!sp) return null;
          
          // Convert immutable structure to regular JS Array
          var pathArray = sp.toJS ? sp.toJS() : sp;
          
          // Check if extension is defined directly at the current component block level
          var currentBlock = props.specSelectors.specJson().getIn(pathArray);
          if (currentBlock && currentBlock.get && currentBlock.get(key)) {
            return currentBlock.get(key);
          }
          
          // Fallback: If it's not inside requestBody/responses, step out 
          // one level to check the root operation node (handles legacy positioning)
          var parentArray = pathArray.slice(0, -1);
          if (key === "x-decrypted-response") {
            // responses spec path has an extra nesting level due to status codes (e.g., responses -> 200)
            parentArray = pathArray.slice(0, -2); 
          }
          var parentBlock = props.specSelectors.specJson().getIn(parentArray);
          return parentBlock && parentBlock.get ? parentBlock.get(key) : null;
        }

        function Panel(props) {
          var Model = props.getComponent("Model", true);
          var ext = props.ext;
          var refStr = ext && ext.get ? ext.get("$ref") : null;
          var name = refStr ? String(refStr).split("/").pop() : null;
          var schema = ext;
          if (name) {
            var resolved = props.specSelectors.findDefinition(name);
            if (resolved) schema = resolved;
          }
          var titleNode = React.createElement(
            "h4",
            { className: "decrypted-panel__title" },
            props.title + ": ",
            name
              ? React.createElement("code", null, name)
              : React.createElement("span", null, "(inline schema)")
          );
          // Subtitle clarifies that the schema below describes the \`data\`
          // field of the inner DecryptedEnvelope, not the entire decrypted
          // plaintext (which is { data, nonce, timestamp }).
          var subtitleNode = React.createElement(
            "p",
            { className: "decrypted-panel__subtitle" },
            "Schema of the ",
            React.createElement("code", null, "data"),
            " field inside ",
            React.createElement("code", null, "{ data, nonce, timestamp }"),
            "."
          );
          var body = Model
            ? React.createElement(Model, {
                schema: schema,
                name: name || "InlineSchema",
                expandDepth: 1,
                depth: 0,
                getComponent: props.getComponent,
                specSelectors: props.specSelectors,
              })
            : React.createElement(
                "pre",
                null,
                JSON.stringify(
                  schema && schema.toJS ? schema.toJS() : schema,
                  null,
                  2
                )
              );
          return React.createElement(
            "div",
            { className: "decrypted-panel" },
            titleNode,
            subtitleNode,
            body
          );
        }

        return {
          wrapComponents: {
            RequestBody: function (Original) {
              return function (props) {
                var ext = lookup(props, "x-decrypted-request");
                return React.createElement(
                  React.Fragment,
                  null,
                  React.createElement(Original, props),
                  ext
                    ? React.createElement(Panel, {
                        title: "Decrypted body",
                        ext: ext,
                        getComponent: props.getComponent,
                        specSelectors: props.specSelectors,
                      })
                    : null
                );
              };
            },
            responses: function (Original) {
              return function (props) {
                var ext = lookup(props, "x-decrypted-response");
                return React.createElement(
                  React.Fragment,
                  null,
                  React.createElement(Original, props),
                  ext
                    ? React.createElement(Panel, {
                        title: "Decrypted response",
                        ext: ext,
                        getComponent: props.getComponent,
                        specSelectors: props.specSelectors,
                      })
                    : null
                );
              };
            },
          },
        };
      };

      window.addEventListener("load", function () {
        window.ui = SwaggerUIBundle({
          url: "swagger.yaml",
          dom_id: "#swagger-ui",
          deepLinking: true,
          tagsSorter: "alpha",
          operationsSorter: function (a, b) {
            var oa = (a.get("x-call-order") || 999);
            var ob = (b.get("x-call-order") || 999);
            if (oa !== ob) return oa - ob;
            return a.get("path").localeCompare(b.get("path"));
          },
          presets: [
            SwaggerUIBundle.presets.apis,
            SwaggerUIStandalonePreset,
          ],
          plugins: [
            SwaggerUIBundle.plugins.DownloadUrl,
            DecryptedShapesPlugin,
          ],
          layout: "StandaloneLayout",
          persistAuthorization: true,
          // Hide the "Schemas" section at the bottom of the page.
          // -1 collapses + removes it; 0 would just collapse.
          defaultModelsExpandDepth: -1,
          defaultModelExpandDepth: 0,
        });
      });
    </script>
  </body>
</html>`;
}

router.get("/swagger-ui", (req, res) => {
    sendViewerHtml(res, renderSwaggerUi(basePath(req)));
});

function renderRedoc(base: string): string {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <base href="${base}" />
    <title>Sentinel BankServer — Redoc</title>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>body { margin: 0; padding: 0; }</style>
  </head>
  <body>
    <redoc spec-url="swagger.yaml" sort-operations-alphabetically></redoc>
    <script src="https://cdn.redocly.com/redoc/v2.5.1/bundles/redoc.standalone.js"></script>
  </body>
</html>`;
}

router.get("/redoc", (req, res) => {
    sendViewerHtml(res, renderRedoc(basePath(req)));
});

function renderLanding(base: string): string {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <base href="${base}" />
    <title>Sentinel BankServer — API documentation</title>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      :root { color-scheme: light dark; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
          sans-serif;
        max-width: 760px;
        margin: 4rem auto;
        padding: 0 1.5rem;
        color: #1f2937;
        line-height: 1.55;
      }
      h1 { margin-bottom: 0.25rem; }
      p.lede { color: #4b5563; margin-top: 0; }
      .card-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 1rem;
        margin: 1.75rem 0;
      }
      .card {
        display: block;
        padding: 1.1rem 1.2rem;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        text-decoration: none;
        color: inherit;
        background: #ffffff;
        transition: border-color 120ms ease, transform 120ms ease;
      }
      .card:hover {
        border-color: #2563eb;
        transform: translateY(-1px);
      }
      .card h3 { margin: 0 0 0.35rem; font-size: 1.05rem; }
      .card p  { margin: 0; color: #4b5563; font-size: 0.92rem; }
      code {
        background: #f3f4f6;
        padding: 0.1rem 0.35rem;
        border-radius: 4px;
        font-size: 0.95em;
      }
      .footer { margin-top: 2rem; color: #6b7280; font-size: 0.85rem; }
      @media (prefers-color-scheme: dark) {
        body  { color: #e5e7eb; }
        .card { background: #111827; border-color: #1f2937; }
        .card p, p.lede, .footer { color: #9ca3af; }
        code  { background: #1f2937; }
      }
    </style>
  </head>
  <body>
    <h1>Sentinel BankServer API</h1>
    <p class="lede">
      OpenAPI 3.1 spec — 18 numbered flow tags, ordered by call order.
      Pick a viewer:
    </p>

    <div class="card-grid">
      <a class="card" href="swagger-ui">
        <h3>Swagger UI &rarr;</h3>
        <p>Interactive — expand operations and use "Try it out" against this server.</p>
      </a>
      <a class="card" href="redoc">
        <h3>Redoc (live) &rarr;</h3>
        <p>Read-only three-pane reference. Loads the latest YAML over HTTP.</p>
      </a>
      <a class="card" href="docs.html">
        <h3>Redoc (pre-built) &rarr;</h3>
        <p>Self-contained HTML bundle — works offline once cached.</p>
      </a>
      <a class="card" href="swagger.yaml">
        <h3>swagger.yaml &rarr;</h3>
        <p>Raw OpenAPI spec. Paste into Postman / Stoplight / your IDE.</p>
      </a>
    </div>

    <p class="footer">
      These endpoints are intentionally unauthenticated and unencrypted —
      they describe the wire envelope used by every <em>other</em> route.
      Alias: <code>GET ${base}openapi.yaml</code> &equiv;
      <code>GET ${base}swagger.yaml</code>.
    </p>
  </body>
</html>`;
}

router.get("/", (req, res) => {
    sendViewerHtml(res, renderLanding(basePath(req)));
});

export default router;
