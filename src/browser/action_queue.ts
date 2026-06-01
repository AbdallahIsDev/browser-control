export interface BrowserActionQueueOptions {
	maxGlobalConcurrency: number;
	maxPerSessionConcurrency: number;
	maxQueueDepth: number;
}

export interface BrowserActionQueueStats {
	running: number;
	queued: number;
	maxGlobalConcurrency: number;
	maxPerSessionConcurrency: number;
	maxQueueDepth: number;
	perSession: Array<{
		sessionId: string;
		running: number;
		queued: number;
	}>;
}

interface QueueEntry<T> {
	sessionId: string;
	actionName: string;
	run: () => Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
}

function positiveInt(value: number, fallback: number): number {
	return Number.isInteger(value) && value > 0 ? value : fallback;
}

export class BrowserActionQueue {
	private readonly maxGlobalConcurrency: number;
	private readonly maxPerSessionConcurrency: number;
	private readonly maxQueueDepth: number;
	private running = 0;
	private readonly runningBySession = new Map<string, number>();
	private readonly queue: Array<QueueEntry<unknown>> = [];

	constructor(options: BrowserActionQueueOptions) {
		this.maxGlobalConcurrency = positiveInt(options.maxGlobalConcurrency, 4);
		this.maxPerSessionConcurrency = positiveInt(
			options.maxPerSessionConcurrency,
			1,
		);
		this.maxQueueDepth = positiveInt(options.maxQueueDepth, 100);
	}

	enqueue<T>(
		sessionId: string,
		actionName: string,
		run: () => Promise<T>,
	): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const entry: QueueEntry<T> = { sessionId, actionName, run, resolve, reject };
			if (this.canStart(sessionId)) {
				this.start(entry);
				return;
			}
			if (this.queue.length >= this.maxQueueDepth) {
				reject(
					new Error(
						`Browser action queue is full (${this.queue.length}/${this.maxQueueDepth}); rejected ${actionName}.`,
					),
				);
				return;
			}
			this.queue.push(entry as QueueEntry<unknown>);
		});
	}

	stats(): BrowserActionQueueStats {
		const sessionIds = new Set<string>();
		for (const sessionId of this.runningBySession.keys()) sessionIds.add(sessionId);
		for (const entry of this.queue) sessionIds.add(entry.sessionId);
		return {
			running: this.running,
			queued: this.queue.length,
			maxGlobalConcurrency: this.maxGlobalConcurrency,
			maxPerSessionConcurrency: this.maxPerSessionConcurrency,
			maxQueueDepth: this.maxQueueDepth,
			perSession: Array.from(sessionIds)
				.sort()
				.map((sessionId) => ({
					sessionId,
					running: this.runningBySession.get(sessionId) ?? 0,
					queued: this.queue.filter((entry) => entry.sessionId === sessionId)
						.length,
				})),
		};
	}

	private canStart(sessionId: string): boolean {
		return (
			this.running < this.maxGlobalConcurrency &&
			(this.runningBySession.get(sessionId) ?? 0) <
				this.maxPerSessionConcurrency
		);
	}

	private start<T>(entry: QueueEntry<T>): void {
		this.running += 1;
		this.runningBySession.set(
			entry.sessionId,
			(this.runningBySession.get(entry.sessionId) ?? 0) + 1,
		);
		void Promise.resolve()
			.then(entry.run)
			.then(entry.resolve, entry.reject)
			.finally(() => {
				this.running -= 1;
				const sessionRunning =
					(this.runningBySession.get(entry.sessionId) ?? 1) - 1;
				if (sessionRunning > 0) {
					this.runningBySession.set(entry.sessionId, sessionRunning);
				} else {
					this.runningBySession.delete(entry.sessionId);
				}
				this.drain();
			});
	}

	private drain(): void {
		while (this.running < this.maxGlobalConcurrency) {
			const index = this.queue.findIndex((entry) =>
				this.canStart(entry.sessionId),
			);
			if (index === -1) return;
			const [entry] = this.queue.splice(index, 1);
			this.start(entry);
		}
	}
}
