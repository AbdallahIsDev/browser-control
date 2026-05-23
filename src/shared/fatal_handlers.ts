import { Logger } from "./logger";

type FatalKind = "unhandledRejection" | "uncaughtException";

interface FatalHandlerOptions {
	component: string;
	logger?: Pick<Logger, "critical">;
	shutdown?: () => void | Promise<void>;
	processRef?: NodeJS.Process;
}

const installedComponents = new Set<string>();

function errorDetails(error: unknown): Record<string, unknown> {
	if (error instanceof Error) {
		return {
			error: error.message,
			...(error.stack ? { stack: error.stack } : {}),
		};
	}
	return { error: String(error) };
}

export function installGlobalFatalHandlers(options: FatalHandlerOptions): void {
	const processRef = options.processRef ?? process;
	const installKey = `${options.component}:${processRef.pid}`;
	if (installedComponents.has(installKey)) return;
	installedComponents.add(installKey);

	const log = options.logger ?? new Logger({ component: options.component });
	let shutdownStarted = false;

	const handleFatal = (kind: FatalKind, error: unknown): void => {
		log.critical(`Unhandled fatal process event: ${kind}`, errorDetails(error));
		processRef.exitCode = 1;
		if (!options.shutdown || shutdownStarted) return;
		shutdownStarted = true;
		Promise.resolve(options.shutdown()).catch((shutdownError: unknown) => {
			log.critical("Fatal handler shutdown failed", errorDetails(shutdownError));
		});
	};

	processRef.on("unhandledRejection", (reason) => {
		handleFatal("unhandledRejection", reason);
	});
	processRef.on("uncaughtException", (error) => {
		handleFatal("uncaughtException", error);
	});
}
