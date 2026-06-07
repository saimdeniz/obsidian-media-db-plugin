import { Notice } from 'obsidian';
import type { MediaTypeModel } from '../models/MediaTypeModel';
import type { MediaType } from '../utils/MediaType';
import type { APIModel } from './APIModel';

export class APIManager {
	apis: APIModel[];

	constructor() {
		this.apis = [];
	}

	/**
	 * Queries the basic info for one query string and multiple APIs.
	 *
	 * @param query
	 * @param apisToQuery
	 */
	async query(query: string, apisToQuery: string[]): Promise<MediaTypeModel[]> {
		console.debug(`MDB | api manager queried with "${query}"`);

		const promises = this.apis
			.filter(api => apisToQuery.contains(api.apiName))
			.map(async api => {
				try {
					return await api.searchByTitle(query);
				} catch (e) {
					new Notice(`Error querying ${api.apiName}: ${e}`);
					console.warn(e);

					return [];
				}
			});

		return (await Promise.all(promises)).flat();
	}

	/**
	 * Queries the basic info for one ISBN and multiple APIs.
	 *
	 * @param isbn
	 * @param apisToQuery
	 */
	async queryByIsbn(isbn: string, apisToQuery: string[]): Promise<MediaTypeModel[]> {
		console.debug(`MDB | api manager queried by ISBN "${isbn}"`);

		const promises = this.apis
			.filter(api => apisToQuery.contains(api.apiName))
			.map(async api => {
				try {
					if (typeof api.searchByISBN === 'function') {
						return await api.searchByISBN(isbn);
					}
					return [];
				} catch (e) {
					new Notice(`Error querying ${api.apiName}: ${e}`);
					console.warn(e);

					return [];
				}
			});

		return (await Promise.all(promises)).flat();
	}

	/**
	 * Queries detailed information for a MediaTypeModel.
	 *
	 * @param item
	 */
	async queryDetailedInfo(item: MediaTypeModel): Promise<MediaTypeModel | undefined> {
		return await this.queryDetailedInfoById(item.id, item.dataSource, item.getMediaType());
	}

	/**
	 * Queries detailed info for an id from an API.
	 * MusicBrainz-backed notes use on-disk dataSource `MusicBrainz`; `mediaType` picks Artist vs release/song API.
	 *
	 * @param id
	 * @param apiName Stored dataSource on the note, or an exact {@link APIModel.apiName} (e.g. bulk import / ID search).
	 * @param mediaType When set with a MusicBrainz family dataSource, selects which MusicBrainz API handles {@link getById}.
	 */
	async queryDetailedInfoById(id: string, apiName: string, mediaType?: MediaType): Promise<MediaTypeModel | undefined> {
		const effectiveApiName = apiName.trim() || apiName;

		// Delegate to each registered API — APIs override canHandleDataSource() for special logic
		for (const api of this.apis) {
			if (api.canHandleDataSource(effectiveApiName, mediaType)) {
				return await api.getById(id);
			}
		}

		return undefined;
	}

	getApiByName(name: string): APIModel | undefined {
		for (const api of this.apis) {
			if (api.apiName === name) {
				return api;
			}
		}

		return undefined;
	}

	registerAPI(api: APIModel): void {
		this.apis.push(api);
	}
}
