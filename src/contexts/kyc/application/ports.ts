import type { KycApplication } from "../domain/kycApplication";

export interface KycRepo {
    findById(id: string): KycApplication | undefined;
    findActiveByUserId(userId: string): KycApplication | undefined;
    /** Returns Submitted + Approved (a user with Submitted or Approved cannot re-submit). */
    listByUserId(userId: string): KycApplication[];
    listByStatus(status: KycApplication["status"], limit: number): KycApplication[];
    insert(app: KycApplication): void;
    update(app: KycApplication): void;
}
