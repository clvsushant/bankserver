import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    HttpError,
    NotFoundError,
} from "../utils/errors";
import {
    AccountCloseBlockedError,
    AccountCloseRequiresZeroBalanceError,
    AccountInvalidStatusTransitionError,
    AccountNotActiveError,
    AccountNotFoundError,
    CurrencyMismatchError,
    FixedDepositWithdrawalBlockedError,
    HoldExceedsBalanceError,
    InsufficientAvailableFundsError,
    InsufficientFundsError,
    MinimumBalanceViolationError,
    FdMinimumPrincipalError,
    FdInvalidTenureError,
    FdUnsupportedTenureError,
    NomineeNameRequiredError,
    NomineeRelationRequiredError,
    NomineeShareInvalidError,
} from "../contexts/accounts/domain/errors";
import {
    BeneficiaryAlreadyExistsError,
    BeneficiaryCoolingPeriodError,
    BeneficiaryNotFoundError,
    BeneficiarySelfTargetError,
    BeneficiaryUnknownAccountError,
} from "../contexts/beneficiaries/domain/errors";
import { BillerInactiveError, BillerNotFoundError } from "../contexts/bills/domain/errors";
import {
    CardInvalidStateError,
    CardLimitAboveBankMaxError,
    CardLimitExceededError,
    CardMerchantNotConfiguredError,
    CardNotFoundError,
    CardPerTxnLimitError,
} from "../contexts/cards/domain/errors";
import {
    KycAlreadyExistsError,
    KycBankingAccessDeniedError,
    KycInvalidPanError,
    KycInvalidTransitionError,
    KycNotFoundError,
} from "../contexts/kyc/domain/errors";
import {
    CrossUserFixedDepositTransferError,
    TransferAggregateLimitError,
    TransferAmountInvalidError,
    TransferOverLimitError,
    TransferToSelfError,
    InvalidUpiVpaError,
} from "../contexts/payments/domain/errors";
import {
    DisputeAlreadyDecidedError,
    DisputeNotAuthorizedError,
    DisputeNotFoundError,
    DisputeReversalBlockedError,
    DisputeTransferNotFoundError,
} from "../contexts/payments/domain/disputeErrors";
import {
    StandingInstructionInvalidStateError,
    StandingInstructionNotFoundError,
} from "../contexts/standingInstructions/domain/errors";

type DomainErrorMapper = (err: unknown) => HttpError | null;

export function translateAccountDomainError(err: unknown): HttpError | null {
    if (err instanceof AccountNotFoundError) return new NotFoundError(err.message);
    if (err instanceof AccountInvalidStatusTransitionError)
        return new BadRequestError(err.message);
    if (err instanceof AccountCloseRequiresZeroBalanceError)
        return new ConflictError(err.message);
    if (err instanceof AccountCloseBlockedError) return new ConflictError(err.message);
    if (err instanceof AccountNotActiveError) return new ConflictError(err.message);
    if (err instanceof CurrencyMismatchError) return new BadRequestError(err.message);
    if (err instanceof InsufficientFundsError) return new ConflictError(err.message);
    if (err instanceof InsufficientAvailableFundsError) return new ConflictError(err.message);
    if (err instanceof MinimumBalanceViolationError) return new ConflictError(err.message);
    if (err instanceof FixedDepositWithdrawalBlockedError) return new ConflictError(err.message);
    if (err instanceof HoldExceedsBalanceError) return new ConflictError(err.message);
    if (err instanceof FdMinimumPrincipalError) return new BadRequestError(err.message);
    if (err instanceof FdInvalidTenureError) return new BadRequestError(err.message);
    if (err instanceof FdUnsupportedTenureError) return new BadRequestError(err.message);
    if (err instanceof NomineeNameRequiredError) return new BadRequestError(err.message);
    if (err instanceof NomineeRelationRequiredError) return new BadRequestError(err.message);
    if (err instanceof NomineeShareInvalidError) return new BadRequestError(err.message);
    return null;
}

