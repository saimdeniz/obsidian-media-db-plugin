import { BookModel } from '../../models/BookModel';
import type { APIManager } from '../APIManager';
import type { MediaDbPluginSettings } from '../../settings/Settings';

export class MetadataAggregator {
	private apiManager: APIManager;
	private settings: MediaDbPluginSettings;

	constructor(apiManager: APIManager, settings: MediaDbPluginSettings) {
		this.apiManager = apiManager;
		this.settings = settings;
	}

	/**
	 * Hydrates a base BookModel with data from other enabled book APIs based on priority settings.
	 */
	async hydrateBook(baseModel: BookModel): Promise<BookModel> {
		// Only proceed if hybrid mode is enabled via our new settings
		if (!(this.settings as any).enableHybridBookMetadata) {
			return baseModel;
		}

		console.log(`MDB | Hydrating book ${baseModel.title} using Hybrid Mode...`);

		const targetApis = ['AmazonAPI', 'GoodreadsAPI', 'GoogleBooksAPI', 'OpenLibraryAPI'];

		const enabledApis = this.apiManager.apis.filter(
			api => targetApis.includes(api.apiName) && !api.getDisabledMediaTypes().includes(baseModel.getMediaType()) && api.apiName !== baseModel.dataSource,
		);

		if (enabledApis.length === 0) {
			return baseModel;
		}

		// We prefer ISBN since it's an exact match.
		const query = baseModel.isbn13 ? String(baseModel.isbn13) : baseModel.isbn ? String(baseModel.isbn) : `${baseModel.title} ${baseModel.author}`.trim();

		const hydrationPromises = enabledApis.map(async api => {
			try {
				const results = await api.searchByTitle(query);
				if (results.length > 0) {
					// We take the top result. If searching by ISBN, it's highly accurate.
					const result = results[0];
					const detailedModel = await api.getById(result.id);
					return detailedModel as BookModel;
				}
			} catch (e) {
				console.warn(`MDB | Aggregator failed to fetch from ${api.apiName}`, e);
			}
			return null;
		});

		const fetchedModels = (await Promise.all(hydrationPromises)).filter(m => m !== null) as BookModel[];

		// Add the base model to the pool of models we have data from
		const allModels = [baseModel, ...fetchedModels];
		const modelMap = new Map<string, BookModel>();
		allModels.forEach(m => modelMap.set(m.dataSource, m));

		const priorities = (this.settings as any).bookPropertyPriorities || {
			image: ['AmazonAPI', 'GoodreadsAPI', 'GoogleBooksAPI', 'OpenLibraryAPI'],
			plot: ['GoodreadsAPI', 'GoogleBooksAPI', 'AmazonAPI', 'OpenLibraryAPI'],
			ratings: ['GoodreadsAPI', 'AmazonAPI', 'GoogleBooksAPI', 'OpenLibraryAPI'],
			genres: ['GoodreadsAPI', 'GoogleBooksAPI', 'AmazonAPI', 'OpenLibraryAPI'],
			series: ['GoodreadsAPI', 'GoogleBooksAPI', 'AmazonAPI', 'OpenLibraryAPI'],
		};

		// 1. Cover Image Priority
		baseModel.image = this.getFirstValidValue(modelMap, priorities.image, m => m.image as any);

		// 2. Plot / Description Priority
		baseModel.plot = this.getFirstValidValue(modelMap, priorities.plot, m => m.plot as any);

		// 3. Ratings Priority
		const ratingModelSource = this.getFirstValidSource(modelMap, priorities.ratings, m => m.onlineRating > 0);
		if (ratingModelSource) {
			const m = modelMap.get(ratingModelSource)!;
			baseModel.onlineRating = m.onlineRating;
			baseModel.ratingCount = m.ratingCount > 0 ? m.ratingCount : baseModel.ratingCount;
		}

		// 4. Genres Priority
		const genreModelSource = this.getFirstValidSource(modelMap, priorities.genres, m => !!m.genres && m.genres.length > 0);
		if (genreModelSource) {
			baseModel.genres = modelMap.get(genreModelSource)!.genres;
		}

		// 5. Series Info Priority
		const seriesModelSource = this.getFirstValidSource(modelMap, priorities.series, m => !!m.seriesName && m.seriesName.length > 0);
		if (seriesModelSource) {
			const m = modelMap.get(seriesModelSource)!;
			baseModel.seriesName = m.seriesName;
			baseModel.seriesNumber = m.seriesNumber;
		}

		// 6. Fill missing basic metadata (Pages, Year) from anywhere if missing
		if (!baseModel.pages) {
			baseModel.pages = this.getFirstValidValue(allModels, null, m => m.pages) || 0;
		}
		if (!baseModel.year) {
			baseModel.year = this.getFirstValidValue(allModels, null, m => m.year) || 0;
		}

		console.log(`MDB | Hydration complete for ${baseModel.title}.`);
		return baseModel;
	}

	private getFirstValidSource(modelsBySource: Map<string, BookModel>, priorityList: string[], validationFn: (m: BookModel) => boolean): string | null {
		for (const source of priorityList) {
			const model = modelsBySource.get(source);
			if (model && validationFn(model)) {
				return source;
			}
		}
		return null;
	}

	private getFirstValidValue<T>(obj: Map<string, BookModel> | BookModel[], priorityList: string[] | null, extractionFn: (m: BookModel) => T): T | undefined {
		if (priorityList && obj instanceof Map) {
			for (const source of priorityList) {
				const model = obj.get(source);
				if (model) {
					const val = extractionFn(model);
					if (val !== undefined && val !== null && val !== '') {
						return val;
					}
				}
			}
		} else if (Array.isArray(obj)) {
			// Just get first valid encountered
			for (const model of obj) {
				const val = extractionFn(model);
				if (val !== undefined && val !== null && val !== '') {
					return val;
				}
			}
		}
		return undefined;
	}
}
