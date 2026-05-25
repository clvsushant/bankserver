import { AsyncLocalStorage } from "async_hooks";

export interface RequestContext {
    requestId: string;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

export const getContext = () => asyncLocalStorage.getStore();

export const runWithContext = <T>(context: RequestContext, fn: () => T): T => {
    return asyncLocalStorage.run(context, fn);
};
