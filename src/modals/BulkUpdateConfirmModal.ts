import type { App } from 'obsidian';
import { Modal, Setting } from 'obsidian';

export class BulkUpdateConfirmModal extends Modal {
	onSubmit: (
		silent: boolean,
		updateBody: boolean,
		preservePropertyOrder: boolean,
		smartMode: boolean,
		unreleasedOnly: boolean,
		yearFilterEnabled: boolean,
		minYear: number | undefined,
		maxYear: number | undefined,
	) => void | Promise<void>;
	silentUpdate: boolean = false;
	updateBody: boolean = false;
	preservePropertyOrder: boolean = true;
	smartMode: boolean = false;
	unreleasedOnly: boolean = false;
	yearFilterEnabled: boolean = false;
	minYear: number | undefined = undefined;
	maxYear: number | undefined = undefined;
	customTitle: string;
	customDesc: string;
	showOptions: boolean;

	constructor(
		app: App,
		onSubmit: (
			silent: boolean,
			updateBody: boolean,
			preservePropertyOrder: boolean,
			smartMode: boolean,
			unreleasedOnly: boolean,
			yearFilterEnabled: boolean,
			minYear: number | undefined,
			maxYear: number | undefined,
		) => void | Promise<void>,
		customTitle: string = 'Bulk Update Metadata',
		customDesc: string = 'You are about to scan and update metadata for notes in this folder.',
		showOptions: boolean = true,
		smartModeDefault: boolean = false,
	) {
		super(app);
		this.onSubmit = onSubmit;
		this.customTitle = customTitle;
		this.customDesc = customDesc;
		this.showOptions = showOptions;
		this.smartMode = smartModeDefault;
		this.unreleasedOnly = smartModeDefault;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: this.customTitle });
		contentEl.createEl('p', { text: this.customDesc });

		new Setting(contentEl)
			.setName('Update Silently (No Confirmations)')
			.setDesc('If enabled, all updates will aggressively overwrite the note frontmatter without asking for individual confirmation for each file.')
			.addToggle(toggle => toggle.setValue(this.silentUpdate).onChange(value => (this.silentUpdate = value)));

		if (this.showOptions) {
			new Setting(contentEl)
				.setName('Update Note Body Sections')
				.setDesc('If enabled, this will also update text/content sections in your notes using templates (while preserving your manual notes/reviews).')
				.addToggle(toggle => toggle.setValue(this.updateBody).onChange(value => (this.updateBody = value)));

			new Setting(contentEl)
				.setName('Keep Current Property Order')
				.setDesc('If enabled, keeps the existing frontmatter property order. Otherwise, re-orders properties based on templates.')
				.addToggle(toggle => toggle.setValue(this.preservePropertyOrder).onChange(value => (this.preservePropertyOrder = value)));

			new Setting(contentEl)
				.setName('Enable Smart Filtering')
				.setDesc('If enabled, filters the notes dynamically to avoid updating everything.')
				.addToggle(toggle =>
					toggle.setValue(this.smartMode).onChange(value => {
						this.smartMode = value;
						updateSubSettingsVisibility(value);
					}),
				);

			// Container for sub-settings with a vertical left border for hierarchy
			const subSettingsEl = contentEl.createDiv();
			subSettingsEl.setAttribute('style', 'margin-left: 20px; border-left: 2px solid var(--background-modifier-border); padding-left: 15px; margin-bottom: 20px;');

			const unreleasedSetting = new Setting(subSettingsEl)
				.setName('Unreleased / Airing Notes Only')
				.setDesc('If enabled, only notes that have released: false (or equivalent tracker key) will be updated.')
				.addToggle(toggle => toggle.setValue(this.unreleasedOnly).onChange(value => (this.unreleasedOnly = value)));

			const yearRangeSubEl = subSettingsEl.createDiv();

			const yearFilterSetting = new Setting(yearRangeSubEl)
				.setName('Filter by Year Range')
				.setDesc('If enabled, only updates notes within the specified release year range.')
				.addToggle(toggle =>
					toggle.setValue(this.yearFilterEnabled).onChange(value => {
						this.yearFilterEnabled = value;
						yearInputsSetting.settingEl.toggleClass('media-db-hidden', !value);
					}),
				);

			const yearInputsSetting = new Setting(yearRangeSubEl)
				.setName('Release Year Range')
				.setDesc('Specify minimum and/or maximum release year (leave blank for no limit).')
				.addText(txt =>
					txt
						.setPlaceholder('Min Year')
						.setValue(this.minYear ? String(this.minYear) : '')
						.onChange(val => {
							const num = Number(val);
							this.minYear = isNaN(num) || val.trim() === '' ? undefined : num;
						}),
				)
				.addText(txt =>
					txt
						.setPlaceholder('Max Year')
						.setValue(this.maxYear ? String(this.maxYear) : '')
						.onChange(val => {
							const num = Number(val);
							this.maxYear = isNaN(num) || val.trim() === '' ? undefined : num;
						}),
				);

			yearInputsSetting.settingEl.toggleClass('media-db-hidden', !this.yearFilterEnabled);

			function updateSubSettingsVisibility(visible: boolean) {
				subSettingsEl.toggleClass('media-db-hidden', !visible);
			}
			updateSubSettingsVisibility(this.smartMode);
		}

		new Setting(contentEl).addButton(btn =>
			btn
				.setButtonText('Start Update')
				.setCta()
				.onClick(() => {
					this.close();
					void this.onSubmit(
						this.silentUpdate,
						this.updateBody,
						this.preservePropertyOrder,
						this.smartMode,
						this.unreleasedOnly,
						this.yearFilterEnabled,
						this.minYear,
						this.maxYear,
					);
				}),
		);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
