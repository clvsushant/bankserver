import { getContext } from "./context-storage";

enum LogLevel {
    DEBUG = "DEBUG",
    INFO = "INFO",
    WARN = "WARN",
    ERROR = "ERROR",
}

interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    data?: any;
}

const formatLog = (level: LogLevel, message: string, data?: any): LogEntry => {
    return {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...(data && { data }),
    };
};

const print = (logEntry: LogEntry): void => {
    const context = getContext();
    const requestId = context?.requestId || "unknown";
    const { timestamp, level, message, data } = logEntry;
    const prefix = `[${timestamp}] [${level}]`;
    const dataStr = data ? ` ${JSON.stringify(data)}` : "";
    console.log(`[${requestId}] -> ${prefix} ${message}${dataStr}`);
};

const logger = {
    debug: (message: string, data?: any): void => {
        const logEntry = formatLog(LogLevel.DEBUG, message, data);
        print(logEntry);
    },

    info: (message: string, data?: any): void => {
        const logEntry = formatLog(LogLevel.INFO, message, data);
        print(logEntry);
    },

    warn: (message: string, data?: any): void => {
        const logEntry = formatLog(LogLevel.WARN, message, data);
        const context = getContext();
        const requestId = context?.requestId || "unknown";
        console.warn(`[${requestId}] -> [${logEntry.timestamp}] [${logEntry.level}] ${message}`);
    },

    error: (message: string, data: any): void => {
        const logEntry = formatLog(LogLevel.ERROR, message, data);
        const dataStr = data ? ` ${JSON.stringify(data)}` : "";
        const context = getContext();
        const requestId = context?.requestId || "unknown";
        console.error(
            `[${requestId}] -> [${logEntry.timestamp}] [${logEntry.level}] ${message}${dataStr}`
        );
    },
};

export default logger;
