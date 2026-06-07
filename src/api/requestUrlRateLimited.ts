import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import { requestUrl as rawRequestUrl } from 'obsidian';

/** Retries after the first attempt (10 HTTP attempts total; exponential backoffs 1s … 25Cap). */
const RATE_LIMIT_MAX_RETRIES = 8;
const BACKOFF_BASE_MS = 1000;
const RETRY_AFTER_CAP_MS = 15_000;

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function defaultIsRateLimitedStatus(status: number): boolean {
	return status === 429 || status === 503;
}

function parseRetryAfterMs(headers: Record<string, string>): number | undefined {
	for (const key of Object.keys(headers)) {
		if (key.toLowerCase() !== 'retry-after') {
			continue;
		}
		const raw = String(headers[key]).trim();
		const sec = parseInt(raw, 10);
		// sec === 0 means "retry immediately" in HTTP; for throttling that yields useless 0ms sleeps — use backoff instead.
		if (Number.isFinite(sec) && sec > 0) {
			return Math.min(sec * 1000, RETRY_AFTER_CAP_MS);
		}
		return undefined;
	}
	return undefined;
}

export interface RequestUrlRateLimitedOptions {
	/** Shown in `console.warn` (e.g. `MusicBrainz`, `Spotify`). */
	logLabel: string;
	isRateLimited?: (status: number) => boolean;
}

// Host-based request queue state
const lastRequestTimeByHost: Record<string, number> = {};
const hostQueues: Record<string, Promise<any>> = {};

function getHost(url: string): string {
	try {
		const parsed = new URL(url);
		return parsed.hostname;
	} catch {
		return 'unknown';
	}
}

function getRequiredDelayMs(host: string): number {
	if (host.includes('musicbrainz.org')) {
		return 1100; // MusicBrainz requires max 1 request per second
	}
	if (host.includes('spotify.com') || host.includes('genius.com')) {
		return 600;
	}
	if (host.includes('themoviedb.org')) {
		return 250;
	}
	return 100; // default safe minimal delay
}

/**
 * Queues and delays outgoing requests to ensure they satisfy host-specific rate-limiting rules.
 */
export async function rateLimitedRequestUrl(param: RequestUrlParam): Promise<RequestUrlResponse> {
	const host = getHost(param.url);
	const delay = getRequiredDelayMs(host);

	if (!hostQueues[host]) {
		hostQueues[host] = Promise.resolve();
	}

	const requestPromise = hostQueues[host].then(async () => {
		const now = Date.now();
		const lastTime = lastRequestTimeByHost[host] ?? 0;
		const elapsed = now - lastTime;
		if (elapsed < delay) {
			const waitTime = delay - elapsed;
			await sleep(waitTime);
		}

		try {
			const res = await rawRequestUrl(param);
			lastRequestTimeByHost[host] = Date.now();

			// Auto-retry on 429
			if (res.status === 429) {
				let retryAfterSec = 2;
				for (const key of Object.keys(res.headers)) {
					if (key.toLowerCase() === 'retry-after') {
						const sec = parseInt(res.headers[key], 10);
						if (Number.isFinite(sec) && sec > 0) {
							retryAfterSec = Math.min(sec, 15);
						}
					}
				}
				console.warn(`[MDB Queue] Host ${host} returned 429. Waiting ${retryAfterSec}s before retry...`);
				await sleep(retryAfterSec * 1000);
				lastRequestTimeByHost[host] = Date.now();
				return await rawRequestUrl(param);
			}

			return res;
		} catch (e) {
			lastRequestTimeByHost[host] = Date.now();
			throw e;
		}
	});

	hostQueues[host] = requestPromise.catch(() => {});
	return requestPromise;
}

/**
 * HTTP request with retries on 429 / 503: honors `Retry-After` (capped) or exponential backoff (1s through 256s).
 * This runs through our central host-specific queue first.
 */
export async function requestUrlRateLimited(param: RequestUrlParam, options: RequestUrlRateLimitedOptions): Promise<RequestUrlResponse> {
	const isRL = options.isRateLimited ?? defaultIsRateLimitedStatus;
	let last: RequestUrlResponse | undefined;

	for (let retry = 0; retry <= RATE_LIMIT_MAX_RETRIES; retry++) {
		const res = await rateLimitedRequestUrl({ ...param, throw: false });
		last = res;

		if (!isRL(res.status) || retry === RATE_LIMIT_MAX_RETRIES) {
			return res;
		}

		const fromHeader = parseRetryAfterMs(res.headers);
		const backoffMs = fromHeader ?? BACKOFF_BASE_MS * 2 ** retry;
		console.warn(`${options.logLabel} rate limited (HTTP ${res.status}), retry ${retry + 1}/${RATE_LIMIT_MAX_RETRIES} after ${backoffMs}ms`);
		await sleep(backoffMs);
	}

	return last!;
}
