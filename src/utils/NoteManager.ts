import type { App } from 'obsidian';
import { Notice, parseYaml, TFile, TFolder, stringifyYaml, requestUrl, normalizePath, MarkdownView } from 'obsidian';
import type { MusicBrainzAPI } from '../api/apis/MusicBrainzAPI';
import type { MusicBrainzArtistAPI } from '../api/apis/MusicBrainzArtistAPI';
import { GeniusClient } from '../api/GeniusClient';
import { MUSICBRAINZ_NOTE_DATA_SOURCE, musicBrainzRegisteredApiName } from '../api/musicBrainzConstants';
import { SpotifyClient } from '../api/SpotifyClient';
import type MediaDbPlugin from '../main';
import { CompletionModal } from '../modals/CompletionModal';
import { ConfirmOverwriteChoice, ConfirmOverwriteModal } from '../modals/ConfirmOverwriteModal';
import type { ArtistModel } from '../models/ArtistModel';
import { BookModel } from '../models/BookModel';
import type { MediaTypeModel } from '../models/MediaTypeModel';
import { MediaType, MEDIA_TYPES } from './MediaType';
import type { MusicReleaseModel } from '../models/MusicReleaseModel';
import { SongModel } from '../models/SongModel';
import { ApiSecretID, getApiSecretValue } from '../settings/apiSecretsHelper';
import { noteTypeValueForMedia, resolveMetadataTypeToMediaType } from './noteTypeSettings';
import { PropertyMappingOption } from '../settings/PropertyMapping';
import type { CreateNoteOptions } from './Utils';
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
} from './Utils';

export type Metadata = Record<string, unknown>;

export class NoteManager {
	private plugin: MediaDbPlugin;
	private app: App;

	constructor(plugin: MediaDbPlugin) {
		this.plugin = plugin;
		this.app = plugin.app;
	}

	get settings() {
		return this.plugin.settings;
	}

	frontMatterRexExpPattern: string = '^(---)\\n[\\s\\S]*?\\n---';

	async createMediaDbNotes(models: MediaTypeModel[], attachFile?: TFile): Promise<void> {
		const hasArtist = models.some(m => m.getMediaType() === MediaType.Artist);

		if (hasArtist) {
			for (const model of models) {
				await this.createMediaDbNoteFromModel(model, { attachTemplate: true, attachFile: attachFile });
			}
			return;
		}

		const results = await Promise.allSettled(models.map(model => this.createMediaDbNoteFromModel(model, { attachTemplate: true, attachFile: attachFile })));

		const failures = results.filter(r => r.status === 'rejected');
		if (failures.length > 0) {
			console.warn('MDB | Some notes failed to create:', failures);
			new Notice(`${models.length - failures.length} of ${models.length} notes created successfully.`);
		}
	}

	async queryDetails(models: MediaTypeModel[]): Promise<MediaTypeModel[]> {
		// Query details in parallel for better performance
		const results = await Promise.allSettled(models.map(model => this.plugin.apiManager.queryDetailedInfo(model)));

		// Filter out failures and return successful results
		const detailModels: MediaTypeModel[] = results
			.filter((r): r is PromiseFulfilledResult<MediaTypeModel | undefined> => r.status === 'fulfilled' && r.value !== undefined)
			.map(r => r.value!);

		// Log failures for debugging
		const failures = results.filter(r => r.status === 'rejected');
		if (failures.length > 0) {
			console.warn('MDB | Some detail queries failed:', failures);
		}

		return detailModels;
	}

	async createMediaDbNoteFromModel(mediaTypeModel: MediaTypeModel, options: CreateNoteOptions): Promise<void> {
		if (mediaTypeModel.getMediaType() === MediaType.Book && mediaTypeModel instanceof BookModel) {
			mediaTypeModel = await this.plugin.metadataAggregator.hydrateBook(mediaTypeModel);
		}

		if (mediaTypeModel.getMediaType() === MediaType.Artist) {
			await this.importArtistDiscography(mediaTypeModel as ArtistModel, options);
			return;
		}

		await this.createStandardMediaDbNoteFromModel(mediaTypeModel, options);
	}

	async createStandardMediaDbNoteFromModel(mediaTypeModel: MediaTypeModel, options: CreateNoteOptions): Promise<boolean> {
		try {
			console.debug('MDB | creating new note');

			options.openNote ??= this.settings.openNoteInNewTab;

			// Handle rename logic if attachFile path has changed
			options.folder ??= await this.plugin.mediaTypeManager.getFolder(mediaTypeModel, this.app);
			const newFileName = replaceIllegalFileNameCharactersInString(this.plugin.mediaTypeManager.getFileName(mediaTypeModel));
			const newPath = normalizePath(`${options.folder.path}/${newFileName}.md`);

			if (options.attachFile && options.attachFile.path !== newPath) {
				console.log(`MDB | Renaming note: ${options.attachFile.path} -> ${newPath}`);
				await this.handleLocalImageCleanAndReplaceOnRename(options.attachFile, mediaTypeModel);
				await this.app.fileManager.renameFile(options.attachFile, newPath);

				// Bypass overwrite prompt since we are updating the renamed file
				options.overwrite = true;
			}

			let imageLocked = false;
			const mediaType = mediaTypeModel.getMediaType();
			if (options.attachFile && this.isImageUpdateLocked(mediaType)) {
				imageLocked = true;
				const attachFileMetadata = this.getMetadataFromFileCache(options.attachFile);
				const imageKey = this.getImageKey(mediaType);
				if (imageKey && imageKey in attachFileMetadata) {
					mediaTypeModel.image = String(attachFileMetadata[imageKey]);
				}
			}

			if (this.settings.imageDownload && !imageLocked) {
				await this.downloadImageForMediaModel(mediaTypeModel);
			}

			const fileContent = await this.generateMediaDbNoteContents(mediaTypeModel, options);

			const targetFile = await this.createNote(this.plugin.mediaTypeManager.getFileName(mediaTypeModel), fileContent, options);

			if (this.settings.enableTemplaterIntegration) {
				try {
					await useTemplaterPluginInFile(this.app, targetFile);
				} catch (e) {
					console.warn(e);
					new Notice(`${e}`);
				}
			}
			return true;
		} catch (e) {
			console.warn(e);
			new Notice(`${e}`);
			return false;
		}
	}

	safeFileTreeSegment(title: string): string {
		return replaceIllegalFileNameCharactersInString(title).replaceAll(/ +/g, ' ').trim();
	}

