import type { TFolder } from 'obsidian';
import { Notice } from 'obsidian';
import type MediaDbPlugin from 'src/main';
import { BulkUpdateConfirmModal } from 'src/modals/BulkUpdateConfirmModal';
import { CompletionModal } from 'src/modals/CompletionModal';
import { dateTimeToString, markdownTable } from './Utils';

export class BulkUpdateHelper {
	readonly plugin: MediaDbPlugin;

	constructor(plugin: MediaDbPlugin) {
		this.plugin = plugin;
	}

	async updateFolder(folder?: TFolder, smartModeDefault: boolean = false): Promise<void> {
		const allFiles = this.plugin.app.vault.getMarkdownFiles();
		const candidateFiles = folder ? allFiles.filter(f => f.path.startsWith(folder.path + '/')) : allFiles;

		const mediaFiles = candidateFiles.filter(file => {
			const metadata = this.plugin.getMetadataFromFileCache(file);
			return Boolean(metadata?.dataSource && metadata.id);
		});

		if (mediaFiles.length === 0) {
			new Notice(folder ? 'MDB | No Media DB files found in this folder.' : 'MDB | No Media DB files found in the vault.');
			return;
		}

		new BulkUpdateConfirmModal(
			this.plugin.app,
			async (
				silent: boolean,
				updateBody: boolean,
				preservePropertyOrder: boolean,
				smartMode: boolean,
				unreleasedOnly: boolean,
				yearFilterEnabled: boolean,
				minYear: number | undefined,
				maxYear: number | undefined,
			) => {
				// Filter for smart mode if enabled
				let targetFiles = mediaFiles;
				if (smartMode) {
					const airingKey = this.plugin.settings.autoTrackerAiringKey || 'airing';
					const releasedKey = this.plugin.settings.autoTrackerReleasedKey || 'released';
					targetFiles = mediaFiles.filter(file => {
						const rawMetadata = this.plugin.getMetadataFromFileCache(file);
						const metadata = this.plugin.modelPropertyMapper.convertObjectBack(rawMetadata);

						let matchesUnreleased = true;
						if (unreleasedOnly) {
							matchesUnreleased = metadata?.[airingKey] === true || metadata?.[releasedKey] === false;
						}

						let matchesYear = true;
						const year = Number(metadata?.year) || undefined;
						if (yearFilterEnabled) {
							if (minYear === undefined && maxYear === undefined) {
								matchesYear = year === undefined;
							} else {
								if (year !== undefined) {
									if (minYear !== undefined && year < minYear) matchesYear = false;
									if (maxYear !== undefined && year > maxYear) matchesYear = false;
								} else {
									matchesYear = false;
								}
							}
						}

						return matchesUnreleased && matchesYear;
					});

					if (targetFiles.length === 0) {
						new Notice('MDB | No Media DB files found matching the smart filters.');
						return;
					}
				}

				new Notice(`MDB | Bulk updating ${targetFiles.length} files. Please wait...`);
				const startTime = Date.now();
				let successCount = 0;
				let failCount = 0;
				const erroredFiles: { filePath: string; error: string }[] = [];

				let progress = new Notice('', 0);
				let i = 0;
				try {
					for (const file of targetFiles) {
						// @ts-ignore (Recreate notice if user accidentally clicked/closed it)
						if (progress.noticeEl && !activeDocument.body.contains(progress.noticeEl)) progress = new Notice('', 0);

						const pct = Math.round((i / targetFiles.length) * 100);
						progress.setMessage(`MDB | Updating: ${i + 1}/${targetFiles.length} (${pct}%) — ${file.basename}`);
						try {
							await this.plugin.updateNote(file, true, preservePropertyOrder, false, true, updateBody);
							successCount++;
						} catch (e) {
							console.error(`MDB | Failed to bulk update ${file.path}: `, e);
							failCount++;
							erroredFiles.push({ filePath: file.path, error: `${e}` });
						}
						await new Promise(resolve => setTimeout(resolve, 800));
						i++;
					}
				} finally {
					progress.hide();
				}

				if (failCount > 0 && erroredFiles.length > 0) {
					const title = `MDB - bulk update error report ${dateTimeToString(new Date())}`;
					const filePath = `${title}.md`;
					const table = [['file', 'error']].concat(erroredFiles.map(x => [x.filePath, x.error]));
					const fileContent = markdownTable(table);
					await this.plugin.app.vault.create(filePath, fileContent);
				}

				new CompletionModal(this.plugin.app, {
					title: 'Bulk Update Complete',
					icon: 'refresh-cw',
					total: targetFiles.length,
					success: successCount,
					errors: failCount,
					elapsedMs: Date.now() - startTime,
					notes: failCount > 0 ? ['Some files could not be updated. A detailed report file has been created in your vault folder.'] : [],
				}).open();
			},
			folder ? 'Bulk Update Folder' : 'Bulk Update Vault',
			folder ? 'You are about to scan and update metadata for notes in this folder.' : 'You are about to scan and update metadata for all Media DB notes in your vault.',
			true,
			smartModeDefault,
		).open();
	}
}
