import express from "express";
import securityRoutes from "./security";
import webauthnRoutes from "./webauthn";
import devRoutes from "./dev";
import apiDocsRoutes from "./api-docs";
import identityRoutes from "../contexts/identity/interface/routes";
import { credentialsRouter as identityCredentialsRouter } from "../contexts/identity/interface/credentials";
import usersAdminRouter from "../contexts/identity/interface/admin";
import { kycCustomerRouter, kycAdminRouter } from "../contexts/kyc/interface/routes";
import {
    accountsCustomerRouter,
    accountsAdminRouter,
} from "../contexts/accounts/interface/routes";
import {
    transferCustomerRouter,
    transactionsAdminRouter,
    faucetAdminRouter,
} from "../contexts/payments/interface/routes";
import { statementsRouter } from "../contexts/statements/interface/routes";
import { beneficiariesRouter } from "../contexts/beneficiaries/interface/routes";
import { billsRouter } from "../contexts/bills/interface/routes";
import { standingInstructionsRouter } from "../contexts/standingInstructions/interface/routes";
import { notificationsRouter } from "../contexts/notifications/interface/routes";
import { cardsRouter } from "../contexts/cards/interface/routes";
import auditAdminRouter from "../contexts/audit/interface/admin";
import { decryptMiddleware } from "../middleware/decrypt";
import { encryptedResponse } from "../middleware/encrypt";
import { requireSession, requireRole } from "../middleware/auth";
import { requireBankingAccess } from "../middleware/banking-access";

const router = express.Router();

// API documentation (public, unencrypted, unauthenticated).
router.use("/api-docs", apiDocsRoutes);

// Bootstrap endpoints (handshake itself cannot be encrypted).
router.use("/security", securityRoutes);

// Dev-only routes (test-bypass login). Locked off in NODE_ENV=production.
router.use("/dev", devRoutes);

// Identity + WebAuthn: encrypted body + encrypted response. NOT gated by
// `requireSession` — signup, password step, and passkey enrollment all
// happen BEFORE a user is bound to the session. Routes that DO need a
// bound user (e.g. /identity/me, /identity/logout) attach `requireSession`
// themselves inside the identity router.
router.use("/identity", encryptedResponse, decryptMiddleware, identityRoutes);
router.use(
    "/identity/credentials",
    encryptedResponse,
    decryptMiddleware,
    requireSession,
    identityCredentialsRouter
);
router.use("/webauthn", encryptedResponse, decryptMiddleware, webauthnRoutes);

// Encrypted, authenticated routes.
router.use("/kyc", encryptedResponse, decryptMiddleware, requireSession, kycCustomerRouter);
router.use(
    "/accounts",
    encryptedResponse,
    decryptMiddleware,
    requireSession,
    accountsCustomerRouter
);

router.use(
    "/statements",
    encryptedResponse,
    decryptMiddleware,
    requireSession,
    requireBankingAccess,
    statementsRouter
);

router.use(
    "/beneficiaries",
    encryptedResponse,
    decryptMiddleware,
    requireSession,
    requireBankingAccess,
    beneficiariesRouter
);

router.use(
    "/bills",
    encryptedResponse,
    decryptMiddleware,
    requireSession,
    requireBankingAccess,
    billsRouter
);

router.use(
    "/standing-instructions",
    encryptedResponse,
    decryptMiddleware,
    requireSession,
    requireBankingAccess,
    standingInstructionsRouter
);

router.use(
    "/notifications",
    encryptedResponse,
    decryptMiddleware,
    requireSession,
    notificationsRouter
);

router.use(
    "/cards",
    encryptedResponse,
    decryptMiddleware,
    requireSession,
    requireBankingAccess,
    cardsRouter
);

// /transfer mount: encrypted + authenticated + banking access. Step-up
// (action token) is applied only to POST handlers inside the router.
router.use(
    "/transfer",
    encryptedResponse,
    decryptMiddleware,
    requireSession,
    requireBankingAccess,
    transferCustomerRouter
);

// Admin namespace. Each context contributes a sub-router.
const adminRouter = express.Router();
adminRouter.use("/kyc", kycAdminRouter);
adminRouter.use("/accounts", accountsAdminRouter);
adminRouter.use("/transactions", transactionsAdminRouter);
adminRouter.use("/faucet", faucetAdminRouter);
adminRouter.use("/users", usersAdminRouter);
adminRouter.use("/audit", auditAdminRouter);
router.use(
    "/admin",
    encryptedResponse,
    decryptMiddleware,
    requireSession,
    requireRole("admin"),
    adminRouter
);

export default router;
