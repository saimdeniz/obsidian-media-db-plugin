import { Notice } from 'obsidian';
import type MediaDbPlugin from '../../main';
import { BookModel } from '../../models/BookModel';
import type { MediaTypeModel } from '../../models/MediaTypeModel';
import { MediaType } from '../../utils/MediaType';
import { APIModel } from '../APIModel';
import { browserFetch } from '../helpers/BrowserFetch';

export class GoodreadsAPI extends APIModel {
	plugin: MediaDbPlugin;

	constructor(plugin: MediaDbPlugin) {
		super();
		this.plugin = plugin;
		this.apiName = 'GoodreadsAPI';
		this.apiDescription = 'Goodreads web scraper. Fetches rich book metadata including ratings, genres and series info.';
		this.apiUrl = 'https://www.goodreads.com';
		this.types = [MediaType.Book];
	}

	async searchByTitle(title: string): Promise<MediaTypeModel[]> {
		console.log(`MDB | api "${this.apiName}" queried by title: ${title}`);

		const url = `https://www.goodreads.com/search?q=${encodeURIComponent(title)}`;
		try {
			const response = await browserFetch({ url, method: 'GET' }, undefined);
			const html = response.text;
			this.checkBotDetection(html);

			const results: MediaTypeModel[] = [];
			// Match updated: single-quoted itemprop, with extra attributes like role='heading'
			const regex = /<a class="bookTitle" itemprop="url" href="\/book\/show\/([^"/?#\s]+)[^"]*">\s*<span itemprop=['"]name['"][^>]*>(.*?)<\/span>/gi;
			let match;
			while ((match = regex.exec(html)) !== null) {
				const id = this.sanitizeId(match[1]);
				const pageTitle = match[2].trim();
				results.push(
					new BookModel({
						title: pageTitle,
						englishTitle: pageTitle,
						id: id,
						dataSource: this.apiName,
						url: `https://www.goodreads.com/book/show/${id}`,
						year: 0,
					}),
				);
			}

			// If the regex found no bookTitle links, the page may have been a direct redirect
			// to a book detail page — parse it as a single book result
			if (results.length === 0) {
				const directId = this.extractBookIdFromHtml(html);
				if (directId) {
					console.log(`MDB | GoodreadsAPI search resulted in direct redirect to ID: ${directId}`);
					const book = await this.getById(directId);
					if (book && book.title !== 'Unknown Book') {
						return [book];
					}
				}
			}

			return results;
		} catch (e) {
			console.warn(`MDB | Error querying GoodreadsAPI:`, e);
			return [];
		}
	}

	async getById(id: string): Promise<MediaTypeModel> {
		console.log(`MDB | api "${this.apiName}" queried by ID: ${id}`);

		const url = `https://www.goodreads.com/book/show/${id}`;
		const response = await browserFetch({ url, method: 'GET' }, undefined, true, true);
		const html = response.text;
		this.checkBotDetection(html);

		const book = this.parseNextDataJSON(html, id);
		if (book && book.title !== 'Unknown Book') {
			return book;
		}

		// Fallback to Legacy HTML (meta tags)
		console.log(`MDB | GoodreadsAPI: __NEXT_DATA__ parsing failed for id ${id}, trying legacy fallback.`);
		const legacyBook = this.parseLegacyHTML(html, id);
		if (legacyBook && legacyBook.title !== 'Unknown Book') {
			return legacyBook;
		}

		// Neither method found real data — the ID is likely invalid or the page is a "not found" page
		throw new Error(`GoodreadsAPI: No book found for id "${id}". The ID may be invalid or the page is unavailable.`);
	}

