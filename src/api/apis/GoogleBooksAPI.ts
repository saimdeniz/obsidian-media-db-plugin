import { Notice } from 'obsidian';
import type MediaDbPlugin from '../../main';
import { BookModel } from '../../models/BookModel';
import type { MediaTypeModel } from '../../models/MediaTypeModel';
import { ApiSecretID } from '../../settings/apiSecretsHelper';
import { getApiSecretValue } from '../../settings/apiSecretsHelper';
import { MediaType } from '../../utils/MediaType';
import { APIModel } from '../APIModel';
import { rateLimitedRequestUrl as requestUrl } from '../requestUrlRateLimited';
import { requestUrlRateLimited } from '../requestUrlRateLimited';

interface GoogleBooksVolumeInfo {
	title?: string;
	subtitle?: string; // New field
	authors?: string[];
	publishedDate?: string;
	description?: string;
	pageCount?: number;
	publisher?: string; // New field
	language?: string; // New field
	categories?: string[];
	averageRating?: number;
	ratingsCount?: number;
	imageLinks?: {
		thumbnail?: string;
		smallThumbnail?: string;
	};
	industryIdentifiers?: {
		type: string;
		identifier: string;
	}[];
}

interface GoogleBooksItem {
	id: string;
	volumeInfo: GoogleBooksVolumeInfo;
}

interface GoogleBooksResponse {
	items?: GoogleBooksItem[];
	totalItems?: number;
}

export class GoogleBooksAPI extends APIModel {
	plugin: MediaDbPlugin;

	constructor(plugin: MediaDbPlugin) {
		super();
		this.plugin = plugin;
		this.apiName = 'GoogleBooksAPI';
		this.apiDescription = 'Official Google Books API. Provides comprehensive and stable book metadata.';
		this.apiUrl = 'https://www.googleapis.com/books/v1/volumes';
		this.types = [MediaType.Book];
	}

	private getApiKey(): string {
		return getApiSecretValue(this.plugin.app, this.plugin.settings.linkedApiSecretIds, ApiSecretID.googleBooks);
	}

	async searchByTitle(title: string): Promise<MediaTypeModel[]> {
		console.log(`MDB | api "${this.apiName}" queried by Title`);

		const apiKey = this.getApiKey();
		let url = `${this.apiUrl}?q=${encodeURIComponent(title)}&maxResults=20`;
		if (apiKey) {
			url += `&key=${apiKey}`;
		}

		try {
			const response = await requestUrl({ url, method: 'GET', throw: false });
			if (response.status === 429) {
				new Notice('Google Books API quota exceeded. Please enter your own API Key in settings.', 10000);
				return [];
			}
			if (response.status >= 400) {
				console.warn(`MDB | GoogleBooksAPI returned ${response.status}`);
				return [];
			}
			const data = response.json as GoogleBooksResponse;

			if (!data.items) {
				return [];
			}

			return data.items.map(item => this.mapToModel(item));
		} catch (e) {
			console.warn(`MDB | Error querying GoogleBooksAPI:`, e);
			return [];
		}
	}

	async getById(id: string): Promise<MediaTypeModel> {
		console.log(`MDB | api "${this.apiName}" queried by ID`);

		const apiKey = this.getApiKey();
		let url = `${this.apiUrl}/${id}`;
		if (apiKey) {
			url += `?key=${apiKey}`;
		}

		const response = await requestUrlRateLimited({ url, method: 'GET' }, { logLabel: 'GoogleBooksAPI' });
		const data = response.json as GoogleBooksItem;

		return this.mapToModel(data);
	}

	async searchByISBN(isbn: string): Promise<MediaTypeModel[]> {
		console.log(`MDB | api "${this.apiName}" queried by ISBN: ${isbn}`);
		const cleanIsbn = isbn.replace(/[-\s]/g, '');
		const apiKey = this.getApiKey();
		let url = `${this.apiUrl}?q=isbn:${cleanIsbn}`;
		if (apiKey) {
			url += `&key=${apiKey}`;
		}

		try {
			const response = await requestUrl({ url, method: 'GET', throw: false });
			if (response.status === 429) {
				new Notice('Google Books API quota exceeded. Please enter your own API Key in settings.', 10000);
				return [];
			}
			if (response.status >= 400) {
				return [];
			}
			const data = response.json as GoogleBooksResponse;
			if (!data.items) return [];

			return data.items.map(item => this.mapToModel(item));
		} catch (e) {
			console.warn(`MDB | GoogleBooksAPI ISBN search failed for ${isbn}:`, e);
			return [];
		}
	}

	private mapToModel(item: GoogleBooksItem): BookModel {
		const info = item.volumeInfo;
		const year = info.publishedDate ? parseInt(info.publishedDate.substring(0, 4)) : 0;
		const { title, subtitle } = this.splitTitleSubtitle(info.title || 'Unknown Title', info.subtitle);

		let isbn10 = 0;
		let isbn13 = 0;
		if (info.industryIdentifiers) {
			for (const id of info.industryIdentifiers) {
				if (id.type === 'ISBN_10') isbn10 = Number(id.identifier);
				if (id.type === 'ISBN_13') isbn13 = Number(id.identifier);
			}
		}

		// Use the thumbnail but replace http with https and remove edge curl param
		let image = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail;
		if (image) {
			image = image.replace('http:', 'https:').replace('&edge=curl', '');
		}

		return new BookModel({
			id: item.id,
			dataSource: this.apiName,
			title: title,
			englishTitle: info.title || 'Unknown Title',
			originalTitle: '',
			author: info.authors ? info.authors.join(', ') : '',
			year: Number.isNaN(year) ? 0 : year,
			url: `https://books.google.com/books?id=${item.id}`,

			plot: info.description,
			pages: info.pageCount,
			image: image,
			onlineRating: info.averageRating,
			ratingCount: info.ratingsCount,
			genres: info.categories,

			isbn: Number.isNaN(isbn10) ? undefined : isbn10,
			isbn13: Number.isNaN(isbn13) ? undefined : isbn13,

			publisher: info.publisher || '',
			language: info.language || '',
			subtitle: subtitle,

			seriesName: '',
			seriesNumber: 0,

			released: true,
			userData: {
				read: false,
				lastRead: '',
				personalRating: 0,
			},
		});
	}

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
		return (this.plugin.settings as any).GoogleBooksAPI_disabledMediaTypes ?? [];
	}
}
