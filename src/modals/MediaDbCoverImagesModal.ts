import { Modal, Notice, Setting } from 'obsidian';
import type MediaDbPlugin from '../main';

export class MediaDbCoverImagesModal extends Modal {
	plugin: MediaDbPlugin;

	constructor(plugin: MediaDbPlugin) {
		super(plugin.app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Manage Cover Images' });
		contentEl.createEl('p', {
			text: 'Select an action to clean unused cover image files from your local vault folder or reset the image download cache.',
		});

		contentEl.createDiv({ cls: 'media-db-plugin-spacer' });

		new Setting(contentEl)
			.setName('Clean unused cover images')
			.setDesc('Scan your markdown notes and delete downloaded cover image files that are no longer referenced.')
			.addButton(btn => {
				btn.setButtonText('Clean Unused');
				btn.onClick(async () => {
					await new Promise(r => setTimeout(r, 150));
					this.close();
					try {
						await this.plugin.noteManager.cleanUnusedCoverImages();
					} catch (e) {
						new Notice(`Failed to clean cover images: ${e}`);
					}
				});
				btn.buttonEl.addClass('media-db-plugin-button');
			});

		new Setting(contentEl)
			.setName('Clear image cache')
			.setDesc('Reset the local download cache (image-cache.json) to force the plugin to check or re-download covers.')
			.addButton(btn => {
				btn.setButtonText('Clear Cache');
				btn.onClick(async () => {
					await new Promise(r => setTimeout(r, 150));
					this.close();
					const cachePath = `${this.app.vault.configDir}/plugins/obsidian-media-db-plugin/image-cache.json`;
					try {
						if (await this.app.vault.adapter.exists(cachePath)) {
							await this.app.vault.adapter.remove(cachePath);
						}
						new Notice('Media DB cover image cache cleared successfully.');
					} catch (e) {
						new Notice(`Failed to clear image cache: ${e}`);
					}
				});
				btn.buttonEl.addClass('media-db-plugin-button');
			});

		contentEl.createDiv({ cls: 'media-db-plugin-spacer' });

		new Setting(contentEl).addButton(btn => {
			btn.setButtonText('Cancel');
			btn.onClick(async () => {
				await new Promise(r => setTimeout(r, 150));
				this.close();
			});
			btn.buttonEl.addClass('media-db-plugin-button');
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
