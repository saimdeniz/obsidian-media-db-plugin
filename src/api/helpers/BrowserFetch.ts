import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import { requestUrl } from 'obsidian';
import type { RequestUrlRateLimitedOptions } from '../requestUrlRateLimited';
import { requestUrlRateLimited } from '../requestUrlRateLimited';

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomInt(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * A wrapper around obsidian's requestUrl that mimics a modern browser.
 * This is crucial for bypassing basic bot-protection mechanisms used by sites like Amazon and Goodreads.
 */
export async function browserFetch(
	param: string | RequestUrlParam,
	rateLimitOptions?: RequestUrlRateLimitedOptions,
	mimicHeaders = true,
	randomDelay = false,
): Promise<RequestUrlResponse> {
	const requestParam: RequestUrlParam = typeof param === 'string' ? { url: param } : { ...param };

	if (randomDelay) {
		// Random delay between 400ms and 1500ms to mimic human browsing behavior
		await sleep(getRandomInt(400, 1500));
	}

	if (mimicHeaders) {
		requestParam.headers = {
			...requestParam.headers,
			'User-Agent': DEFAULT_USER_AGENT,
			Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
			'Accept-Language': 'en-US,en;q=0.9',
			'sec-ch-ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
			'sec-ch-ua-mobile': '?0',
			'sec-ch-ua-platform': '"macOS"',
			'sec-fetch-dest': 'document',
			'sec-fetch-mode': 'navigate',
			'sec-fetch-site': 'none',
			'sec-fetch-user': '?1',
			'upgrade-insecure-requests': '1',
		};
	}

	if (rateLimitOptions) {
		return requestUrlRateLimited({ ...requestParam, throw: false }, rateLimitOptions);
	}

	return requestUrl({ ...requestParam, throw: false });
}
