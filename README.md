# bankserver

A small **DDD-style banking backend** with a built-in session-based
encryption layer (ECDH P-256 → HKDF → AES-256-GCM). Every authenticated
request is end-to-server encrypted, sensitive operations require a fresh
WebAuthn passkey gesture, and the domain itself is organized as bounded
contexts with a SQLite + Drizzle persistence layer.

> Demo only. INR-only money stored as integer paise; no real money rails;
> the encryption is **client ↔ server**, not end-to-end (the server holds the
> AES key).

The encryption protocol is documented in the bundled OpenAPI spec at
`/api-docs/swagger-ui` (see **Cryptographic envelope** in the spec intro).
This README covers the banking layer on top of that channel — architecture,
tables, routes, dev workflow, and gotchas.

## Contents

- [Quickstart](#quickstart)
- [Architecture](#architecture)
- [Project layout](#project-layout)
- [Request lifecycle](#request-lifecycle)
- [Bounded contexts](#bounded-contexts)
- [Cross-context events](#cross-context-events)
- [Database](#database)
- [API documentation](#api-documentation)
- [Configuration](#configuration)
- [npm scripts](#npm-scripts)
- [Testing](#testing)
- [Common dev tasks](#common-dev-tasks)
- [Logging](#logging)
- [Troubleshooting](#troubleshooting)

## Quickstart

Requires Node 20 LTS or 24+. The native `better-sqlite3` addon must be built
against the Node version you intend to run with — see
[Troubleshooting](#troubleshooting).

```bash
cd bankserver
npm install
npm run db:migrate                # creates ./bankserver.sqlite
npm run db:seed                   # admin user + 6 billers
npm run db:seed:test-customers    # optional: 100 demo customers (test_1 .. test_100)
npm run dev                       # http://localhost:4000
```

That gives you:

| Resource | Value |
| --- | --- |
| Listen URL | `http://localhost:4000` |
| Admin login | username `Admin`, password `Admin@123` (passkey enrolled on first login) |
| Test customers | username `test_<N>`, password `Test<N>@Pass123` for `N = 1 .. 100` |
| API docs | `http://localhost:4000/api-docs/swagger-ui` (or `/redoc`, or raw `/swagger.yaml`) |

Pair it with the companion **bankwebui** SPA on `:5174` for the full UI.

## Architecture

```
┌──────────── HTTP ───────────────────────────────────────────────┐
│                                                                 │
│  Express 5 app                                                  │
│   ├── requestId  → AsyncLocalStorage  → logger prefix           │
│   ├── securityHeaders (CSP / Trusted Types / HSTS in prod)      │
│   ├── express.json (64 KB body cap)                             │
│   ├── CORS + res.on("finish") request log                       │
│   ├── /security/*       — public, plaintext (handshake itself)  │
│   ├── /api-docs/*       — public, plaintext (Swagger UI/Redoc)  │
│   ├── /dev/*            — dev-only login bypass (NODE_ENV≠prod) │
│   ├── /identity/*       — encrypt + decrypt + (per-route auth)  │
│   ├── /webauthn/*       — encrypt + decrypt                     │
│   └── /accounts, /kyc, /transfer, /statements, /beneficiaries,  │
│       /bills, /standing-instructions, /cards, /notifications    │
│       └── encrypt + decrypt + requireSession                    │
│       /admin/*          └── + requireRole("admin")              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────── Composition root (container.ts) ────────────────┐
│ db (Drizzle + better-sqlite3)                                   │
│ clock, ids, eventBus                                            │
│ repos.{users, credentials, kyc, accounts, transfers, ledger,    │
│        beneficiaries, billers, standingInstructions,            │
│        notifications, cards}                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────── Bounded contexts (DDD-style) ───────────────────┐
│   identity / kyc / accounts / payments / beneficiaries / bills  │
│   standingInstructions / statements / notifications / cards     │
│   ──────────────────────────────────────────────────────────    │
│   each context has 4 layers:                                    │
│     domain         — pure types + invariants                    │
│     application    — use-cases, depend on `ports.ts` only       │
│     infrastructure — Drizzle repos + integrations               │
│     interface      — Express routers wired in routes/index.ts   │
└─────────────────────────────────────────────────────────────────┘
```

The four-layer split per context is intentional: **domain** has no imports
from Express, Drizzle, or any other framework, **application** has no
imports from Express or Drizzle, and **infrastructure** is the only place
that talks to SQL. Tests in `__tests__/` build their own composition root
against in-memory SQLite (`makeTestEnv` in `_setup.ts`) so they never go
through Express.

### Tech stack

| Layer | Library | Why |
| --- | --- | --- |
| HTTP server | `express@5` | Mature, simple middleware story. Body cap at 64 KB, CORS allowlisted. |
| Persistence | `better-sqlite3` + `drizzle-orm` | Single-file demo DB with a **synchronous** API — atomic transfer/ledger transactions are plain function calls without async transaction plumbing. |
| WebAuthn | `@simplewebauthn/server` | RP-side passkey registration + assertion. |
| Passwords | `bcrypt` (cost 12) | Demo-grade hashing with strict strength rules in `application/passwords.ts`. |
| TS runtime | `ts-node` for dev, `tsc → dist` for prod | No ESM gymnastics. |
| Tests | `node:test` | Zero-dep, fast. |

## Project layout

```
bankserver/
├── package.json
├── tsconfig.json
├── ROADMAP.md
├── bankserver.sqlite               ← created by npm run db:migrate
└── src/
    ├── main.ts                     listen(0.0.0.0:4000)
    ├── app.ts                      Express setup + central error handler
    ├── container.ts                composition root + event subscribers
    ├── api-docs/
    │   ├── swagger.yaml            full OpenAPI 3.1 spec (encrypted-envelope aware)
    │   └── docs.html               static interactive docs
    ├── crypto/
    │   ├── aes.ts                  AES-256-GCM with sessionId AAD
    │   ├── ecdh.ts                 P-256 keygen + HKDF derive
    │   ├── handshakeStore.ts       one-shot ECDH private key store
    │   └── sessionStore.ts         AES key + nonce cache + bindUser
    ├── db/
    │   ├── client.ts               Drizzle + better-sqlite3 singleton
    │   ├── schema.ts               every table in the system (single file)
    │   ├── migrate.ts              raw DDL runner (no drizzle-kit at runtime)
    │   ├── seed.ts                 admin + billers
    │   └── seedTestCustomers.ts    100 demo customers
    ├── middleware/
    │   ├── decrypt.ts              validates + decrypts incoming envelope
    │   ├── encrypt.ts              patches res.json to encrypt outgoing
    │   ├── auth.ts                 requireSession / requireRole
    │   ├── step-up.ts              WebAuthn one-shot action token check
    │   ├── rate-limit.ts           per-IP sliding-window limiter
    │   ├── request-id.ts           AsyncLocalStorage requestId
    │   └── security-headers.ts     CSP / Trusted Types / HSTS
    ├── routes/
    │   ├── index.ts                router wiring (top-level URL prefixes)
    │   ├── security.ts             /security/session, /security/handshake
    │   ├── webauthn.ts             registration + authentication options/verify
    │   ├── api-docs.ts             /api-docs/swagger.yaml + viewers
    │   └── dev.ts                  /dev/login-as (dev-only)
    ├── services/
    │   ├── actionTokens.ts         HMAC + jti + paramsHash + 60s expiry
    │   └── velocity.ts             per-(session,action) cap (5/min, 50/day)
    ├── shared/
    │   ├── clock.ts                Clock port + systemClock
    │   ├── ids.ts                  IdGenerator port (uuid + accountNumber + txn ref)
    │   ├── money.ts                Currency + minor-unit helpers (paise math)
    │   └── eventBus.ts             synchronous in-process publish/subscribe
    ├── utils/
    │   ├── errors.ts               HttpError + typed subclasses
    │   ├── logger.ts               request-id-aware logger
    │   ├── redact.ts               masks sensitive fields in logs
    │   └── validate.ts             isUuid, isNonEmptyString
    ├── contexts/
    │   ├── identity/
    │   │   ├── domain/             User, Credential, errors
    │   │   ├── application/        registerUser, login, loginStateMachine, changePassword
    │   │   ├── infrastructure/     userRepo, credentialRepo
    │   │   └── interface/          /identity/* routers (incl. credentials self-service)
    │   ├── kyc/                    Submit / Approve / Reject + admin queue
    │   ├── accounts/               open / freeze / unfreeze / close + lookup
    │   ├── payments/               executeTransfer (atomic ledger + transfer)
    │   │                           faucetDeposit (admin)
    │   ├── beneficiaries/          per-user saved counterparties
    │   ├── bills/                  biller catalog + payBill (uses transfer engine)
    │   ├── standingInstructions/   recurring transfers + due-tick runner
    │   ├── statements/             month-bounded ledger view
    │   ├── notifications/          per-user notification feed
    │   └── cards/                  debit-card issue / freeze / cancel
    └── __tests__/                  19 test files, ~80 subtests
```

## Request lifecycle

A typical authenticated request (e.g. `GET /accounts/me`) traverses:

```
client  ──►  [request-id]  ──►  [security-headers]  ──►  [express.json]
        ──►  [CORS + finish-logger]
        ──►  router.use("/accounts", encryptedResponse, decryptMiddleware,
                                     requireSession, accountsCustomerRouter)
                       │             │                  │
                       │             │                  └─ reads req.user from sessionStore
                       │             └─────────── decrypts envelope → req.body / sets req.sessionId
                       └────────────────────────────── patches res.json so the route's res.json
                                                       output is encrypted on the way out
        ──►  route handler (uses container.repos.* + an application use-case)
        ──►  res.json({ accounts: [...] })
        ──►  [encrypt] wraps as { data, nonce, ts } → AES-GCM → { payload: "..." }
        ──►  client (decrypts in the worker, returns plaintext to caller)
```

Both `decryptMiddleware` and `encryptedResponse` are **idempotent** — if a
request matches both a broader and a narrower mount (e.g. `/identity` and
`/identity/credentials`), the second invocation is a no-op. Without that
guard you'd see double-encrypted responses; the bug-fix lives in
`middleware/decrypt.ts` and `middleware/encrypt.ts` behind a `__requestDecrypted`
/ `__responseEncryptionPatched` flag.

For sensitive operations (transfers, password change, passkey revoke,
session wipe-others), routes additionally apply `requireStepUp(action)` —
the client must present a one-shot HMAC-signed `x-action-token` minted by
`POST /webauthn/authentication/verify` and bound to a hash of the params.

## Bounded contexts

| Context | URL prefix | What it owns | Key invariants |
| --- | --- | --- | --- |
| **identity** | `/identity/*` | `users`, `webauthn_credentials` | Username unique; passkey required after first password login; failed-attempt lockout via `loginStateMachine`. |
| **kyc** | `/kyc`, `/admin/kyc` | `kyc_applications` | Status state machine (`Submitted` → `Approved`/`Rejected`); only one active app per user; PAN regex enforced. |
| **accounts** | `/accounts`, `/admin/accounts` | `accounts` | Status (`Active`/`Frozen`/`Closed`); cannot debit non-`Active`; `close` requires zero balance; currency match per op. |
| **payments** | `/transfer`, `/admin/transactions`, `/admin/faucet` | `transfers`, `ledger_entries` | Atomic per-transfer (1 transfers row + 2 ledger rows + 2 account updates inside one SQL transaction); idempotency keys; per-tx cap ₹10 lakh; **no cross-user transfers into a Fixed Deposit** (savings/current → FD only allowed within the same user). |
| **beneficiaries** | `/beneficiaries` | `beneficiaries` | Owner-scoped lookups; `(ownerUserId, accountNumber)` unique; `lastUsedAt` updated on transfer. |
| **bills** | `/bills` | `billers` | Read-only catalog seeded by `db:seed`. Pay-bill uses the transfer engine to credit a biller's internal account. |
| **standingInstructions** | `/standing-instructions` | `standing_instructions` | `nextRunAt` advances on each successful run; failures kept in the run-result list, SI status is preserved (no auto-pause in the demo). |
| **statements** | `/statements` | (read model over `ledger_entries`) | Calendar-month boundaries; opening = balance at start of month, closing = end of month, lines = ledger debit/credit pairs. |
| **notifications** | `/notifications`, `/admin/notifications` | `notifications` | Per-user feed; `readAt` sets read state; emit-only (consumers are event subscribers in `container.ts`). |
| **cards** | `/cards`, `/admin/cards` | `debit_cards` | Status (`active`/`frozen`/`cancelled`); only active accounts can be issued cards. |

Each context lives at `src/contexts/<name>/{domain,application,infrastructure,interface}`.
Use cases (e.g. `executeTransfer`) take `{ db, clock, ids, bus }` as
explicit dependencies — the production wiring is in
[`src/container.ts`](src/container.ts), tests build a fresh wiring with
[`src/__tests__/_setup.ts`](src/__tests__/_setup.ts).

## Cross-context events

The `eventBus` (`src/shared/eventBus.ts`) is a synchronous in-process
publisher/subscriber. Use cases publish at the end of their SQL
transactions; subscribers run **synchronously** in registration order.

Subscriptions are wired in [`src/container.ts`](src/container.ts):

| Event | Publisher | Subscribers |
| --- | --- | --- |
| `KycApproved` | `decideKyc.approve` | Accounts opens the requested account type · Notifications emits `kyc.approved` |
| `KycRejected` | `decideKyc.reject` | Notifications emits `kyc.rejected` |
| `MoneyMoved` | `executeTransfer` (and `faucetDeposit`) | Notifications emits `transfer.sent` / `transfer.received` |
| `PasswordChanged` | `changePassword` | Notifications emits `password.changed` |
| `PasskeyRevoked` | `revokeCredential` | Notifications emits `passkey.revoked` |
| `DebitCardIssued` / `DebitCardFrozen` | `issueCard` / `freezeCard` | Notifications emits `card.issued` / `card.frozen` |
| `StandingInstructionRan` | `runDueInstructions` | Notifications emits `standing.executed` |

Everything happens in the same Node process and the same SQLite write path,
so there's no message broker. If you ever need durability across restarts
the entry point is to swap `InProcessEventBus` for an outbox + poller — the
publisher API doesn't change.

## Database

- File: `./bankserver.sqlite` (relative to `bankserver/`), or `:memory:`
  via `DATABASE_URL=:memory:` for ephemeral.
- WAL mode + `foreign_keys = ON` are turned on in
  [`src/db/client.ts`](src/db/client.ts).
- The full schema lives in **one file**:
  [`src/db/schema.ts`](src/db/schema.ts). Each context's
  `infrastructure/<name>Repo.ts` imports from there — keeps `drizzle-kit`
  fast and migrations deterministic.
- Migrations are run via raw DDL by
  [`src/db/migrate.ts`](src/db/migrate.ts) (no drizzle-kit at runtime).
  Use `npm run db:generate` only when you change `schema.ts` and want to
  regenerate the SQL artifact.

### Tables (overview)

| Table | Owner context |
| --- | --- |
| `users`, `webauthn_credentials` | identity |
| `kyc_applications` | kyc |
| `accounts` | accounts |
| `transfers`, `ledger_entries` | payments |
| `beneficiaries` | beneficiaries |
| `billers` | bills |
| `standing_instructions` | standingInstructions |
| `notifications` | notifications |
| `debit_cards` | cards |

### Seeding

| Script | What it inserts |
| --- | --- |
| `npm run db:seed` | Admin user (`Admin` / `Admin@123`, role `admin`, no passkey enrolled) + 6 billers (electricity / gas / water / internet / mobile / one fallback). Idempotent. |
| `npm run db:seed:test-customers` | 100 demo customers `test_1` .. `test_100`, password `Test<N>@Pass123`. **Outcome distribution:** 80 approved + funded with `N × ₹1,000`, 10 rejected with rotating reasons, 10 left as `Submitted` (visible in the admin KYC queue). Account types cycle through savings/current/fixed_deposit. Idempotent (re-runs rotate passwords + use a stable faucet idempotency key). |
| `npm run db:reset` | `rm bankserver.sqlite && db:migrate && db:seed` (does not run the test-customer seeder). |

### Money representation

- All amounts are integer **paise** (₹1 = 100 paise). Stored as
  `integer("amount_minor")`. Safe up to ~₹9 × 10¹¹.
- INR only. The `Currency` type is single-valued; the architecture is
  multi-currency-ready but the demo isn't.
- Display formatting is centralized in `shared/money.ts` (`inrFmtMinor`).

## API documentation

The full OpenAPI 3.1 spec is generated by hand at
[`src/api-docs/swagger.yaml`](src/api-docs/swagger.yaml) and is served
publicly (no session, no encryption) from the running server:

| URL | What it serves |
| --- | --- |
| `GET /api-docs/swagger.yaml` | Raw spec |
| `GET /api-docs/swagger-ui` | Swagger UI (interactive, server-rendered HTML wrapper, schemas hidden by default) |
| `GET /api-docs/redoc` | Redoc renderer |
| `GET /api-docs/docs.html` | Pre-built static doc |
| `GET /api-docs/` | Landing page linking to the above |

The spec captures both the wire envelope **and** the decrypted body via
`x-decrypted-request` / `x-decrypted-response` extensions, plus per-flow
ordering metadata (`x-call-order`, `x-depends-on`).

When accessed via the bankwebui's Vite proxy at
`http://localhost:5174/api/api-docs/swagger-ui`, the rendered HTML's
`<base href>` is computed from the `X-Forwarded-Prefix: /api` header so
relative `swagger.yaml` references resolve correctly.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | HTTP listen port |
| `HOST` | `0.0.0.0` | Bind address (set explicitly because IPv6-only binds break WSL2's localhost forwarding) |
| `FRONTEND_ORIGIN` | `http://localhost:5174` | `Access-Control-Allow-Origin` value |
| `NODE_ENV` | (unset) | When `production` enables strict CSP, Trusted Types, HSTS; also disables `/dev/*` |
| `WEBAUTHN_RP_ID` | `localhost` | Relying party id (must be the eTLD+1) |
| `WEBAUTHN_ORIGIN` | `http://localhost:5174` | Origin the browser registers from |
| `WEBAUTHN_RP_NAME` | `BankServer Demo` | Display name shown by the authenticator |
| `ACTION_TOKEN_HMAC_KEY` | random per process | 32+ byte HMAC key for action tokens; set this in prod so multiple nodes share the same key |
| `DATABASE_URL` | `./bankserver.sqlite` | SQLite file (or `:memory:` for ephemeral) |

## npm scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | `ts-node src/main.ts` (no transpile, no watch — restart on edit) |
| `npm run build` | `tsc` → `dist/`; also copies `src/api-docs/` so Swagger docs ship |
| `npm start` | `node dist/main.js` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | `node --test` over `src/__tests__/*.test.ts` (~80 subtests, ~6 s) |
| `npm run db:generate` | `drizzle-kit generate` (only when `schema.ts` changes) |
| `npm run db:migrate` | Runs the embedded raw DDL — creates the SQLite file fresh if missing |
| `npm run db:seed` | Idempotent: admin user + billers |
| `npm run db:seed:test-customers` | 100 demo customers (idempotent — re-runs rotate passwords) |
| `npm run db:reset` | `rm bankserver.sqlite && db:migrate && db:seed` |
| `npm run format` | Prettier write |
| `npm run format:check` | Prettier check (CI) |

## Testing

```bash
npm test
```

Output: ~80 subtests across 19 files. Highlights:

- `aes.test.ts` (AES-256-GCM encrypt/decrypt with session-id AAD).
- `account.domain.test.ts` — open/credit/debit/freeze/close invariants.
- `kyc.domain.test.ts` + `kyc.integration.test.ts` — submit / approve /
  reject + the `KycApproved` → Accounts subscriber.
- `transfer.application.test.ts` — happy path, insufficient funds rollback,
  idempotency, self-transfer rejection, frozen source, over-limit, unknown
  account, MoneyMoved emit-only-on-commit, and the cross-user FD-funding
  guard (savings/current → FD across users → reject; same user → allowed).
- `transfer.snapshot.test.ts` — full snapshot of a posted transfer +
  serialized response shape.
- `phase4.beneficiaries|bills|cards|notifications|standingInstructions.test.ts`
  — per-context use-case suites.
- `identity.application.test.ts`, `.password.test.ts`, `.loginstate.test.ts`,
  `.routes.integration.test.ts` — the full identity + WebAuthn dance.
- `statements.test.ts` — month boundary + December rollover.
- `money.test.ts` — paise arithmetic.

Tests build their own composition root via `_setup.ts → makeTestEnv()`
against `:memory:` SQLite, with deterministic id and clock helpers
(`clock.advance(ms)`, `ids.uuid()` returns sequential UUIDs).

## Common dev tasks

### Make a user an admin

There is intentionally no UI to grant admin (the demo's failure mode is
that anyone could otherwise click their way to admin). The seeded
`Admin` user is what you use day-to-day; if you want to promote someone
else:

```bash
sqlite3 bankserver/bankserver.sqlite \
  "UPDATE users SET role='admin' WHERE username='alice';"
```

…then re-login.

### Faucet money to an account

Log in as admin → `/admin/accounts` → Faucet on the row, OR use the dev
script in `routes/dev.ts`. Faucet posts a real `transfer` row + ledger
credit so the customer sees it as `Sentinel Bank (faucet)`.

### Run a standing-instruction tick by hand

Standing instructions don't have a built-in scheduler in the demo. The
admin Transactions page exposes a manual "Run due" button that calls
`POST /admin/standing-instructions/run` and returns a per-SI result list.

### Reset the world

```bash
npm run db:reset && npm run db:seed:test-customers
```

You'll have an Admin user, the biller catalog, and 100 demo customers in
mixed KYC states. Restart `npm run dev` afterwards.

## Logging

- A request id is minted (or honored from inbound `x-request-id`, capped
  at 128 chars) by `middleware/request-id.ts` and stored in
  `AsyncLocalStorage`.
- The logger prefixes every line with `[<requestId>] -> [...]`.
- Every authenticated request logs **decrypted** request bodies/queries
  /params on entry and decrypted response bodies on exit, with sensitive
  fields masked by [`utils/redact.ts`](src/utils/redact.ts) (passwords,
  PAN, full PII blobs, large base64 documents). Tags responses that have
  `success: false` with `[error]` for grep convenience.
- The central error handler appends the request id to every error
  envelope and the `x-request-id` response header.

So a typical 4xx leaves a single grep-able trace:

```
[r-id] -> [INFO] req POST /transfer { body: { fromAccountId: '…', amountMinor: 25_00, … } }
[r-id] -> [INFO] res POST /transfer -> 409 [error] { body: { success: false, error: { message: 'Transfers into a Fixed Deposit are only allowed between your own accounts', requestId: 'r-id' } } }
[r-id] -> [INFO] POST /transfer -> 409 (4.118ms)
```

## Troubleshooting

### `NODE_MODULE_VERSION 115 vs 137` (or vice versa) on startup

`better-sqlite3` is a native addon — its compiled binary must match the
ABI of the Node version that loads it. Cursor's bundled Node is 20.x
(ABI 115); a typical nvm install of LTS is 24.x (ABI 137).

**Fix:** rebuild against the Node you're using:

```bash
cd bankserver
npm rebuild better-sqlite3
```

If you switch back to the other Node version later, rebuild again. If you
want to run `npm run dev` from one Node and "Debug BankServer" in
`launch.json` from another, pin `runtimeExecutable` in `launch.json` to
the same Node binary your terminal uses.

### "Stale request" / "Replay detected" 400s during dev

The encrypted envelope carries a `timestamp` (±60 s window) and a `nonce`
(per-session cache). Symptoms:

- **Stale**: clock skew between your dev box and… itself? Usually means
  the WSL clock drifted. `sudo hwclock -s` fixes it. Otherwise check
  whether you've held a paused breakpoint for more than a minute.
- **Replay**: usually a Vite Fast-Refresh re-run that re-uses an old
  envelope. A hard browser refresh resets the client crypto worker.

### Page returns 200 but the data array looks empty

Check that the request isn't being matched by **two** mounts at once
(see [Request lifecycle](#request-lifecycle)). Both `decryptMiddleware`
and `encryptedResponse` are now idempotent on the same chain, but if you
add a new mount layer make sure it doesn't get re-applied — the
`__requestDecrypted` / `__responseEncryptionPatched` flags will short-
circuit a second invocation rather than double-decrypting/encrypting.

### Browser CORS errors

If Vite picked port 5175 (because 5174 was busy), the bankserver's CORS
allowlist won't include it. Either free 5174 or override:

```bash
FRONTEND_ORIGIN=http://localhost:5175 npm run dev
```

Otherwise just use the bankwebui's same-origin proxy at
`http://localhost:5174/api/...` — the proxy strips `/api` and adds
`X-Forwarded-Prefix: /api` so CORS preflights stay off the hot path.

### "Server is running…" then immediate exit under the debugger

Don't use `runtimeExecutable: "npm"` in `launch.json` — npm + `sh -c` +
auto-attach + ts-node interact badly. Use `node -r ts-node/register`
directly, like the included config:

```jsonc
{
  "name": "Debug BankServer",
  "type": "node",
  "request": "launch",
  "runtimeExecutable": "${env:HOME}/.nvm/versions/node/v24.15.0/bin/node",
  "runtimeArgs": ["-r", "ts-node/register"],
  "program": "${workspaceFolder}/src/main.ts",
  "cwd": "${workspaceFolder}",
  "console": "integratedTerminal",
  "env": { "TS_NODE_TRANSPILE_ONLY": "true" }
}
```

### IPv6-only bind on WSL2

Node's `app.listen(port)` historically binds to `[::]:port` only on Linux,
which WSL2's Windows-side localhost forward doesn't reliably reach.
`src/main.ts` binds explicitly to `0.0.0.0`. Confirm with
`ss -4 -ltn | grep :4000` — must show `0.0.0.0:4000`.

## License

ISC