	async ensureVaultFolder(folderPath: string): Promise<TFolder> {
		const normalized = normalizePath(folderPath);
		if (!(await this.app.vault.adapter.exists(normalized))) {
			await this.app.vault.createFolder(normalized);
		}
		const folder = this.app.vault.getAbstractFileByPath(normalized);
		if (!(folder instanceof TFolder)) {
			throw new Error(`MDB | Expected folder at ${normalized}`);
		}
		return folder;
	}

	async importSongNotesForMusicReleaseTracks(
		release: MusicReleaseModel,
		geniusSearchArtist: string,
		musicBrainzApi: MusicBrainzAPI,
		genius: GeniusClient,
		spotify: SpotifyClient,
		childOptions: CreateNoteOptions,
		useTree: boolean,
		songNotesFolder: TFolder | undefined,
	): Promise<void> {
		for (const track of release.tracks) {
			let lyrics = '';
			let geniusUrl = '';
			if (genius.isConfigured()) {
				await new Promise(r => setTimeout(r, 500));
				const hit = await genius.searchFirstSongHit(`${geniusSearchArtist} ${track.title}`);
				if (hit) {
					geniusUrl = hit.url;
					await new Promise(r => setTimeout(r, 600));
					lyrics = await genius.fetchLyricsFromSongPage(hit.url);
				}
			}

			let spotifyUrl = '';
			if (track.recordingId) {
				await new Promise(r => setTimeout(r, 1100));
				try {
					spotifyUrl = await musicBrainzApi.fetchSpotifyUrlForRecording(track.recordingId);
				} catch (e) {
					console.warn(`MDB | Spotify URL for recording ${track.recordingId}:`, e);
				}
			}
			if (!spotifyUrl && spotify.isConfigured()) {
				const primaryArtist = release.artists[0] ?? geniusSearchArtist;
				console.log(`MDB | Spotify API fallback for track "${track.title}" (artist: ${primaryArtist})`);
				try {
					spotifyUrl = await spotify.searchFirstTrackUrl(track.title, primaryArtist);
				} catch (e) {
					console.warn(`MDB | Spotify search for "${track.title}":`, e);
				}
			}

			const song = new SongModel({
				type: 'song',
				title: track.title,
				englishTitle: track.title,
				year: release.year,
				releaseDate: release.releaseDate,
				dataSource: MUSICBRAINZ_NOTE_DATA_SOURCE,
				url: geniusUrl || release.url,
				id: `${release.id}-t${track.number}`,
				image: release.image,
				subType: 'song',
				genres: release.genres ?? [],
				artists: release.artists.length > 0 ? release.artists : [geniusSearchArtist],
				albumTitle: release.title,
				albumReleaseGroupId: release.id,
				trackNumber: track.number,
				duration: track.duration,
				featuredArtists: track.featuredArtists,
				geniusUrl,
				spotifyUrl,
				lyrics,
				userData: { personalRating: 0 },
			});

			const songOpts: CreateNoteOptions = useTree && songNotesFolder ? { ...childOptions, folder: songNotesFolder } : { ...childOptions };

			await this.createStandardMediaDbNoteFromModel(song, songOpts);
		}
	}

	async importMusicReleaseWithOptionalSongs(release: MusicReleaseModel, options: CreateNoteOptions): Promise<void> {
		try {
			const albumNotesFolder = options.folder ?? (await this.plugin.mediaTypeManager.getFolder(release, this.app));
			const useTree = this.settings.artistUseFileTreeForSongs;
			const importSongs = this.settings.musicReleaseAutomaticallyImportSongs;

			let songNotesFolder: TFolder | undefined;
			if (useTree && importSongs) {
				const albumSeg = this.safeFileTreeSegment(release.title);
				songNotesFolder = await this.ensureVaultFolder(normalizePath(`${albumNotesFolder.path}/${albumSeg}`));
			}

			const albumCreated = await this.createStandardMediaDbNoteFromModel(release, { ...options, folder: albumNotesFolder });
			if (!albumCreated) {
				return;
			}

			if (!importSongs || release.tracks.length === 0) {
				return;
			}

			const musicBrainzApi = this.plugin.apiManager.getApiByName('MusicBrainz API') as MusicBrainzAPI | undefined;
			if (!musicBrainzApi) {
				new Notice('MusicBrainz API not available; song notes were skipped.');
				console.warn('MusicBrainz API not available; song notes were skipped.');
				return;
			}

			const geniusToken = getApiSecretValue(this.app, this.settings.linkedApiSecretIds, ApiSecretID.genius) || undefined;
			const genius = new GeniusClient(geniusToken);
			if (!genius.isConfigured()) {
				new Notice('Album import: Genius token not found! Add a Genius API access token in settings to fetch lyrics.');
				console.warn('Album import: Genius token not found! Add a Genius API access token in settings to fetch lyrics.');
			}

			const spotifyClientId = getApiSecretValue(this.app, this.settings.linkedApiSecretIds, ApiSecretID.spotifyClientId) || undefined;
			const spotifyClientSecret = getApiSecretValue(this.app, this.settings.linkedApiSecretIds, ApiSecretID.spotifyClientSecret) || undefined;
			const spotify = new SpotifyClient(spotifyClientId, spotifyClientSecret);

			const geniusSearchArtist = release.artists[0] ?? release.title;
			const childOptions: CreateNoteOptions = {
				attachTemplate: true,
				openNote: false,
				attachFile: undefined,
				folder: undefined,
			};

			new Notice(`Importing ${release.tracks.length} tracks for ${release.title}…`);
			console.log(`Importing ${release.tracks.length} tracks for ${release.title}…`);

			await this.importSongNotesForMusicReleaseTracks(release, geniusSearchArtist, musicBrainzApi, genius, spotify, childOptions, useTree, songNotesFolder);
		} catch (e) {
			console.warn(e);
			new Notice(`${e}`);
		}
	}