	async searchByISBN(isbn: string): Promise<MediaTypeModel[]> {
		console.log(`MDB | api "${this.apiName}" queried by ISBN: ${isbn}`);
		const cleanIsbn = isbn.replace(/[-\s]/g, '');

		// Helper: check if a book's stored ISBN matches the one we searched for
		const isbnMatches = (book: BookModel): boolean => {
			const bookIsbn = String(book.isbn ?? '').replace(/[-\s]/g, '');
			const bookIsbn13 = String(book.isbn13 ?? '').replace(/[-\s]/g, '');
			return bookIsbn === cleanIsbn || bookIsbn13 === cleanIsbn;
		};

		// ── Strategy 1: Direct ISBN redirect ────────────────────────────────────
		// Goodreads may redirect to the canonical (most popular) edition, which can be a
		// different language/edition. We verify the ISBN afterward.
		let wrongEditionHtml: string | undefined; // keep for Strategy 3 (work ID extraction)
		try {
			const response = await browserFetch({ url: `https://www.goodreads.com/book/isbn/${cleanIsbn}`, method: 'GET' }, undefined, true, true);
			const html = response.text;
			this.checkBotDetection(html);

			const id = this.extractBookIdFromHtml(html, cleanIsbn);
			if (id) {
				const book = this.parseNextDataJSON(html, id);
				if (book && book.title !== 'Unknown Book') {
					if (isbnMatches(book)) {
						console.log(`MDB | GoodreadsAPI Strategy 1 found correct edition: ${id}`);
						return [book];
					}
					// Wrong edition — save HTML for Strategy 3 work-ID extraction
					console.warn(`MDB | GoodreadsAPI Strategy 1 redirected to wrong edition (got isbn13=${book.isbn13}, wanted=${cleanIsbn})`);
					wrongEditionHtml = html;
				}
			}
		} catch (e) {
			console.log(`MDB | GoodreadsAPI Strategy 1 handled: ${e}`);
		}

		// ── Strategy 2: Search page fallback ────────────────────────────────────
		console.log(`MDB | GoodreadsAPI Strategy 2: search page for ISBN ${cleanIsbn}`);
		try {
			const searchResponse = await browserFetch({ url: `https://www.goodreads.com/search?q=${cleanIsbn}`, method: 'GET' }, undefined, true, true);
			const searchHtml = searchResponse.text;
			this.checkBotDetection(searchHtml);

			// Direct-hit path (search redirected to a book page)
			const directResultId = this.extractBookIdFromHtml(searchHtml, cleanIsbn);
			if (directResultId) {
				const book = this.parseNextDataJSON(searchHtml, directResultId);
				if (book && book.title !== 'Unknown Book') {
					if (isbnMatches(book)) {
						console.log(`MDB | GoodreadsAPI Strategy 2 found correct edition via direct hit: ${directResultId}`);
						return [book];
					}
					wrongEditionHtml ??= searchHtml;
					console.warn(`MDB | GoodreadsAPI Strategy 2 direct hit also returned wrong edition (isbn13=${book.isbn13})`);
				}
			}

			// List-based path — take first result, verify ISBN
			const resultRegex = /<a class="bookTitle" itemprop="url" href="\/book\/show\/([^"/?#\s]+)[^"]*">/i;
			const resultMatch = resultRegex.exec(searchHtml);
			if (resultMatch) {
				const id = this.sanitizeId(resultMatch[1]);
				const book = (await this.getById(id)) as BookModel;
				if (book && book.title !== 'Unknown Book') {
					if (isbnMatches(book)) {
						console.log(`MDB | GoodreadsAPI Strategy 2 found correct edition via list: ${id}`);
						return [book];
					}
					console.warn(`MDB | GoodreadsAPI Strategy 2 list result also returned wrong edition (isbn13=${book.isbn13})`);
				}
			}
		} catch (e) {
			console.warn(`MDB | GoodreadsAPI Strategy 2 failed for ${isbn}:`, e);
		}

		// ── Strategy 3: Editions page ────────────────────────────────────────────
		// When Goodreads normalises the ISBN to its canonical work, the target edition
		// still exists as a separate entry on the work's editions page.
		// We extract the work's legacyId from the wrong-edition page and scan its
		// editions page Apollo State for a Details entry matching our ISBN.
		if (wrongEditionHtml) {
			console.log(`MDB | GoodreadsAPI Strategy 3: scanning editions page for ISBN ${cleanIsbn}`);
			const workLegacyId = this.extractWorkLegacyId(wrongEditionHtml);
			if (workLegacyId) {
				const editionBook = await this.findEditionByISBN(workLegacyId, cleanIsbn);
				if (editionBook) {
					console.log(`MDB | GoodreadsAPI Strategy 3 found correct edition: ${editionBook.id}`);
					return [editionBook];
				}
			}
		}

		// ── Fallback: return whatever we found, with a notice ────────────────────
		new Notice(
			`GoodreadsAPI: Could not find an edition with ISBN ${cleanIsbn}. ` +
				`Goodreads may not have this edition indexed. ` +
				`The canonical edition will be imported instead.`,
			8000,
		);
		// Re-run Strategy 1 without verification so the user gets something
		try {
			const fallbackResponse = await browserFetch({ url: `https://www.goodreads.com/book/isbn/${cleanIsbn}`, method: 'GET' }, undefined, true, true);
			const fallbackHtml = fallbackResponse.text;
			const fallbackId = this.extractBookIdFromHtml(fallbackHtml);
			if (fallbackId) {
				const book = this.parseNextDataJSON(fallbackHtml, fallbackId);
				if (book && book.title !== 'Unknown Book') return [book];
			}
		} catch (_) {
			/* ignore */
		}

		return [];
	}