export function translateTransferDomainError(err: unknown): HttpError | null {
    if (err instanceof TransferAmountInvalidError) return new BadRequestError(err.message);
    if (err instanceof TransferOverLimitError) return new BadRequestError(err.message);
    if (err instanceof TransferAggregateLimitError) return new ConflictError(err.message);
    if (err instanceof TransferToSelfError) return new BadRequestError(err.message);
    if (err instanceof CrossUserFixedDepositTransferError)
        return new ConflictError(err.message);
    if (err instanceof InvalidUpiVpaError) return new BadRequestError(err.message);
    return null;
}

export function translateBeneficiaryDomainError(err: unknown): HttpError | null {
    if (err instanceof BeneficiaryAlreadyExistsError) return new ConflictError(err.message);
    if (err instanceof BeneficiaryNotFoundError) return new NotFoundError(err.message);
    if (err instanceof BeneficiarySelfTargetError) return new BadRequestError(err.message);
    if (err instanceof BeneficiaryUnknownAccountError) return new NotFoundError(err.message);
    if (err instanceof BeneficiaryCoolingPeriodError) return new ConflictError(err.message);
    if (err instanceof Error && err.message === "External beneficiary already saved")
        return new ConflictError(err.message);
    return null;
}

export function translateKycDomainError(err: unknown): HttpError | null {
    if (err instanceof KycAlreadyExistsError) return new ConflictError(err.message);
    if (err instanceof KycInvalidPanError) return new BadRequestError(err.message);
    if (err instanceof KycInvalidTransitionError) return new ConflictError(err.message);
    if (err instanceof KycNotFoundError) return new NotFoundError(err.message);
    if (err instanceof KycBankingAccessDeniedError) return new ForbiddenError(err.message);
    return null;
}

export function translateCardDomainError(err: unknown): HttpError | null {
    if (err instanceof CardNotFoundError) return new NotFoundError(err.message);
    if (err instanceof CardInvalidStateError) return new ConflictError(err.message);
    if (err instanceof CardLimitExceededError) return new ConflictError(err.message);
    if (err instanceof CardPerTxnLimitError) return new ConflictError(err.message);
    if (err instanceof CardLimitAboveBankMaxError) return new BadRequestError(err.message);
    if (err instanceof CardMerchantNotConfiguredError) return new ConflictError(err.message);
    return null;
}

export function translateBillDomainError(err: unknown): HttpError | null {
    if (err instanceof BillerNotFoundError) return new NotFoundError(err.message);
    if (err instanceof BillerInactiveError) return new ConflictError(err.message);
    return null;
}

export function translateStandingInstructionDomainError(err: unknown): HttpError | null {
    if (err instanceof StandingInstructionNotFoundError) return new NotFoundError(err.message);
    if (err instanceof StandingInstructionInvalidStateError)
        return new ConflictError(err.message);
    return null;
}

/** Plain Error messages from disputes application (not yet typed domain errors). */
export function translateDisputeDomainError(err: unknown): HttpError | null {
    if (err instanceof DisputeTransferNotFoundError || err instanceof DisputeNotFoundError)
        return new NotFoundError(err.message);
    if (err instanceof DisputeNotAuthorizedError) return new ForbiddenError(err.message);
    if (
        err instanceof DisputeAlreadyDecidedError ||
        err instanceof DisputeReversalBlockedError
    )
        return new ConflictError(err.message);
    return null;
}

/** @deprecated use translateDisputeDomainError */
export function translateDisputePlainError(err: unknown): HttpError | null {
    const mapped = translateDisputeDomainError(err);
    if (mapped) return mapped;
    if (!(err instanceof Error)) return null;
    switch (err.message) {
        case "Transfer not found":
        case "Dispute not found":
            return new NotFoundError(err.message);
        case "Dispute already decided":
        case "Accounts missing for reversal":
        case "Cannot reverse transfer without both accounts":
            return new ConflictError(err.message);
        default:
            return null;
    }
}

/** Map domain errors to HttpError; pass through HttpError; else return original err. */
export function composeDomainErrorTranslation(
    err: unknown,
    ...contextMappers: DomainErrorMapper[]
): unknown {
    if (err instanceof HttpError) return err;
    const mappers: DomainErrorMapper[] = [
        ...contextMappers,
        translateAccountDomainError,
        translateTransferDomainError,
        translateBeneficiaryDomainError,
        translateKycDomainError,
    ];
    for (const map of mappers) {
        const mapped = map(err);
        if (mapped) return mapped;
    }
    return err;
}