	async importArtistDiscography(artist: ArtistModel, options: CreateNoteOptions): Promise<void> {
		try {
			const useTree = this.settings.artistUseFileTreeForSongs;
			const childOptions: CreateNoteOptions = {
				attachTemplate: true,
				openNote: false,
				attachFile: undefined,
				folder: undefined,
			};

			const artistBaseFolder = await this.plugin.mediaTypeManager.getFolder(artist, this.app);
			const artistNoteFolder = artistBaseFolder;
			let albumNotesFolder = artistBaseFolder;

			if (useTree) {
				const artistSeg = this.safeFileTreeSegment(artist.title);
				const treeRootPath = normalizePath(`${artistBaseFolder.path}/${artistSeg}`);
				albumNotesFolder = await this.ensureVaultFolder(treeRootPath);
			}

			const artistNoteCreated = await this.createStandardMediaDbNoteFromModel(artist, { ...options, folder: artistNoteFolder });
			if (!artistNoteCreated) {
				return;
			}

			if (!this.settings.artistAutomaticallyImportReleases) {
				new Notice(`✅ Finished artist import for ${artist.title}.`);
				console.log(`✅ Finished artist import for ${artist.title}.`);
				return;
			}

			const geniusToken = getApiSecretValue(this.app, this.settings.linkedApiSecretIds, ApiSecretID.genius) || undefined;
			const genius = new GeniusClient(geniusToken);
			if (!genius.isConfigured()) {
				new Notice('Artist import: Genius token not found! Add a Genius API access token in settings to fetch lyrics.');
				console.warn('Artist import: Genius token not found! Add a Genius API access token in settings to fetch lyrics.');
			}

			const spotifyClientId = getApiSecretValue(this.app, this.settings.linkedApiSecretIds, ApiSecretID.spotifyClientId) || undefined;
			const spotifyClientSecret = getApiSecretValue(this.app, this.settings.linkedApiSecretIds, ApiSecretID.spotifyClientSecret) || undefined;
			const spotify = new SpotifyClient(spotifyClientId, spotifyClientSecret);

			const artistApi = this.plugin.apiManager.getApiByName('MusicBrainz Artist API') as MusicBrainzArtistAPI | undefined;
			const musicBrainzApi = this.plugin.apiManager.getApiByName('MusicBrainz API') as MusicBrainzAPI | undefined;
			if (!artistApi || !musicBrainzApi) {
				new Notice('MusicBrainz APIs not available.');
				console.warn('MusicBrainz APIs not available.');
				return;
			}

			let releaseGroupIds: string[];
			try {
				releaseGroupIds = await artistApi.listStudioAlbumReleaseGroupIds(artist.id);
			} catch (e) {
				new Notice(`Could not load albums: ${e}`);
				console.log(`Could not load albums: ${e}`);
				return;
			}

			const importSongs = this.settings.musicReleaseAutomaticallyImportSongs;
			new Notice(`Importing ${releaseGroupIds.length} studio albums${importSongs ? ' and tracks' : ''} for ${artist.title}…`);
			console.log(`Importing ${releaseGroupIds.length} studio albums${importSongs ? ' and tracks' : ''} for ${artist.title}…`);

			for (const rgId of releaseGroupIds) {
				await new Promise(r => setTimeout(r, 1100));
				let release: MusicReleaseModel;
				try {
					const model = await musicBrainzApi.getById(rgId);
					release = model as MusicReleaseModel;
				} catch (e) {
					console.warn(`MDB | Skipping release group ${rgId}:`, e);
					continue;
				}

				let songNotesFolder: TFolder | undefined;
				if (useTree && importSongs) {
					const albumSeg = this.safeFileTreeSegment(release.title);
					songNotesFolder = await this.ensureVaultFolder(normalizePath(`${albumNotesFolder.path}/${albumSeg}`));
				}

				const releaseOpts: CreateNoteOptions = useTree ? { ...childOptions, folder: albumNotesFolder } : { ...childOptions };

				const albumNoteCreated = await this.createStandardMediaDbNoteFromModel(release, releaseOpts);
				if (!albumNoteCreated) {
					continue;
				}

				if (!importSongs) {
					continue;
				}

				await this.importSongNotesForMusicReleaseTracks(release, artist.title, musicBrainzApi, genius, spotify, childOptions, useTree, songNotesFolder);
			}

			new Notice(`✅ Finished artist import for ${artist.title}.`);
			console.log(`✅ Finished artist import for ${artist.title}.`);
		} catch (e) {
			console.warn(e);
			new Notice(`${e}`);
		}
	}

	private getCachePath(): string {
		return normalizePath(`${this.app.vault.configDir}/plugins/obsidian-media-db-plugin/image-cache.json`);
	}

	private getHeader(headers: Record<string, string> | undefined, name: string): string | undefined {
		if (!headers) return undefined;
		const lowerName = name.toLowerCase();
		for (const key of Object.keys(headers)) {
			if (key.toLowerCase() === lowerName) {
				return headers[key];
			}
		}
		return undefined;
	}

	private async loadImageCache(): Promise<Record<string, { url: string; etag: string; size: number }>> {
		const cachePath = this.getCachePath();
		try {
			if (await this.app.vault.adapter.exists(cachePath)) {
				const raw = await this.app.vault.adapter.read(cachePath);
				return JSON.parse(raw);
			}
		} catch (e) {
			console.warn('MDB | Failed to read image cache:', e);
		}
		return {};
	}

	private async saveImageCache(cache: Record<string, { url: string; etag: string; size: number }>): Promise<void> {
		const cachePath = this.getCachePath();
		try {
			const dir = cachePath.split('/').slice(0, -1).join('/');
			if (dir && !(await this.app.vault.adapter.exists(dir))) {
				await this.app.vault.adapter.mkdir(dir);
			}
			await this.app.vault.adapter.write(cachePath, JSON.stringify(cache, null, 2));
		} catch (e) {
			console.warn('MDB | Failed to write image cache:', e);
		}
	}

	async removeImageFromCache(filePath: string): Promise<void> {
		const cache = await this.loadImageCache();
		if (cache[filePath] !== undefined) {
			delete cache[filePath];
			await this.saveImageCache(cache);
			console.log(`MDB | Removed deleted image from cache: ${filePath}`);
		}
	}