	/** Extract the numeric `legacyId` of the Work from a book-detail page's Apollo State. */
	private extractWorkLegacyId(html: string): string | undefined {
		const apolloState = this.getApolloState(html);
		if (!apolloState) return undefined;

		const workKey = Object.keys(apolloState).find(k => k.startsWith('Work:'));
		if (!workKey) return undefined;

		const legacyId = apolloState[workKey]?.legacyId;
		return legacyId ? String(legacyId) : undefined;
	}

	/** Fetch the editions page for a work and search for an edition matching targetIsbn. */
	private async findEditionByISBN(workLegacyId: string, targetIsbn: string): Promise<BookModel | null> {
		const url = `https://www.goodreads.com/work/editions/${workLegacyId}`;
		try {
			const response = await browserFetch({ url, method: 'GET' }, undefined, true, true);
			const html = response.text;
			this.checkBotDetection(html);

			const apolloState = this.getApolloState(html);
			if (apolloState) {
				// Look for a Details entry whose isbn / isbn13 matches
				const detailsKey = Object.keys(apolloState).find(k => {
					if (!k.startsWith('Details:')) return false;
					const d = apolloState[k];
					const isbn = String(d.isbn ?? '').replace(/[-\s]/g, '');
					const isbn13 = String(d.isbn13 ?? '').replace(/[-\s]/g, '');
					return isbn === targetIsbn || isbn13 === targetIsbn;
				});

				if (detailsKey) {
					// detailsKey is typically "Details:{bookId}" — extract the book ID
					const editionId = detailsKey.replace(/^Details:/, '').trim();
					if (editionId) {
						console.log(`MDB | GoodreadsAPI Editions page found matching ISBN in Details: ${editionId}`);
						return (await this.getById(editionId)) as BookModel;
					}
				}
			}

			// Fallback: scan raw HTML for ISBN in edition list rows
			// ISBN can appear as plain text or in data attributes on the editions page
			const isbnRegex = new RegExp(`href="/book/show/([^"/?#\\s]+)[^"]*"[^>]*>[\\s\\S]{0,500}?${targetIsbn}`, 'i');
			const isbnMatch = isbnRegex.exec(html);
			if (isbnMatch) {
				const id = this.sanitizeId(isbnMatch[1]);
				console.log(`MDB | GoodreadsAPI Editions page raw HTML match: ${id}`);
				return (await this.getById(id)) as BookModel;
			}
		} catch (e) {
			console.warn(`MDB | GoodreadsAPI Editions page search failed:`, e);
		}
		return null;
	}

