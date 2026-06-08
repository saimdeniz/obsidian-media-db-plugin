import { MarkdownView, Notice, parseYaml, Plugin, stringifyYaml, TFolder, TFile } from 'obsidian';
import { requestUrl, normalizePath } from 'obsidian';
import type { MediaType } from 'src/utils/MediaType';
import { APIManager } from './api/APIManager';
import { BoardGameGeekAPI } from './api/apis/BoardGameGeekAPI';
import { ComicVineAPI } from './api/apis/ComicVineAPI';
import { GoodreadsAPI } from './api/apis/GoodreadsAPI';
import { GoogleBooksAPI } from './api/apis/GoogleBooksAPI';
import { IGDBAPI } from './api/apis/IGDBAPI';
import { MALAPI } from './api/apis/MALAPI';
import { MALAPIManga } from './api/apis/MALAPIManga';
import { MusicBrainzAPI } from './api/apis/MusicBrainzAPI';
import { MusicBrainzArtistAPI } from './api/apis/MusicBrainzArtistAPI';
import { OMDbAPI } from './api/apis/OMDbAPI';
import { OpenLibraryAPI } from './api/apis/OpenLibraryAPI';
import { RAWGAPI } from './api/apis/RAWGAPI';
import { SteamAPI } from './api/apis/SteamAPI';
import { TMDBMovieAPI } from './api/apis/TMDBMovieAPI';
import { TMDBSeasonAPI } from './api/apis/TMDBSeasonAPI';
import { TMDBSeriesAPI } from './api/apis/TMDBSeriesAPI';
import { VNDBAPI } from './api/apis/VNDBAPI';
import { WikipediaAPI } from './api/apis/WikipediaAPI';
import { GeniusClient } from './api/GeniusClient';
import { MetadataAggregator } from './api/helpers/MetadataAggregator';
import { MUSICBRAINZ_NOTE_DATA_SOURCE, musicBrainzRegisteredApiName } from './api/musicBrainzConstants';
import { SpotifyClient } from './api/SpotifyClient';
import { BulkUpdateConfirmModal } from './modals/BulkUpdateConfirmModal';
import { CompletionModal } from './modals/CompletionModal';
import { ConfirmOverwriteChoice, ConfirmOverwriteModal } from './modals/ConfirmOverwriteModal';
import { MediaDbCoverImagesModal } from './modals/MediaDbCoverImagesModal';
import { MediaDbIdOrIsbnSearchModal } from './modals/MediaDbIdOrIsbnSearchModal';
import type { SeasonSelectModalElement } from './modals/MediaDbSeasonSelectModal';
import { MediaDbSeasonSelectModal } from './modals/MediaDbSeasonSelectModal';
import type { ArtistModel } from './models/ArtistModel';
import { BookModel } from './models/BookModel';
import type { MediaTypeModel } from './models/MediaTypeModel';
import type { MusicReleaseModel } from './models/MusicReleaseModel';
import type { SeasonModel } from './models/SeasonModel';
import { SongModel } from './models/SongModel';
import { ApiSecretID, getApiSecretValue } from './settings/apiSecretsHelper';
import { PropertyMapper } from './settings/PropertyMapper';
import { PropertyMappingModel } from './settings/PropertyMapping';
import type { MediaDbPluginSettings } from './settings/Settings';
import { getDefaultSettings, MediaDbSettingTab, propertyMappingModelsInDisplayOrder } from './settings/Settings';
import { BulkImportHelper } from './utils/BulkImportHelper';
import { BulkUpdateHelper } from './utils/BulkUpdateHelper';
import { DateFormatter } from './utils/DateFormatter';
import { MEDIA_TYPES } from './utils/MediaType';
import { MediaTypeManager } from './utils/MediaTypeManager';
import type { SearchModalOptions } from './utils/ModalHelper';
import { ModalHelper } from './utils/ModalHelper';
import { NoteManager } from './utils/NoteManager';
import { noteTypeValueForMedia, resolveMetadataTypeToMediaType } from './utils/noteTypeSettings';
import type { CreateNoteOptions } from './utils/Utils';
import {
	replaceIllegalFileNameCharactersInString,
	unCamelCase,
	hasTemplaterPlugin,
	useTemplaterPluginInFile,
	dateTimeToString,
	markdownTable,
	parseUsdWholeDollarsFromDisplayString,
	normalizeTitleForAsciiAlias,
	mergeNoteBodies,
} from './utils/Utils';
import 'src/styles.css';