	private async handleLocalImageCleanAndReplaceOnRename(attachFile: TFile, mediaTypeModel: MediaTypeModel): Promise<void> {
		if (!this.settings.imageDownload) {
			return;
		}
		const metadata = this.getMetadataFromFileCache(attachFile);
		const mediaTypeVal = metadata.type ?? noteTypeValueForMedia(this.settings, mediaTypeModel.getMediaType());
		const internalMediaType = resolveMetadataTypeToMediaType(this.plugin.settings, mediaTypeVal);
		if (internalMediaType && this.isImageUpdateLocked(internalMediaType)) {
			return;
		}

		const oldImageLink = metadata.image;

		if (typeof oldImageLink === 'string' && oldImageLink.startsWith('[[') && oldImageLink.endsWith(']]')) {
			const cleanPath = oldImageLink.replace(/^\[\[(.*?)\]\]$/, '$1').trim();
			const resolvedPath = normalizePath(cleanPath);

			// Check if the old image path is the same as the new one
			const imageUrl = mediaTypeModel.image;
			if (imageUrl && typeof imageUrl === 'string' && imageUrl.startsWith('http')) {
				const imageExt = imageUrl.split('.').pop()?.split(/#|\?/)[0] ?? 'jpg';
				const imageFileName = `${replaceIllegalFileNameCharactersInString(`${mediaTypeModel.type}_${mediaTypeModel.title} (${mediaTypeModel.year})`)}.${imageExt}`;
				const newImagePath = normalizePath(`${this.settings.imageFolder}/${imageFileName}`);

				if (resolvedPath === newImagePath) {
					console.log(`MDB | Image path is the same (${resolvedPath}). Skipping deletion.`);
					return;
				}
			}

			const oldImageFile = this.app.vault.getAbstractFileByPath(resolvedPath);
			if (oldImageFile instanceof TFile) {
				console.log(`MDB | Deleting old local image: ${oldImageFile.path}`);
				try {
					await this.app.vault.delete(oldImageFile);

					const cache = await this.loadImageCache();
					delete cache[oldImageFile.path];
					await this.saveImageCache(cache);
				} catch (e) {
					console.warn('MDB | Failed to delete old image file:', e);
				}
			}
		}
	}

	async downloadImageForMediaModel(mediaTypeModel: MediaTypeModel): Promise<boolean> {
		if (mediaTypeModel.image === 'placeholder:nsfw') {
			try {
				const imageFileName = 'nsfw-placeholder.svg';
				const imagePath = normalizePath(`${this.settings.imageFolder}/${imageFileName}`);

				await this.ensureVaultFolder(this.settings.imageFolder);

				const imageFileExists = await this.app.vault.adapter.exists(imagePath);
				if (!imageFileExists) {
					const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400" width="300" height="400">
  <defs>
    <!-- Koyu arka plan gradyanı -->
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e1e24"/>
      <stop offset="100%" stop-color="#121214"/>
    </linearGradient>
    <!-- Güçlü bir blur (bulanıklaştırma) filtresi -->
    <filter id="glowBlur">
      <feGaussianBlur stdDeviation="35" />
    </filter>
  </defs>
  
  <!-- Temel Koyu Arka Plan -->
  <rect width="100%" height="100%" fill="url(#bg)"/>
  
  <!-- Blur uygulanan renkli yuvarlaklar (Ambient Glow efekti) -->
  <g filter="url(#glowBlur)" opacity="0.5">
    <circle cx="90" cy="130" r="90" fill="#e06c75"/>
    <circle cx="210" cy="270" r="100" fill="#c678dd"/>
  </g>
  
  <!-- Üstüne hafif koyulaştırıcı cam katman -->
  <rect width="100%" height="100%" fill="#000" opacity="0.35"/>
  
  <!-- Ön Plandaki Net Yazılar ve İkon -->
  <text x="50%" y="46%" dominant-baseline="middle" text-anchor="middle" font-family="system-ui, sans-serif" font-size="28" fill="#fff" opacity="0.95">&#128274;</text>
  <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="system-ui, sans-serif" font-size="20" font-weight="600" fill="#fff" opacity="0.95" letter-spacing="1">NSFW</text>
  <text x="50%" y="60%" dominant-baseline="middle" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" fill="#abb2bf" opacity="0.7">Filtered Content</text>
</svg>`;
					await this.app.vault.create(imagePath, svgContent);
				}

				mediaTypeModel.image = `[[${imagePath}]]`;
				return true;
			} catch (e) {
				console.warn('MDB | Failed to create local NSFW placeholder:', e);
			}
		}

		if (mediaTypeModel.image && typeof mediaTypeModel.image === 'string' && mediaTypeModel.image.startsWith('http')) {
			try {
				const imageUrl = mediaTypeModel.image;
				const imageExt = imageUrl.split('.').pop()?.split(/#|\?/)[0] ?? 'jpg';
				const imageFileName = `${replaceIllegalFileNameCharactersInString(`${mediaTypeModel.type}_${mediaTypeModel.title} (${mediaTypeModel.year})`)}.${imageExt}`;
				const imagePath = normalizePath(`${this.settings.imageFolder}/${imageFileName}`);

				await this.ensureVaultFolder(this.settings.imageFolder);

				const imageFileExists = await this.app.vault.adapter.exists(imagePath);
				let shouldDownload = !imageFileExists;

				if (imageFileExists) {
					try {
						const headResponse = await requestUrl({ url: imageUrl, method: 'HEAD' });
						const serverSize = parseInt(this.getHeader(headResponse.headers, 'content-length') ?? '0', 10);
						const serverEtag = this.getHeader(headResponse.headers, 'etag') ?? '';

						const cache = await this.loadImageCache();
						const cached = cache[imagePath];

						const sizeMismatch = serverSize > 0 && cached && cached.size !== serverSize;
						const etagMismatch = serverEtag && cached && cached.etag !== serverEtag;
						const urlMismatch = cached && cached.url !== imageUrl;

						if (!cached || urlMismatch || sizeMismatch || etagMismatch) {
							console.log(`MDB | Image update detected for ${imagePath}. Re-downloading cover.`);
							new Notice(`MDB | Cover image update detected for ${mediaTypeModel.title}.`);
							shouldDownload = true;

							const oldImageFile = this.app.vault.getAbstractFileByPath(imagePath);
							if (oldImageFile instanceof TFile) {
								await this.app.vault.delete(oldImageFile);
							}
						}
					} catch (headErr) {
						console.warn('MDB | HEAD request failed, skipping check:', headErr);
					}
				}

				if (shouldDownload) {
					const response = await requestUrl({ url: imageUrl, method: 'GET' });
					await this.app.vault.createBinary(imagePath, response.arrayBuffer);

					const contentLengthHeader = this.getHeader(response.headers, 'content-length');
					const serverSize = contentLengthHeader ? parseInt(contentLengthHeader, 10) : response.arrayBuffer.byteLength;
					const serverEtag = this.getHeader(response.headers, 'etag') ?? '';

					const cache = await this.loadImageCache();
					cache[imagePath] = { url: imageUrl, etag: serverEtag, size: serverSize };
					await this.saveImageCache(cache);
				}

				mediaTypeModel.image = `[[${imagePath}]]`;
				return true;
			} catch (e) {
				console.warn('MDB | Failed to download image:', e);
			}
		}

		return false;
	}

	async downloadImagesInFolder(folder: TFolder): Promise<void> {
		new Notice(`MDB | Scanning for images to download in ${folder.name}...`);
		const files = folder.children.filter((c): c is TFile => c instanceof TFile && c.extension === 'md');
		const startTime = Date.now();
		let downloaded = 0;
		let failed = 0;
		const erroredFiles: { filePath: string; error: string }[] = [];

		let progress = new Notice('', 0);
		let pi = 0;
		try {
			for (const file of files) {
				// @ts-ignore
				if (progress.noticeEl && !activeDocument.body.contains(progress.noticeEl)) progress = new Notice('', 0);

				const pct = Math.round((pi / (files.length || 1)) * 100);
				progress.setMessage(`MDB | Downloading: ${pi + 1}/${files.length} (${pct}%) — ${file.basename}`);
				const result = await this.downloadImagesInFile(file, true);
				if (result.success) {
					downloaded++;
				} else if (!result.skipped) {
					failed++;
					if (result.error) erroredFiles.push({ filePath: file.path, error: result.error });
				}
				// wait slightly as anti-rate limit
				if (!result.skipped) {
					await new Promise(r => setTimeout(r, 600));
				}
				pi++;
			}
		} finally {
			progress.hide();
		}

		if (failed > 0 && erroredFiles.length > 0) {
			const title = `MDB - image download error report ${dateTimeToString(new Date())}`;
			const filePath = `${title}.md`;
			const table = [['file', 'error']].concat(erroredFiles.map(x => [x.filePath, x.error]));
			const fileContent = markdownTable(table);
			await this.app.vault.create(filePath, fileContent);
		}

		new CompletionModal(this.app, {
			title: 'Image Download Complete',
			icon: '🖼️',
			total: downloaded + failed,
			success: downloaded,
			errors: failed,
			elapsedMs: Date.now() - startTime,
			notes: failed > 0 ? ['Some images could not be downloaded. A detailed report file has been created in your vault folder.'] : [],
		}).open();
	}

	async downloadImagesInFile(file: TFile, silent: boolean = false): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
		const metadata = this.getMetadataFromFileCache(file);
		if (typeof metadata.image === 'string' && metadata.image.startsWith('http')) {
			try {
				const imageUrl = metadata.image;
				const extMatch = /\.([a-zA-Z0-9]+)$/.exec(imageUrl.split('?')[0]);
				const ext = extMatch ? extMatch[1] : 'jpg';
				const imgName = replaceIllegalFileNameCharactersInString(file.basename) + '.' + ext;
				const imgFolder = await this.ensureVaultFolder(this.settings.imageFolder);
				const imagePath = `${imgFolder.path}/${imgName}`;

				if (!this.app.vault.getAbstractFileByPath(imagePath)) {
					const response = await requestUrl({ url: imageUrl, method: 'GET' });
					await this.app.vault.createBinary(imagePath, response.arrayBuffer);
				}

				const localImageLink = `[[${imagePath}]]`;
				let fileContent = await this.app.vault.read(file);
				if (fileContent.includes(imageUrl)) {
					fileContent = fileContent.replaceAll(imageUrl, localImageLink);
					await this.app.vault.modify(file, fileContent);
				} else {
					await this.app.fileManager.processFrontMatter(file, (frontmatter: any) => {
						frontmatter.image = localImageLink;
					});
				}
				if (!silent) new Notice(`MDB | Image downloaded for ${file.basename}`);
				return { success: true };
			} catch (e) {
				console.error('MDB | Image download failed for', file.path, e);
				if (!silent) new Notice(`MDB | Image download failed for ${file.basename}`);
				return { success: false, error: `${e}` };
			}
		}
		if (!silent) new Notice(`MDB | No external image found in ${file.basename}`);
		return { success: false, skipped: true };
	}

	metadataRecordForNewNote(mediaTypeModel: MediaTypeModel): Record<string, unknown> {
		let meta: Record<string, unknown>;
		if (this.settings.useDefaultFrontMatter) {
			meta = mediaTypeModel.toMetaDataObject();
		} else {
			meta = {
				id: mediaTypeModel.id,
				type: mediaTypeModel.type,
				dataSource: mediaTypeModel.dataSource,
			};
		}
		meta = this.withMovieCurrencyObjectFormat(meta, mediaTypeModel);
		meta = this.withSanitizedColonStrings(meta);
		return this.withNormalizedTitleAliasMetadata(meta, mediaTypeModel.title);
	}

	withSanitizedColonStrings(meta: Record<string, unknown>): Record<string, unknown> {
		const next = { ...meta };
		for (const key of Object.keys(next)) {
			const val = next[key];
			if (typeof val === 'string') {
				// Don't format URLs or similar links
				if (val.startsWith('http://') || val.startsWith('https://')) continue;
				next[key] = val.replace(new RegExp(':(?=[^\\s/\\\\])', 'g'), ': ');
			}
		}
		return next;
	}

	withMovieCurrencyObjectFormat(meta: Record<string, unknown>, mediaTypeModel: MediaTypeModel): Record<string, unknown> {
		if (!this.settings.useObjectFormatForCurrencyValues || mediaTypeModel.getMediaType() !== MediaType.Movie) {
			return meta;
		}
		const next = { ...meta };
		for (const key of ['budget', 'revenue'] as const) {
			const raw = next[key];
			if (typeof raw !== 'string') {
				continue;
			}
			const amount = parseUsdWholeDollarsFromDisplayString(raw);
			next[key] = amount !== null ? { value: amount, currency: 'USD' } : null;
		}
		return next;
	}

	withNormalizedTitleAliasMetadata(meta: Record<string, unknown>, title: string): Record<string, unknown> {
		if (!this.settings.addNormalizeTitlesAsAlias) {
			return meta;
		}
		const alias = normalizeTitleForAsciiAlias(title);
		if (alias === null) {
			return meta;
		}
		const prev = meta.aliases;
		if (Array.isArray(prev)) {
			if (!prev.includes(alias)) {
				meta.aliases = [...prev, alias];
			}
		} else if (typeof prev === 'string') {
			meta.aliases = prev === alias ? [prev] : [prev, alias];
		} else {
			meta.aliases = [alias];
		}
		return meta;
	}

	generateMediaDbNoteFrontmatterPreview(mediaTypeModel: MediaTypeModel): string {
		mediaTypeModel.type = noteTypeValueForMedia(this.settings, mediaTypeModel.getMediaType());
		const fileMetadata = this.plugin.modelPropertyMapper.convertObject(this.metadataRecordForNewNote(mediaTypeModel));
		return stringifyYaml(fileMetadata);
	}

	async generateMediaDbNoteContents(mediaTypeModel: MediaTypeModel, options: CreateNoteOptions): Promise<string> {
		mediaTypeModel.type = noteTypeValueForMedia(this.settings, mediaTypeModel.getMediaType());

		let template = await this.plugin.mediaTypeManager.getTemplate(mediaTypeModel, this.app);
		const originalTemplateText = template;
		let fileMetadata: Record<string, unknown> = this.plugin.modelPropertyMapper.convertObject(this.metadataRecordForNewNote(mediaTypeModel));

		let fileContent = '';
		template = options.attachTemplate ? template : '';

		const regExp = new RegExp(this.frontMatterRexExpPattern);
		const renderedTemplateBody = originalTemplateText.replace(regExp, '').replace(/^\n/, '');

		({ fileMetadata, fileContent } = await this.attachFile(
			fileMetadata,
			fileContent,
			options.attachFile,
			options.preservePropertyOrder,
			originalTemplateText,
			options.updateBody,
			renderedTemplateBody,
			options.ignoredSections,
		));
		({ fileMetadata, fileContent } = await this.attachTemplate(fileMetadata, fileContent, template));

		// --- Global Wiki-Link Post-Processing (for Custom/Manual Properties) ---
		const entityWikiProps = this.settings.autoTagEntities
			.split(',')
			.map(s => s.trim().toLowerCase())
			.filter(s => s !== '');
		if (entityWikiProps.length > 0) {
			const folderPrefix = this.settings.wikiFolder ? `${this.settings.wikiFolder}/` : '';
			const isEnabled = this.settings.enableWikiLinkParsing;
			const formatWiki = (v: unknown) => {
				if (typeof v !== 'string') return v;
				const isAlreadyWiki = v.startsWith('[[') && v.endsWith(']]');
				let clean = v.replace(/^\[\[(.*?)\]\]$/, '$1');

				if (isAlreadyWiki && clean.includes('|')) {
					clean = clean.split('|')[1];
				}

				if (!isEnabled) {
					return clean.trim();
				}

				const safeFilePath = clean.trim().replace(/[\\/:"*?<>|]/g, '-');
				return `[[${folderPrefix}${safeFilePath}]]`;
			};

			for (const [key, value] of Object.entries(fileMetadata)) {
				if (key === 'aliases') continue;
				if (entityWikiProps.includes(key.toLowerCase())) {
					if (typeof value === 'string') {
						fileMetadata[key] = formatWiki(value);
					} else if (Array.isArray(value)) {
						fileMetadata[key] = value.map(formatWiki);
					}
				}
			}
		}

		// --- Per-Property Auto-Tag Logic ---
		const autoTagEntries = this.plugin.modelPropertyMapper.getAutoTagKeys(mediaTypeModel.type);
		if (autoTagEntries.length > 0) {
			const existingTags: string[] = Array.isArray(fileMetadata.tags) ? (fileMetadata.tags as string[]) : [];
			const newTags = new Set<string>(existingTags.filter(t => typeof t === 'string' && t.trim() !== ''));

			for (const [key, value] of Object.entries(fileMetadata)) {
				const entry = autoTagEntries.find(e => e.key.toLowerCase() === key.toLowerCase());
				if (entry && value) {
					const prefix = entry.prefix.trim().replace(/\/$/, ''); // strip trailing slash
					const valuesToTag = Array.isArray(value) ? value : [value];
					for (let v of valuesToTag) {
						if (typeof v === 'string') {
							v = String(v).replace(/^\[\[(.*?)\]\]$/, '$1');
							if (v.includes('|')) {
								v = v.split('|')[1];
							}
							const sanitized = v
								.trim()
								.replace(/\s+/g, '-')
								.replace(/[^\wığüşöçIĞÜŞÖÇ/-]/g, '')
								.toLowerCase();

							if (sanitized) newTags.add(prefix ? `${prefix}/${sanitized}` : sanitized);
						}
					}
				}
			}

			if (newTags.size > 0) {
				fileMetadata.tags = Array.from(newTags);
			}
		}

		if (mediaTypeModel.getMediaType() === MediaType.Song) {
			const song = mediaTypeModel as SongModel;
			if (song.lyrics.length > 0) {
				fileContent += `# Lyrics\n\`\`\`\n${song.lyrics}\n\`\`\`\n`;
			}
		}

		// Ensure 'pinBottom' properties (including 'tags' if pinned) appear at the absolute bottom
		// This guarantees they are listed chronologically below template properties.
		const pinnedKeys = this.plugin.modelPropertyMapper.getPinnedBottomKeys(mediaTypeModel.type);
		for (const key of pinnedKeys) {
			if (key in fileMetadata) {
				const val = fileMetadata[key];
				delete fileMetadata[key];
				if (val !== null && val !== undefined) {
					fileMetadata[key] = val;
				}
			}
		}

		if (this.settings.enableTemplaterIntegration && hasTemplaterPlugin(this.app)) {
			// Include the media variable in all templater commands by using a top level JavaScript execution command.
			const mediaJson = JSON.stringify(mediaTypeModel, (key, value: unknown) => (key === 'lyrics' ? undefined : value));
			fileContent = `---\n<%* const media = ${mediaJson} %>\n${stringifyYaml(fileMetadata)}---\n${fileContent}`;
		} else {
			fileContent = `---\n${stringifyYaml(fileMetadata)}---\n${fileContent}`;
		}

		return fileContent;
	}

	extractManualTags(metadata: Record<string, unknown>, autoTagEntries: { key: string; prefix: string }[]): string[] {
		const allTagsRaw = metadata.tags;
		const allTags = Array.isArray(allTagsRaw) ? allTagsRaw : typeof allTagsRaw === 'string' ? [allTagsRaw] : [];
		if (allTags.length === 0) return [];

		const autoTagValues = new Set<string>();

		for (const [key, value] of Object.entries(metadata)) {
			const entry = autoTagEntries.find(e => e.key.toLowerCase() === key.toLowerCase());
			if (entry && value) {
				const prefix = entry.prefix.trim().replace(/\/$/, '');
				const valuesToTag = Array.isArray(value) ? value : [value];
				for (const v of valuesToTag) {
					if (typeof v === 'string') {
						let clean = v.replace(/^\[\[(.*?)\]\]$/, '$1');
						if (clean.includes('|')) clean = clean.split('|')[1];
						const sanitized = clean
							.trim()
							.replace(/\s+/g, '-')
							.replace(/[^\wığüşöçIĞÜŞÖÇ/-]/g, '')
							.toLowerCase();
						if (sanitized) autoTagValues.add(prefix ? `${prefix}/${sanitized}` : sanitized);
					}
				}
			}
		}

		return allTags.map(t => String(t).trim()).filter(t => t && !autoTagValues.has(t.toLowerCase()) && !t.toLowerCase().startsWith('mediadb/'));
	}

	async attachFile(
		fileMetadata: Metadata,
		fileContent: string,
		fileToAttach?: TFile,
		preservePropertyOrder?: boolean,
		templateStr?: string,
		updateBody?: boolean,
		renderedTemplateBody?: string,
		ignoredSections?: string[],
	): Promise<{ fileMetadata: Metadata; fileContent: string }> {
		if (!fileToAttach) {
			return { fileMetadata: fileMetadata, fileContent: fileContent };
		}

		const attachFileMetadata = this.getMetadataFromFileCache(fileToAttach);

		const mediaTypeVal = attachFileMetadata.type ?? fileMetadata.type;
		const internalMediaType = resolveMetadataTypeToMediaType(this.plugin.settings, mediaTypeVal);
		if (internalMediaType && this.isImageUpdateLocked(internalMediaType)) {
			const imageKey = this.getImageKey(internalMediaType);
			if (imageKey && imageKey in attachFileMetadata) {
				fileMetadata[imageKey] = attachFileMetadata[imageKey];
			}
		}

		// Rescue arrays that Object.assign would normally crush
		const rescueArray = (key: string) => {
			const arr = attachFileMetadata[key];
			if (Array.isArray(arr)) return [...(arr as string[])];
			if (typeof arr === 'string' && arr.trim()) return [arr];
			return [];
		};
		const mediaType = attachFileMetadata.type ?? fileMetadata.type;
		const autoTagEntries = this.plugin.modelPropertyMapper.getAutoTagKeys(mediaType);
		const oldManualTags = this.extractManualTags(attachFileMetadata, autoTagEntries);
		const oldAliases = rescueArray('aliases');

		if (preservePropertyOrder) {
			// Messy legacy behavior: old attachFileMetadata acts as the base, preserving its currently unordered key layout
			fileMetadata = Object.assign(attachFileMetadata, fileMetadata);
		} else {
			// Enforce strict property order from the new mapping
			const orderedMetadata: Record<string, unknown> = {};
			for (const key of Object.keys(fileMetadata)) {
				orderedMetadata[key] = fileMetadata[key];
			}

			// Smart Sort: extract predefined order from template (if available)
			let templateMetadata: Record<string, unknown> = {};
			const templateKeys: string[] = [];
			if (templateStr) {
				templateMetadata = this.getMetaDataFromFileContent(templateStr);
				templateKeys.push(...Object.keys(templateMetadata));
			}

			// Add properties matching the template order first
			for (const tKey of templateKeys) {
				if (tKey in attachFileMetadata && !(tKey in orderedMetadata)) {
					orderedMetadata[tKey] = attachFileMetadata[tKey];
				} else if (!(tKey in attachFileMetadata) && !(tKey in orderedMetadata)) {
					orderedMetadata[tKey] = templateMetadata[tKey];
				}
			}

			// Then add any remaining unexpected properties (at the very bottom)
			for (const [key, value] of Object.entries(attachFileMetadata)) {
				if (!(key in orderedMetadata)) {
					orderedMetadata[key] = value;
				}
			}
			fileMetadata = orderedMetadata;
		}

		// Merge tags cleanly (Preserving only manual user tags, discarding old ghost auto-tags!)
		const newObjTags = fileMetadata.tags;
		const finalTags = new Set([...oldManualTags, ...(Array.isArray(newObjTags) ? newObjTags : typeof newObjTags === 'string' ? [newObjTags] : [])].map(t => String(t).trim()));
		if (finalTags.size > 0) fileMetadata.tags = Array.from(finalTags);

		// Merge aliases cleanly
		const newObjAliases = fileMetadata.aliases;
		const finalAliases = new Set(
			[...oldAliases, ...(Array.isArray(newObjAliases) ? newObjAliases : typeof newObjAliases === 'string' ? [newObjAliases] : [])].map(a => String(a).trim()),
		);
		if (finalAliases.size > 0) fileMetadata.aliases = Array.from(finalAliases);

		let attachFileContent: string = await this.app.vault.read(fileToAttach);
		const regExp = new RegExp(this.frontMatterRexExpPattern);
		attachFileContent = attachFileContent.replace(regExp, '');
		attachFileContent = attachFileContent.startsWith('\n') ? attachFileContent.substring(1) : attachFileContent;

		const oldImageLink = attachFileMetadata.image;
		const newImageLink = fileMetadata.image;
		if (typeof oldImageLink === 'string' && typeof newImageLink === 'string' && oldImageLink !== newImageLink) {
			const cleanOld = oldImageLink.replace(/^\[\[(.*?)\]\]$/, '$1').trim();
			const cleanNew = newImageLink.replace(/^\[\[(.*?)\]\]$/, '$1').trim();
			if (cleanOld && cleanNew && cleanOld !== cleanNew) {
				attachFileContent = attachFileContent.replaceAll(oldImageLink, newImageLink);
				attachFileContent = attachFileContent.replaceAll(cleanOld, cleanNew);
			}
		}

		if (updateBody && renderedTemplateBody !== undefined) {
			fileContent += mergeNoteBodies(attachFileContent, renderedTemplateBody, ignoredSections);
		} else {
			fileContent += attachFileContent;
		}

		return { fileMetadata: fileMetadata, fileContent: fileContent };
	}

	async attachTemplate(fileMetadata: Metadata, fileContent: string, template: string | undefined): Promise<{ fileMetadata: Metadata; fileContent: string }> {
		if (!template) {
			return { fileMetadata: fileMetadata, fileContent: fileContent };
		}

		const templateMetadata = this.getMetaDataFromFileContent(template);
		// Merge: API data wins and stays at top; template-only keys are appended at the bottom
		for (const [key, value] of Object.entries(templateMetadata)) {
			if (!(key in fileMetadata)) {
				fileMetadata[key] = value;
			}
		}

		const regExp = new RegExp(this.frontMatterRexExpPattern);
		const attachFileContent = template.replace(regExp, '');
		fileContent += attachFileContent;

		return { fileMetadata: fileMetadata, fileContent: fileContent };
	}

	getMetaDataFromFileContent(fileContent: string): Metadata {
		let metadata: Metadata;

		const regExp = new RegExp(this.frontMatterRexExpPattern);
		const frontMatterRegExpResult = regExp.exec(fileContent);
		if (!frontMatterRegExpResult) {
			return {};
		}
		let frontMatter = frontMatterRegExpResult[0];
		if (!frontMatter) {
			return {};
		}
		frontMatter = frontMatter.substring(4);
		frontMatter = frontMatter.substring(0, frontMatter.length - 3);

		metadata = parseYaml(frontMatter) as Metadata;

		if (!metadata) {
			metadata = {};
		}

		console.debug(`MDB | metadata read from file content`, metadata);

		return metadata;
	}

	getMetadataFromFileCache(file: TFile): Metadata {
		const metadata: Metadata | undefined = this.app.metadataCache.getFileCache(file)?.frontmatter;
		return structuredClone(metadata ?? {});
	}

	getResolvedImportPath(mediaTypeModel: MediaTypeModel): string {
		let folderPath = this.plugin.mediaTypeManager.mediaFolderMap.get(mediaTypeModel.getMediaType()) ?? '/';
		folderPath = this.plugin.mediaTypeManager.expandFolderPathForModel(folderPath, mediaTypeModel);
		let fileName = this.plugin.mediaTypeManager.getFileName(mediaTypeModel);
		fileName = replaceIllegalFileNameCharactersInString(fileName);
		const dir = folderPath.replace(/^\/+|\/+$/g, '');
		const relative = dir.length > 0 ? `${dir}/${fileName}.md` : `${fileName}.md`;
		return normalizePath(relative);
	}

	async createNote(fileName: string, fileContent: string, options: CreateNoteOptions): Promise<TFile> {
		// find and possibly create the folder set in settings or passed in folder
		const folder = options.folder ?? this.app.vault.getAbstractFileByPath('/');

		if (!folder || !(folder instanceof TFolder)) {
			throw new Error('MDB | invalid folder');
		}

		fileName = replaceIllegalFileNameCharactersInString(fileName);
		const filePath = `${folder.path}/${fileName}.md`;

		// look if file already exists and ask if it should be overwritten
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (file) {
			let choice = options.overwrite ? ConfirmOverwriteChoice.Overwrite : null;
			if (!choice) {
				choice = await new Promise<ConfirmOverwriteChoice>(resolve => {
					new ConfirmOverwriteModal(this.app, fileName, resolve).open();
				});
			}

			if (choice !== ConfirmOverwriteChoice.Overwrite) {
				// To keep old Promise<TFile> compatibility, return the existing file if kept, or throw
				if (choice === ConfirmOverwriteChoice.KeepExisting && file instanceof TFile) {
					if (options.openNote) {
						const activeLeaf = this.app.workspace.getUnpinnedLeaf();
						if (activeLeaf) await activeLeaf.openFile(file, { state: { mode: 'source' } });
					}
					return file;
				}
				throw new Error('MDB | file creation cancelled by user');
			}

			await this.app.vault.delete(file);
		}

		// create the file
		const targetFile = await this.app.vault.create(filePath, fileContent);
		console.debug(`MDB | created new file at ${filePath}`);

		// open newly created file
		if (options.openNote) {
			const activeLeaf = this.app.workspace.getUnpinnedLeaf();
			if (!activeLeaf) {
				console.warn('MDB | no active leaf, not opening newly created note');
				return targetFile;
			}
			await activeLeaf.openFile(targetFile, { state: { mode: 'source' } });
		}

		return targetFile;
	}

	async cleanUnusedCoverImages(): Promise<void> {
		const imageFolder = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.imageFolder));
		if (!imageFolder || !(imageFolder instanceof TFolder)) {
			new Notice('MDB | Image folder does not exist or is not a folder.');
			return;
		}

		// Recursively collect all files in the images folder
		const localImageFiles: TFile[] = [];
		const collectFiles = (folder: TFolder) => {
			for (const child of folder.children) {
				if (child instanceof TFile) {
					localImageFiles.push(child);
				} else if (child instanceof TFolder) {
					collectFiles(child);
				}
			}
		};
		collectFiles(imageFolder);

		if (localImageFiles.length === 0) {
			new Notice('MDB | No images found inside the covers folder.');
			return;
		}

		new Notice('MDB | Scanning vault links and frontmatter...');

		const resolvedPaths = new Set<string>();
		const mdFiles = this.app.vault.getMarkdownFiles();

		for (const file of mdFiles) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache) continue;