	private checkBotDetection(html: string): void {
		if (html.includes('Checking your browser') || html.includes('Please verify you are a human') || html.includes('robot check')) {
			new Notice('Goodreads BOT protection triggered. You may need to visit the search page in your browser first.', 10000);
		}
	}

	private extractBookIdFromHtml(html: string, targetIsbn?: string): string | undefined {
		// 0. If we have a target ISBN, prioritize Reverse ISBN Lookup in JSON
		if (targetIsbn) {
			const apolloState = this.getApolloState(html);
			if (apolloState) {
				const detailsKey = Object.keys(apolloState).find(k => {
					if (!k.startsWith('Details:')) return false;
					const details = apolloState[k];
					const isbn = String(details.isbn ?? '').replace(/[-\s]/g, '');
					const isbn13 = String(details.isbn13 ?? '').replace(/[-\s]/g, '');
					return isbn === targetIsbn || isbn13 === targetIsbn;
				});
				if (detailsKey) {
					const id = detailsKey.split(':').pop();
					if (id) {
						console.log(`MDB | GoodreadsAPI found target ISBN ${targetIsbn} matching ID: ${id}`);
						return id;
					}
				}
			}
		}

		// 1. Capture possible IDs from different sources
		const canonMatch = /<link rel="canonical" href="https:\/\/www.goodreads.com\/book\/show\/([^"/?#\s]+)/.exec(html);
		const ogMatch = /<meta property="og:url" content="https:\/\/www.goodreads.com\/book\/show\/([^"/?#\s]+)/.exec(html);
		const broadMatch = /\/book\/show\/([^"/?#\s]+)/.exec(html);

		const canonId = canonMatch ? this.sanitizeId(canonMatch[1]) : undefined;
		const ogId = ogMatch ? this.sanitizeId(ogMatch[1]) : undefined;
		const broadId = broadMatch ? this.sanitizeId(broadMatch[1]) : undefined;

		// 2. Alternate Link Detection (User-Suggested localized versions)
		const altMatch = /<link rel="alternate" [^>]*?href="[^"]*?\/book\/show\/([^"/?#\s]+)"/.exec(html);
		const altId = altMatch ? this.sanitizeId(altMatch[1]) : undefined;

		// 3. Image-based ID Recovery
		// PRIORITY 1: Look at actual <img src> attributes — these point to the *edition-specific*
		// cover shown on the page (uses 'l' suffix for large).
		// PRIORITY 2: og:image meta tag — this often points to the *canonical work* cover, not the
		// specific edition being viewed (uses 'i' suffix for thumbnail).
		// Regex matches both: ...photo.goodreads.com/books/{timestamp}[il]/{bookId}.
		const srcImageMatch = /src="[^"]*compressed\.photo\.goodreads\.com\/books\/\d+[il]\/(\d+)\./.exec(html);
		const ogImageMatch = /<meta property="og:image" content="[^"]*?\/books\/\d+[il]\/(\d+)\./.exec(html);
		const imageId = srcImageMatch?.[1] ?? ogImageMatch?.[1];

		// Smart Selection Logic:
		// 1. Prioritize Image ID if found (Directly linked to the edition's cover on screen)
		if (imageId && /^\d+$/.test(imageId)) {
			console.log(`MDB | GoodreadsAPI captured specific edition ID from cover image: ${imageId}`);
			return imageId;
		}

		// 2. If OG URL (Edition-specific) is numeric, it's safe.
		if (ogId && /^\d+$/.test(ogId)) return ogId;

		// 3. If Alternate ID found and image was missing (often safe for no-cover books)
		if (altId && /^\d+$/.test(altId)) return altId;

		// 4. If Canonical (Primary edition) is numeric, it's safe. Use it as fallback.
		if (canonId && /^\d+$/.test(canonId)) return canonId;

		// 5. If Broad search found a numeric ID, use it.
		if (broadId && /^\d+$/.test(broadId)) return broadId;

		// 4. If all numeric attempts failed, return the first available ID even if alphanumeric (best effort)
		return ogId || canonId || broadId || this.extractFromNextData(html);
	}

	private getApolloState(html: string): any {
		const scriptRegex = /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s;
		const match = scriptRegex.exec(html);
		if (match) {
			try {
				const nextData = JSON.parse(match[1]);
				return nextData?.props?.pageProps?.apolloState;
			} catch (e) {
				/* ignore */
			}
		}
		return undefined;
	}

	private extractFromNextData(html: string): string | undefined {
		const apolloState = this.getApolloState(html);
		if (apolloState) {
			// Find book key by content
			const bookKey = Object.keys(apolloState).find(k => k.startsWith('Book:') && apolloState[k].title);
			if (bookKey) return this.sanitizeId(bookKey.split(':').pop() || '');
		}
		return undefined;
	}

	private sanitizeId(id: string): string {
		if (!id) return id;
		// 1. Remove common URL prefixes and the internal 'kca:' prefix
		let clean = id
			.replace(/^(\/*book\/show\/|\/*book\/|\/*show\/|kca:)/gi, '')
			.replace(/\/.*$/, '')
			.trim();

		// 2. Handle slugs (e.g., '44300886-gulyabani' -> '44300886')
		// If it starts with digits followed by a dash, take only the digits
		if (/^\d+-/.test(clean)) {
			clean = clean.split('-')[0];
		}

		return clean;
	}

	private parseNextDataJSON(html: string, id: string): BookModel {
		const defaultRet = new BookModel({
			title: 'Unknown Book',
			dataSource: this.apiName,
			id: id,
			url: `https://www.goodreads.com/book/show/${id.startsWith('/') ? id.substring(1) : id}`,
			year: 0,
		});

		try {
			const scriptRegex = /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s;
			const match = scriptRegex.exec(html);

			if (!match) {
				console.warn('MDB | GoodreadsAPI: Could not find __NEXT_DATA__ JSON in HTML.');
				return defaultRet;
			}

			const nextData = JSON.parse(match[1]);
			const apolloState = nextData?.props?.pageProps?.apolloState;

			if (!apolloState) {
				console.warn('MDB | GoodreadsAPI: apolloState not found in JSON.');
				return defaultRet;
			}

			const allKeys = Object.keys(apolloState);

			// ── Book object lookup ────────────────────────────────────────────────
			// Goodreads Apollo State keys use an opaque KCA format (e.g. "Book:kca://book/amzn1.gr..."),
			// NOT the numeric Goodreads ID. The numeric ID is stored as 'legacyId' inside the object.
			const bookKey = allKeys.find(
				k =>
					k.startsWith('Book:') &&
					apolloState[k].title &&
					(String(apolloState[k].legacyId) === String(id) || // primary: match by legacyId
						k.includes(id)), // secondary: some older pages embed id in key
			);
			if (!bookKey) {
				// Last resort: take the first Book with a title (usually correct on single-book pages)
				const fallbackKey = allKeys.find(k => k.startsWith('Book:') && apolloState[k].title);
				if (!fallbackKey) return defaultRet;
				return this.mapBookObject(apolloState[fallbackKey], id, apolloState);
			}
			return this.mapBookObject(apolloState[bookKey], id, apolloState);
		} catch (e) {
			console.warn(`MDB | GoodreadsAPI: Error parsing JSON for id ${id}:`, e);
			return defaultRet;
		}
	}

	private mapBookObject(bookObj: any, id: string, apolloState: any): BookModel {
		const title = String(bookObj.title ?? '');
		const subtitle: string = String(bookObj.subtitle ?? '');
		const descriptionHtml: string = String(bookObj.description ?? '');
		const description = descriptionHtml
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<[^>]*>?/gm, '')
			.trim();

		// ── Cover Image ──────────────────────────────────────────────────
		const imageUrl: string = String(bookObj.imageUrl ?? '');

		// ── Details (via __ref) ──────────────────────────────────────────
		const detailsRef = bookObj.details?.__ref;
		const detailsObj = detailsRef ? apolloState[detailsRef] : bookObj.details || {};
		const pages: number = Number(detailsObj?.numPages ?? 0);
		const publishTime: number | undefined = detailsObj?.publicationTime;
		const year = publishTime ? new Date(Number(publishTime)).getFullYear() : 0;
		// ISBN-10: prefer detailsObj.isbn, fallback to ASIN if it's purely numeric (ASIN=ISBN-10 for physical books)
		const rawIsbn10 = detailsObj?.isbn || (detailsObj?.asin && /^\d+$/.test(String(detailsObj.asin)) ? detailsObj.asin : null);
		const isbn: string | null = rawIsbn10 ?? null;
		const isbn13: string | null = detailsObj?.isbn13 ?? null;
		const publisher: string = String(detailsObj?.publisher ?? '');
		const language: string = String(detailsObj?.language?.name ?? '');

		// ── Author ───────────────────────────────────────────────────────
		// Goodreads Apollo State structure varies by page version — try all known paths:
		let authorName = '';

		// Path A (old): bookObj.primaryContributor.__ref → Contributor:{id}.name
		const primaryRef = bookObj.primaryContributor?.__ref;
		if (primaryRef) {
			authorName = String(apolloState[primaryRef]?.name ?? '');
		}

		// Path B (newer): bookObj.primaryContributorEdge.node.__ref → Contributor:{id}.name
		if (!authorName) {
			const edgeNodeRef = bookObj.primaryContributorEdge?.node?.__ref;
			if (edgeNodeRef) {
				authorName = String(apolloState[edgeNodeRef]?.name ?? '');
			}
		}

		// Path C (newest): bookObj.contributors is an array of {node:{__ref}, role} or {author:{__ref}}
		if (!authorName) {
			const contrib = bookObj.contributors ?? bookObj.contributorEdges;
			if (Array.isArray(contrib) && contrib.length > 0) {
				const first = contrib[0];
				const ref = first?.node?.__ref ?? first?.author?.__ref ?? first?.__ref;
				if (ref) authorName = String(apolloState[ref]?.name ?? '');
				// some structures inline the name directly
				if (!authorName && first?.name) authorName = String(first.name);
			}
		}

		// Path D: scan all Contributor: keys in Apollo State (last resort)
		if (!authorName) {
			const contribKey = Object.keys(apolloState).find(k => k.startsWith('Contributor:') && apolloState[k]?.name);
			if (contribKey) authorName = String(apolloState[contribKey].name);
		}

		// ── Ratings & Original Title ──────────────────────────────────────
		const workRef = bookObj.work?.__ref;
		const workObj = workRef ? apolloState[workRef] : null;
		// originalTitle lives in WorkDetails (workObj.details.__ref → apolloState[ref].originalTitle)
		const workDetailsRef = workObj?.details?.__ref;
		const workDetailsObj = workDetailsRef ? apolloState[workDetailsRef] : workObj?.details || null;
		const rawOriginalTitle: string = String(workDetailsObj?.originalTitle || '').trim();
		const originalTitle: string = rawOriginalTitle;
		const statsObj = workObj?.stats as Record<string, any> | null;
		const onlineRating: number = Number(statsObj?.averageRating ?? 0);
		const ratingCount: number = Number(statsObj?.ratingsCount ?? 0);

		// ── Genres ──────────────────────────────────────────────────────
		const genres: string[] = [];
		const bookGenresArr = bookObj.bookGenres;
		if (Array.isArray(bookGenresArr)) {
			for (const g of bookGenresArr) {
				const name = g?.genre?.name;
				if (name && typeof name === 'string') genres.push(name);
			}
		}

		// ── Series (via bookSeries) ────────────────────────────────────
		let seriesName = '';
		let seriesNumber = 0;
		const bookSeriesArr = bookObj.bookSeries;
		if (Array.isArray(bookSeriesArr) && bookSeriesArr.length > 0) {
			const seriesRef = bookSeriesArr[0]?.series?.__ref;
			if (seriesRef) seriesName = String(apolloState[seriesRef]?.title ?? '');

			const pos = bookSeriesArr[0]?.userPosition;
			if (pos !== undefined) seriesNumber = parseFloat(String(pos)) || 0;
		}

		return new BookModel({
			id: id,
			dataSource: this.apiName,
			englishTitle: title,
			originalTitle: originalTitle,
			...this.splitTitleSubtitle(title, subtitle),
			author: authorName,
			year: Number.isNaN(year) ? 0 : year,
			url: `https://www.goodreads.com/book/show/${id}`,

			plot: description,
			pages: pages,
			image: imageUrl,
			onlineRating: onlineRating,
			ratingCount: ratingCount,
			genres: genres,

			isbn: isbn && !Number.isNaN(Number(isbn)) ? Number(isbn) : undefined,
			isbn13: isbn13 && !Number.isNaN(Number(isbn13)) ? Number(isbn13) : undefined,

			seriesName: seriesName,
			seriesNumber: seriesNumber,

			publisher: publisher,
			language: language,

			released: publishTime ? Number(publishTime) <= Date.now() : true,
			userData: {
				read: false,
				lastRead: '',
				personalRating: 0,
			},
		});
	}

	/**
	 * Fallback parser for extracting basic metadata from Legacy HTML / Meta tags.
	 */
	private parseLegacyHTML(html: string, id: string): BookModel {
		const getString = (regex: RegExp): string => {
			const m = regex.exec(html);
			return m ? m[1].trim() : '';
		};

		const title = getString(/<meta property="og:title" content="(.*?)"/i) || getString(/<title>(.*?)<\/title>/i);
		const author = getString(/<meta property="book:author" content="(.*?)"/i) || getString(/<span itemprop="name">(.*?)<\/span>/i);
		const image = getString(/<meta property="og:image" content="(.*?)"/i);
		const description = getString(/<meta property="og:description" content="(.*?)"/i);
		const isbn = getString(/<meta property="books:isbn" content="(.*?)"/i);

		return new BookModel({
			id: id,
			dataSource: this.apiName,
			author: author,
			year: 0,
			plot: description,
			image: image,
			englishTitle: title || 'Unknown Book',
			...this.splitTitleSubtitle(title || 'Unknown Book'),
			released: true,
			userData: {
				read: false,
				lastRead: '',
				personalRating: 0,
			},
		});
	}

	/**
	 * Splits a title into title and subtitle parts using a colon (:) as a separator.
	 * Only triggers if the explicit subtitle is empty.
	 */
	private splitTitleSubtitle(originalTitle: string, explicitSubtitle?: string): { title: string; subtitle: string } {
		if (explicitSubtitle && explicitSubtitle.trim().length > 0) {
			return { title: originalTitle, subtitle: explicitSubtitle };
		}

		if (originalTitle.includes(':')) {
			const parts = originalTitle.split(':');
			const title = parts[0].trim();
			const subtitle = parts.slice(1).join(':').trim();
			return { title, subtitle };
		}

		return { title: originalTitle, subtitle: explicitSubtitle || '' };
	}

	getDisabledMediaTypes(): MediaType[] {
		return (this.plugin.settings as any).GoodreadsAPI_disabledMediaTypes ?? [];
	}
}