export type Metadata = Record<string, unknown>;

export interface MediaTypeModelObj {
	id: string;
	type: MediaType;
	dataSource: string;
}

export default class MediaDbPlugin extends Plugin {
	declare settings: MediaDbPluginSettings;
	metadataAggregator!: MetadataAggregator;
	apiManager!: APIManager;
	mediaTypeManager!: MediaTypeManager;
	modelPropertyMapper!: PropertyMapper;
	modalHelper!: ModalHelper;
	bulkImportHelper!: BulkImportHelper;
	bulkUpdateHelper!: BulkUpdateHelper;
	noteManager!: NoteManager;
	dateFormatter!: DateFormatter;

	frontMatterRexExpPattern: string = '^(---)\\n[\\s\\S]*?\\n---';

	async onload(): Promise<void> {
		this.apiManager = new APIManager();
		// register APIs
		this.apiManager.registerAPI(new OMDbAPI(this));
		this.apiManager.registerAPI(new MALAPI(this));
		this.apiManager.registerAPI(new MALAPIManga(this));
		this.apiManager.registerAPI(new WikipediaAPI(this));
		this.apiManager.registerAPI(new MusicBrainzAPI(this));
		this.apiManager.registerAPI(new MusicBrainzArtistAPI(this));
		this.apiManager.registerAPI(new SteamAPI(this));
		this.apiManager.registerAPI(new TMDBSeriesAPI(this));
		this.apiManager.registerAPI(new TMDBSeasonAPI(this));
		this.apiManager.registerAPI(new TMDBMovieAPI(this));
		this.apiManager.registerAPI(new BoardGameGeekAPI(this));
		this.apiManager.registerAPI(new OpenLibraryAPI(this));
		this.apiManager.registerAPI(new ComicVineAPI(this));
		this.apiManager.registerAPI(new IGDBAPI(this));
		this.apiManager.registerAPI(new RAWGAPI(this));
		this.apiManager.registerAPI(new VNDBAPI(this));
		this.apiManager.registerAPI(new GoogleBooksAPI(this));
		this.apiManager.registerAPI(new GoodreadsAPI(this));

		this.mediaTypeManager = new MediaTypeManager();
		this.modelPropertyMapper = new PropertyMapper(this);
		this.modalHelper = new ModalHelper(this);
		this.bulkImportHelper = new BulkImportHelper(this);
		this.bulkUpdateHelper = new BulkUpdateHelper(this);
		this.noteManager = new NoteManager(this);

		this.dateFormatter = new DateFormatter();

		await this.loadSettings();

		// Init after settings are loaded so MetadataAggregator has correct settings references
		this.metadataAggregator = new MetadataAggregator(this.apiManager, this.settings);

		// register the settings tab
		this.addSettingTab(new MediaDbSettingTab(this.app, this));

		this.mediaTypeManager.updateTemplates(this.settings);
		this.mediaTypeManager.updateFolders(this.settings);
		this.dateFormatter.setFormat(this.settings.customDateFormat);
		this.addRibbonIcon('search', 'Media DB: Advanced Search', () => {
			void this.createEntryWithAdvancedSearchModal();
		});
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFolder) {
					// Add our customized context menu options under a "Media DB" group
					menu.addItem(item => {
						item.setTitle('Media DB...');
						item.setIcon('database');
						// @ts-ignore
						if (typeof item.setSubmenu === 'function') {
							// @ts-ignore
							const sub = item.setSubmenu();
							sub.addItem((subItem: any) =>
								subItem
									.setTitle('Bulk Import Folder')
									.setIcon('database')
									.onClick(() => this.bulkImportHelper.import(file)),
							);
							sub.addItem((subItem: any) =>
								subItem
									.setTitle('Bulk Update Metadata')
									.setIcon('refresh-cw')
									.onClick(() => this.bulkUpdateHelper.updateFolder(file)),
							);

							sub.addItem((subItem: any) =>
								subItem
									.setTitle('Download images in folder')
									.setIcon('image')
									.onClick(() => this.noteManager.downloadImagesInFolder(file)),
							);
						} else {
							// Fallback if setSubmenu isn't in older Obsidian versions
							item.onClick(() => this.bulkUpdateHelper.updateFolder(file));
						}
					});
				}
			}),
		);

		this.registerEvent(
			this.app.vault.on('delete', async file => {
				if (file instanceof TFile) {
					await this.noteManager.removeImageFromCache(file.path);
				}
			}),
		);

		// register command to open search modal
		this.addCommand({
			id: 'open-media-db-search-modal',
			name: 'Create Media DB entry',
			callback: () => this.createEntryWithSearchModal(),
		});
		this.updateCreatorCommands();
		this.addCommand({
			id: 'open-media-db-advanced-search-modal',
			name: 'Create Media DB entry (advanced search)',
			callback: () => this.createEntryWithAdvancedSearchModal(),
		});
		this.addCommand({
			id: 'open-media-db-id-or-isbn-search-modal',
			name: 'Create Media DB entry by ID or ISBN',
			callback: () => {
				void this.createEntryWithIdOrIsbnSearchModal();
			},
		});

		this.addCommand({
			id: 'update-media-db-note-metadata',
			name: 'Update active note metadata',
			checkCallback: (checking: boolean) => {
				if (!this.app.workspace.getActiveFile()) {
					return false;
				}
				if (!checking) {
					void this.updateActiveNote(true, this.settings.preservePropertyOrderOnUpdate, false);
				}
				return true;
			},
		});

		this.addCommand({
			id: 'update-media-db-note-metadata-and-body',
			name: 'Update active note metadata and body',
			checkCallback: (checking: boolean) => {
				if (!this.app.workspace.getActiveFile()) {
					return false;
				}
				if (!checking) {
					void this.updateActiveNote(true, this.settings.preservePropertyOrderOnUpdate, true);
				}
				return true;
			},
		});

		// register link insert command
		this.addCommand({
			id: 'add-media-db-link',
			name: 'Insert link',
			checkCallback: (checking: boolean) => {
				if (!this.app.workspace.getActiveFile()) {
					return false;
				}
				if (!checking) {
					void this.createLinkWithSearchModal();
				}
				return true;
			},
		});

		this.addCommand({
			id: 'media-db-manage-cover-images',
			name: 'Manage cover images',
			callback: () => {
				new MediaDbCoverImagesModal(this).open();
			},
		});
	}

	async createLinkWithSearchModal(): Promise<void> {
		const apiSearchResults = await this.modalHelper.openAdvancedSearchModal({}, async advancedSearchModalData => {
			return await this.apiManager.query(advancedSearchModalData.query, advancedSearchModalData.apis);
		});

		if (!apiSearchResults) {
			return;
		}

		const selectResults = await this.modalHelper.openSelectModal({ elements: apiSearchResults, multiSelect: false }, async selectModalData => {
			return await this.queryDetails(selectModalData.selected);
		});

		if (!selectResults || selectResults.length < 1) {
			return;
		}

		const link = `[${selectResults[0].title}](${selectResults[0].url})`;

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);

		// Make sure the user is editing a Markdown file.
		if (view) {
			view.editor.replaceRange(link, view.editor.getCursor());
		}
	}

	async createEntryWithSearchModal(searchModalOptions?: SearchModalOptions): Promise<void> {
		let types: string[] = [];
		let apiSearchResults = await this.modalHelper.openSearchModal(searchModalOptions ?? {}, async searchModalData => {
			types = searchModalData.types;
			const apis = this.apiManager.apis.filter(x => x.hasTypeOverlap(searchModalData.types)).map(x => x.apiName);
			try {
				return await this.apiManager.query(searchModalData.query, apis);
			} catch (e) {
				console.warn('MDB | Query failed:', e);
				new Notice(`Search failed: ${e}`);
				return [];
			}
		});

		if (!apiSearchResults || apiSearchResults.length === 0) {
			new Notice('No results found.');
			return;
		}

		// filter the results
		apiSearchResults = apiSearchResults.filter(x => types.contains(x.type));

		if (apiSearchResults.length === 0) {
			new Notice('No results found for the selected types.');
			return;
		}

		// Show selection modal - for seasons, skip detail query
		const selectResults =
			types.length === 1 && types[0] === 'season'
				? await this.modalHelper.openSelectModal(
						{
							elements: apiSearchResults,
							description: 'Select one search result to proceed.',
							submitButtonText: 'Ok',
						},
						async selectModalData => selectModalData.selected,
					)
				: await this.modalHelper.openSelectModal({ elements: apiSearchResults }, async selectModalData => this.queryDetails(selectModalData.selected));

		if (!selectResults || selectResults.length === 0) {
			return;
		}

		// Handle season selection for both direct season searches and series-to-season conversion
		const seasonHandlingResult = await this.handleSeasonWorkflow(types, selectResults);
		if (seasonHandlingResult.handled) {
			return;
		}

		// Show preview and confirm
		const confirmed = await this.modalHelper.openPreviewModal({ elements: selectResults }, async previewModalData => previewModalData.confirmed);
		if (!confirmed) {
			return;
		}

		// User confirmed, create notes and exit
		await this.createMediaDbNotes(selectResults);
	}

	/**
	 * Handles the season workflow for both direct season searches and series-to-season conversion.
	 * Returns an object indicating what happened and how to proceed.
	 */
	private async handleSeasonWorkflow(types: string[], selectResults: MediaTypeModel[]): Promise<{ handled: boolean; seasonsCreated?: boolean }> {
		// Case 1: User searched specifically for seasons and selected a series from TMDB
		if (types.length === 1 && types[0] === 'season' && selectResults.length === 1 && selectResults[0].dataSource === 'TMDBSeasonAPI') {
			const created = await this.showSeasonSelectAndCreate(selectResults[0].id, selectResults[0].englishTitle || selectResults[0].title);
			return { handled: true, seasonsCreated: created };
		}

		// Case 2: User searched for series but it's actually from TMDBSeasonAPI
		// (This happens when searching for seasons returns series results)
		if (types.includes('series') && selectResults.some(r => r.dataSource === 'TMDBSeriesAPI')) {
			const seriesResults = selectResults.filter(r => r.dataSource === 'TMDBSeriesAPI');
			// If only one series result and user searched for seasons, show season selection
			if (seriesResults.length === 1 && types.includes('season')) {
				const created = await this.showSeasonSelectAndCreate(seriesResults[0].id, seriesResults[0].title);
				return { handled: true, seasonsCreated: created };
			}
		}

		return { handled: false };
	}

	/**
	 * Shows the season selection modal for a given series and creates notes for selected seasons.
	 * Returns true if seasons were successfully created, false if cancelled.
	 */
	private async showSeasonSelectAndCreate(seriesId: string, seriesTitle: string): Promise<boolean> {
		const tmdbSeasonAPI = this.apiManager.getApiByName('TMDBSeasonAPI') as TMDBSeasonAPI;
		if (!tmdbSeasonAPI) {
			new Notice('TMDBSeasonAPI not available.');
			return false;
		}

		try {
			// Fetch all seasons for the selected series
			const allSeasons = await tmdbSeasonAPI.getSeasonsForSeries(seriesId);
			if (!allSeasons || allSeasons.length === 0) {
				new Notice('No seasons found for this series.');
				return false;
			}

			// Show season selection modal
			const selectedSeasons = await this.showSeasonSelectModal(allSeasons, seriesTitle);
			if (!selectedSeasons || selectedSeasons.length === 0) {
				return false;
			}

			// Create notes for all selected seasons in parallel
			await this.createNotesForSelectedSeasons(selectedSeasons, allSeasons, tmdbSeasonAPI);
			new Notice(`Successfully created ${selectedSeasons.length} season ${selectedSeasons.length === 1 ? 'entry' : 'entries'}.`);
			return true;
		} catch (e) {
			console.warn('MDB | Error in season selection workflow:', e);
			new Notice(`Error loading seasons: ${e}`);
			return false;
		}
	}

	/**
	 * Shows the season selection modal and returns the selected seasons.
	 */
	private async showSeasonSelectModal(allSeasons: SeasonModel[], seriesTitle: string): Promise<SeasonSelectModalElement[] | undefined> {
		const modal = new MediaDbSeasonSelectModal(
			this,
			allSeasons.map(s => ({
				season_number: s.seasonNumber,
				name: s.seasonTitle || s.title,
				episode_count: s.episodes || 0,
				air_date: s.year > 0 ? String(s.year) : 'unknown',
				poster_path: s.image,
			})),
			true,
			seriesTitle,
		);

		return new Promise(resolve => {
			modal.setSubmitCb(resolve);
			modal.open();
		});
	}

	/**
	 * Creates notes for all selected seasons by fetching full metadata and creating entries.
	 */
	private async createNotesForSelectedSeasons(selectedSeasons: SeasonSelectModalElement[], allSeasons: SeasonModel[], tmdbSeasonAPI: TMDBSeasonAPI): Promise<void> {
		await Promise.all(
			selectedSeasons.map(async selectedSeason => {
				const seasonModel = allSeasons.find(s => s.seasonNumber === selectedSeason.season_number);
				if (seasonModel) {
					try {
						// Fetch full metadata using getById
						const fullMetadata = await tmdbSeasonAPI.getById(seasonModel.id);
						await this.createMediaDbNotes([fullMetadata]);
					} catch (e) {
						console.warn(`MDB | Failed to create season ${selectedSeason.season_number}:`, e);
						new Notice(`Failed to create season ${selectedSeason.season_number}: ${e}`);
					}
				}
			}),
		);
	}

	async createEntryWithAdvancedSearchModal(): Promise<void> {
		const apiSearchResults = await this.modalHelper.openAdvancedSearchModal({}, async advancedSearchModalData => {
			return await this.apiManager.query(advancedSearchModalData.query, advancedSearchModalData.apis);
		});

		if (!apiSearchResults || apiSearchResults.length === 0) {
			new Notice('No results found.');
			return;
		}

		let selectResults: MediaTypeModel[];
		const proceed: boolean = false;

		while (!proceed) {
			selectResults =
				(await this.modalHelper.openSelectModal({ elements: apiSearchResults }, async selectModalData => {
					return await this.queryDetails(selectModalData.selected);
				})) ?? [];
			if (!selectResults || selectResults.length < 1) {
				return;
			}

			const confirmed = await this.modalHelper.openPreviewModal({ elements: selectResults }, async previewModalData => {
				return previewModalData.confirmed;
			});
			if (!confirmed) {
				return;
			}
			break;
		}

		await this.createMediaDbNotes(selectResults!);
	}

	async createEntryWithIdOrIsbnSearchModal(): Promise<void> {
		new MediaDbIdOrIsbnSearchModal(this, async res => {
			if (res.type === 'id') {
				if (!res.api) {
					new Notice('No API selected');
					return;
				}
				new Notice(`Searching by ID: ${res.query}...`);
				try {
					const idSearchResult = await this.apiManager.queryDetailedInfoById(res.query, res.api);
					if (!idSearchResult) {
						new Notice(`No entry found for ID ${res.query} in API ${res.api}`);
						return;
					}
					const confirmed = await this.modalHelper.openPreviewModal({ elements: [idSearchResult] }, async previewModalData => {
						return previewModalData.confirmed;
					});
					if (confirmed) {
						await this.createMediaDbNoteFromModel(idSearchResult, { attachTemplate: true, openNote: true });
					}
				} catch (e) {
					new Notice(`Search failed: ${e}`);
				}
			} else {
				new Notice(`Searching for ISBN: ${res.query}...`);
				const apis = ['GoodreadsAPI', 'GoogleBooksAPI'];
				try {
					const results = await this.apiManager.queryByIsbn(res.query, apis);
					if (results.length === 0) {
						new Notice('No results found for this ISBN.');
						return;
					}
					let selected: MediaTypeModel;
					if (results.length === 1) {
						selected = results[0];
					} else {
						const selectResults = await this.modalHelper.openSelectModal(
							{ elements: results, multiSelect: false, description: 'Multiple sources found for this ISBN. Select one:' },
							async data => data.selected,
						);
						if (!selectResults || selectResults.length === 0) return;
						selected = selectResults[0];
					}
					const detailed = await this.apiManager.queryDetailedInfo(selected);
					if (!detailed) {
						new Notice('Failed to fetch full details for the selected book.');
						return;
					}
					const confirmed = await this.modalHelper.openPreviewModal({ elements: [detailed] }, async data => data.confirmed);
					if (confirmed) {
						await this.createMediaDbNoteFromModel(detailed, { attachTemplate: true, openNote: true });
					}
				} catch (e) {
					new Notice(`Search failed: ${e}`);
				}
			}
		}).open();
	}

	updateCreatorCommands(): void {
		const pluginId = this.manifest.id;
		for (const mediaType of MEDIA_TYPES) {
			const commandId = `${pluginId}:open-media-db-search-modal-with-${mediaType}`;
			try {
				(this.app as any).commands.removeCommand(commandId);
			} catch (e) {
				// Ignore if command wasn't registered
			}
		}

		for (const mediaType of this.settings.activeCreatorCommands) {
			this.addCommand({
				id: `open-media-db-search-modal-with-${mediaType}`,
				name: `Create Media DB entry: ${unCamelCase(mediaType)}`,
				callback: () => this.createEntryWithSearchModal({ preselectedTypes: [mediaType] }),
			});
		}
	}

	async createMediaDbNotes(models: MediaTypeModel[], attachFile?: TFile): Promise<void> {
		return this.noteManager.createMediaDbNotes(models, attachFile);
	}

	async queryDetails(models: MediaTypeModel[]): Promise<MediaTypeModel[]> {
		return this.noteManager.queryDetails(models);
	}

	async createMediaDbNoteFromModel(mediaTypeModel: MediaTypeModel, options: CreateNoteOptions): Promise<void> {
		return this.noteManager.createMediaDbNoteFromModel(mediaTypeModel, options);
	}

	getMetadataFromFileCache(file: TFile): Metadata {
		return this.noteManager.getMetadataFromFileCache(file);
	}

	async updateActiveNote(onlyMetadata: boolean = false, preserveOrder: boolean = false, updateBody: boolean = false): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile() ?? undefined;
		if (!activeFile) {
			throw new Error('MDB | there is no active note');
		}
		try {
			await this.updateNote(activeFile, onlyMetadata, preserveOrder, true, false, updateBody);
			new Notice(`Successfully updated: ${activeFile.basename}`);
		} catch (e) {
			new Notice(`Update failed: ${e}`);
		}
	}

	async updateNote(
		activeFile: TFile,
		onlyMetadata: boolean = false,
		preserveOrder: boolean = false,
		openNoteFinal: boolean = true,
		overwrite: boolean = false,
		updateBody: boolean = false,
	): Promise<void> {
		let metadata = this.getMetadataFromFileCache(activeFile);
		metadata = this.modelPropertyMapper.convertObjectBack(metadata);

		console.debug(`MDB | read metadata`, metadata);

		if (!metadata?.type || !metadata?.id) {
			throw new Error('MDB | active note is not a Media DB entry or is missing metadata');
		}

		const mediaType = resolveMetadataTypeToMediaType(this.settings, metadata.type);
		if (mediaType === undefined) {
			throw new Error('MDB | active note type is not recognized; check Settings → Note type for each media kind');
		}
		let dataSource = typeof metadata.dataSource === 'string' ? metadata.dataSource.trim() : '';
		if (!dataSource && musicBrainzRegisteredApiName(mediaType)) {
			dataSource = MUSICBRAINZ_NOTE_DATA_SOURCE;
		}
		if (!dataSource) {
			throw new Error('MDB | active note is missing dataSource (required for this media type)');
		}

		const validOldMetadata: MediaTypeModelObj = { ...metadata, dataSource } as unknown as MediaTypeModelObj;
		console.debug(`MDB | validOldMetadata`, validOldMetadata);

		const oldMediaTypeModel = this.mediaTypeManager.createMediaTypeModelFromMediaType(validOldMetadata, mediaType);
		console.debug(`MDB | oldMediaTypeModel created`, oldMediaTypeModel);

		let newMediaTypeModel = await this.apiManager.queryDetailedInfoById(validOldMetadata.id, validOldMetadata.dataSource, mediaType);
		if (!newMediaTypeModel) {
			throw new Error(`No data returned for id "${validOldMetadata.id}" from "${validOldMetadata.dataSource}". The ID may be invalid or the source may be unavailable.`);
		}

		if (onlyMetadata) {
			// Safe mode: preserve old userData by merging old model with fresh API data
			newMediaTypeModel = Object.assign(oldMediaTypeModel, newMediaTypeModel.getWithOutUserData());
			const ignoredSections = this.settings.ignoredBodySectionsOnUpdate
				? this.settings.ignoredBodySectionsOnUpdate
						.split(',')
						.map(s => s.trim().toLowerCase())
						.filter(s => s.length > 0)
				: [];
			await this.createMediaDbNoteFromModel(newMediaTypeModel, {
				attachFile: activeFile,
				folder: activeFile.parent ?? undefined,
				openNote: openNoteFinal,
				overwrite,
				preservePropertyOrder: preserveOrder,
				updateBody,
				ignoredSections,
			});
		} else {
			// Reset mode: use fresh API data with default userData (no merge — userData is intentionally cleared)
			await this.createMediaDbNoteFromModel(newMediaTypeModel, { attachTemplate: true, folder: activeFile.parent ?? undefined, openNote: openNoteFinal, overwrite });
		}
	}

	async loadSettings(): Promise<void> {
		const diskSettings: MediaDbPluginSettings = (await this.loadData()) as MediaDbPluginSettings;
		const defaultSettings: MediaDbPluginSettings = getDefaultSettings(this);
		const loadedSettings: MediaDbPluginSettings = Object.assign({}, defaultSettings, diskSettings);

		// Migrate property mappings using the dedicated migration method
		const migratedModels = PropertyMappingModel.migrateModels(
			loadedSettings.propertyMappingModels || [],
			defaultSettings.propertyMappingModels.map(m => PropertyMappingModel.fromJSON(m)),
		);

		// Store as plain data for serialization (canonical order matches settings UI)
		loadedSettings.propertyMappingModels = propertyMappingModelsInDisplayOrder(migratedModels.map(m => m.toJSON()));

		// --- MIGRATION: Band to Artist ---
		const anyLoaded = diskSettings as any;
		if (anyLoaded) {
			if (anyLoaded.bandTemplate && !loadedSettings.artistTemplate) loadedSettings.artistTemplate = anyLoaded.bandTemplate;
			if (anyLoaded.bandFolder && !loadedSettings.artistFolder) loadedSettings.artistFolder = anyLoaded.bandFolder;
			if (anyLoaded.bandFileNameTemplate && !loadedSettings.artistFileNameTemplate) loadedSettings.artistFileNameTemplate = anyLoaded.bandFileNameTemplate;
			if (anyLoaded.bandNoteType && !loadedSettings.artistNoteType) loadedSettings.artistNoteType = anyLoaded.bandNoteType;
			if (anyLoaded.bandUseFileTreeForSongs !== undefined && loadedSettings.artistUseFileTreeForSongs === false)
				loadedSettings.artistUseFileTreeForSongs = anyLoaded.bandUseFileTreeForSongs;
			if (anyLoaded.MusicBrainzBandAPI_disabledMediaTypes && !loadedSettings.MusicBrainzArtistAPI_disabledMediaTypes)
				loadedSettings.MusicBrainzArtistAPI_disabledMediaTypes = anyLoaded.MusicBrainzBandAPI_disabledMediaTypes;
		}

		this.settings = loadedSettings;
	}

	async saveSettings(): Promise<void> {
		this.mediaTypeManager.updateTemplates(this.settings);
		this.mediaTypeManager.updateFolders(this.settings);
		this.dateFormatter.setFormat(this.settings.customDateFormat);

		await this.saveData(this.settings);
	}
}