			// 1. Check frontmatter image field
			const fmImage = cache.frontmatter?.image;
			if (typeof fmImage === 'string') {
				const clean = fmImage.replace(/^\[\[(.*?)\]\]$/, '$1').trim();
				const resolvedFile = this.app.metadataCache.getFirstLinkpathDest(clean, file.path);
				if (resolvedFile) {
					resolvedPaths.add(resolvedFile.path);
				}
			}

			// 2. Check embeds (e.g. ![[image.webp]])
			if (cache.embeds) {
				for (const embed of cache.embeds) {
					const resolvedFile = this.app.metadataCache.getFirstLinkpathDest(embed.link, file.path);
					if (resolvedFile) {
						resolvedPaths.add(resolvedFile.path);
					}
				}
			}

			// 3. Check normal links (e.g. [[image.webp]])
			if (cache.links) {
				for (const link of cache.links) {
					const resolvedFile = this.app.metadataCache.getFirstLinkpathDest(link.link, file.path);
					if (resolvedFile) {
						resolvedPaths.add(resolvedFile.path);
					}
				}
			}
		}

		let deletedCount = 0;
		const imageCache = await this.loadImageCache();

		for (const imageFile of localImageFiles) {
			if (!resolvedPaths.has(imageFile.path)) {
				console.log(`MDB | Deleting unused local cover image: ${imageFile.path}`);
				try {
					await this.app.vault.delete(imageFile);
					delete imageCache[imageFile.path];
					deletedCount++;
				} catch (e) {
					console.warn(`MDB | Failed to delete unused cover image file ${imageFile.path}:`, e);
				}
			}
		}

		if (deletedCount > 0) {
			await this.saveImageCache(imageCache);
		}

		new Notice(`MDB | Cleaned ${deletedCount} unused cover images.`);
	}

	getImageKey(mediaType: MediaType): string {
		const model = this.plugin.settings.propertyMappingModels.find(x => x.type === mediaType);
		if (model) {
			const pm = model.properties.find(p => p.property === 'image');
			if (pm) {
				if (pm.mapping === PropertyMappingOption.Map && pm.newProperty) {
					return pm.newProperty;
				}
				if (pm.mapping === PropertyMappingOption.Remove) {
					return '';
				}
			}
		}
		return 'image';
	}

	isImageUpdateLocked(mediaType: MediaType): boolean {
		const model = this.plugin.settings.propertyMappingModels.find(x => x.type === mediaType);
		if (model) {
			const pm = model.properties.find(p => p.property === 'image');
			if (pm) {
				return pm.updateLocked === true;
			}
		}
		return false;
	}
}
