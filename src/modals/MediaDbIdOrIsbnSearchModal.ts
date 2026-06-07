import type { ButtonComponent } from 'obsidian';
import { Modal, Notice, Setting, TextComponent } from 'obsidian';
import type MediaDbPlugin from '../main';
import { MediaDbDropdown } from './MediaDbDropdown';

export interface IdOrIsbnSearchModalData {
	type: 'id' | 'isbn';
	query: string;
	api?: string;
}

export class MediaDbIdOrIsbnSearchModal extends Modal {
	plugin: MediaDbPlugin;

	searchType: 'id' | 'isbn' = 'id';
	query = '';
	selectedApi: string;
	isBusy = false;

	searchBtn?: ButtonComponent;
	apiDropdownContainer?: HTMLDivElement;
	inputComponent?: TextComponent;
	apiDropdown?: MediaDbDropdown;

	submitCallback: (res: IdOrIsbnSearchModalData) => void;

	constructor(plugin: MediaDbPlugin, submitCallback: (res: IdOrIsbnSearchModalData) => void) {
		super(plugin.app);
		this.plugin = plugin;
		this.submitCallback = submitCallback;
		this.selectedApi = plugin.apiManager.apis[0]?.apiName || '';
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Create Media DB entry by ID or ISBN' });

		// 1. Search Type Toggle
		const typeSetting = new Setting(contentEl).setName('Search type').setDesc('Search by direct ID or book ISBN');

		const controlDiv = typeSetting.controlEl.createDiv({ cls: 'media-db-segmented-control' });
		const idBtn = controlDiv.createEl('button', { text: 'ID', cls: 'media-db-segment-btn' });
		const isbnBtn = controlDiv.createEl('button', { text: 'ISBN', cls: 'media-db-segment-btn' });

		const updateButtons = (): void => {
			idBtn.toggleClass('is-active', this.searchType === 'id');
			isbnBtn.toggleClass('is-active', this.searchType === 'isbn');
		};

		idBtn.addEventListener('click', () => {
			this.searchType = 'id';
			updateButtons();
			this.updateFields();
		});

		isbnBtn.addEventListener('click', () => {
			this.searchType = 'isbn';
			updateButtons();
			this.updateFields();
		});

		updateButtons();

		// Inline API selector container placed in the same row
		this.apiDropdownContainer = typeSetting.controlEl.createDiv({ cls: 'media-db-inline-api-container' });
		this.apiDropdownContainer.style.transition = 'opacity 0.15s ease-in-out, width 0.15s ease-in-out, margin 0.15s ease-in-out';

		this.apiDropdown = new MediaDbDropdown(this.apiDropdownContainer);
		for (const api of this.plugin.apiManager.apis) {
			this.apiDropdown.addOption(api.apiName, api.apiName);
		}
		this.apiDropdown.setValue(this.selectedApi).onChange(val => {
			this.selectedApi = val;
		});

		contentEl.createDiv({ cls: 'media-db-plugin-spacer' });

		// 2. Input Query Field
		this.inputComponent = new TextComponent(contentEl);
		this.inputComponent.inputEl.style.width = '100%';
		this.inputComponent.onChange(value => (this.query = value));
		this.inputComponent.inputEl.addEventListener('keydown', (event: KeyboardEvent) => {
			if (event.key === 'Enter') {
				void this.search();
			}
		});
		contentEl.appendChild(this.inputComponent.inputEl);

		contentEl.createDiv({ cls: 'media-db-plugin-spacer' });

		// 3. Buttons
		new Setting(contentEl)
			.addButton(btn => {
				btn.setButtonText('Cancel');
				btn.onClick(() => this.close());
				btn.buttonEl.addClass('media-db-plugin-button');
			})
			.addButton(btn => {
				btn.setButtonText('Search');
				btn.setCta();
				btn.onClick(() => {
					void this.search();
				});
				btn.buttonEl.addClass('media-db-plugin-button');
				this.searchBtn = btn;
			});

		this.updateFields();
		this.inputComponent.inputEl.focus();
	}

	updateFields(): void {
		if (this.inputComponent) {
			this.inputComponent.setPlaceholder(this.searchType === 'id' ? 'Enter entry ID (e.g. 291446)' : 'Enter ISBN-10 or ISBN-13');
		}

		if (this.apiDropdownContainer) {
			if (this.searchType === 'id') {
				this.apiDropdownContainer.style.opacity = '1';
				this.apiDropdownContainer.style.pointerEvents = 'auto';
				this.apiDropdownContainer.style.width = 'auto';
				this.apiDropdownContainer.style.marginLeft = '8px';
			} else {
				this.apiDropdownContainer.style.opacity = '0';
				this.apiDropdownContainer.style.pointerEvents = 'none';
				this.apiDropdownContainer.style.width = '0px';
				this.apiDropdownContainer.style.marginLeft = '0px';
				this.apiDropdownContainer.style.overflow = 'hidden';
			}
		}
	}

	async search(): Promise<void> {
		const cleanQuery = this.query.trim();
		if (!cleanQuery) {
			new Notice(this.searchType === 'id' ? 'Please enter an ID' : 'Please enter an ISBN');
			return;
		}

		if (this.searchType === 'id' && !this.selectedApi) {
			new Notice('No API selected');
			return;
		}

		if (!this.isBusy) {
			this.isBusy = true;
			this.searchBtn?.setDisabled(true);
			this.searchBtn?.setButtonText('Searching...');

			this.submitCallback({
				type: this.searchType,
				query: cleanQuery,
				api: this.searchType === 'id' ? this.selectedApi : undefined,
			});
			this.close();
		}
	}

	onClose(): void {
		this.apiDropdown?.destroy();
		const { contentEl } = this;
		contentEl.empty();
	}
}
