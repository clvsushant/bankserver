import type { StandingInstruction } from "../domain/standingInstruction";

export interface StandingInstructionRepo {
    findById(id: string): StandingInstruction | undefined;
    listByOwner(ownerUserId: string): StandingInstruction[];
    /** Find all due `active` instructions whose nextRunAt <= now. */
    listDue(now: Date): StandingInstruction[];
    insert(si: StandingInstruction): void;
    update(si: StandingInstruction): void;
    setStatus(id: string, status: StandingInstruction["status"]): void;
}
