import type { ButtonComponent } from 'obsidian';
import { Modal, Notice, Setting, TextComponent, ToggleComponent, setIcon } from 'obsidian';
import type MediaDbPlugin from '../main';
import type { AdvancedSearchModalData, AdvancedSearchModalOptions } from '../utils/ModalHelper';
import { ADVANCED_SEARCH_MODAL_DEFAULT_OPTIONS } from '../utils/ModalHelper';

export class MediaDbAdvancedSearchModal extends Modal {
	plugin: MediaDbPlugin;

	query: string;
	isBusy: boolean;
	title: string;
	selectedApis: string[];

	searchBtn?: ButtonComponent;

	submitCallback?: (res: AdvancedSearchModalData) => void;
	closeCallback?: (err?: Error) => void;

	constructor(plugin: MediaDbPlugin, advancedSearchModalOptions: AdvancedSearchModalOptions) {
		advancedSearchModalOptions = Object.assign({}, ADVANCED_SEARCH_MODAL_DEFAULT_OPTIONS, advancedSearchModalOptions);
		super(plugin.app);

		this.plugin = plugin;
		this.selectedApis = [];
		this.title = advancedSearchModalOptions.modalTitle ?? '';
		this.query = advancedSearchModalOptions.prefilledSearchString ?? '';
		this.isBusy = false;
	}

	setSubmitCb(submitCallback: (res: AdvancedSearchModalData) => void): void {
		this.submitCallback = submitCallback;
	}

	setCloseCb(closeCallback: (err?: Error) => void): void {
		this.closeCallback = closeCallback;
	}

	keyPressCallback(event: KeyboardEvent): void {
		if (event.key === 'Enter') {
			void this.search();
		}
	}

	async search(): Promise<void> {
		if (!this.query || this.query.length < 3) {
			new Notice('MDB | Query too short');
			return;
		}

		const apis: string[] = this.selectedApis;

		if (apis.length === 0) {
			new Notice('MDB | No API selected');
			return;
		}

		if (!this.isBusy) {
			this.isBusy = true;
			this.searchBtn?.setDisabled(false);
			this.searchBtn?.setButtonText('Searching...');

			this.submitCallback?.({ query: this.query, apis: apis });
		}
	}

	onOpen(): void {
		const { contentEl } = this;

		contentEl.createEl('h2', { text: this.title });

		const placeholder = 'Search by title';
		const searchComponent = new TextComponent(contentEl);
		searchComponent.inputEl.addClass('media-db-width-full');
		searchComponent.setPlaceholder(placeholder);
		searchComponent.setValue(this.query);
		searchComponent.onChange(value => (this.query = value));
		searchComponent.inputEl.addEventListener('keydown', this.keyPressCallback.bind(this));

		contentEl.appendChild(searchComponent.inputEl);
		searchComponent.inputEl.focus();

		contentEl.createDiv({ cls: 'media-db-plugin-spacer' });
		contentEl.createEl('h3', { text: 'APIs to search' });

		const getApiCategory = (apiName: string): string => {
			const name = apiName.toLowerCase();
			if (name.includes('omdb') || name.includes('tmdb') || name === 'malapi') {
				return 'Movie';
			}
			if (name.includes('igdb') || name.includes('rawg') || name.includes('steam') || name.includes('vndb') || name.includes('boardgamegeek')) {
				return 'Game';
			}
			if (name.includes('googlebooks') || name.includes('goodreads') || name.includes('openlibrary') || name === 'malapi manga' || name.includes('comicvine')) {
				return 'Book';
			}
			if (name.includes('musicbrainz')) {
				return 'Music';
			}
			if (name.includes('wikipedia')) {
				return 'Wiki';
			}
			return 'Other';
		};

		const getCategoryIcon = (category: string): string => {
			switch (category) {
				case 'Movie':
					return 'film';
				case 'Game':
					return 'gamepad-2';
				case 'Book':
					return 'book-marked';
				case 'Music':
					return 'disc-3';
				case 'Wiki':
					return 'library-big';
				default:
					return 'library';
			}
		};

		const categories = ['Movie', 'Game', 'Book', 'Music', 'Wiki', 'Other'];
		const apisByCategory = new Map<string, typeof this.plugin.apiManager.apis>();

		for (const api of this.plugin.apiManager.apis) {
			const category = getApiCategory(api.apiName);
			if (!apisByCategory.has(category)) {
				apisByCategory.set(category, []);
			}
			apisByCategory.get(category)!.push(api);
		}

		for (const category of categories) {
			const categoryApis = apisByCategory.get(category) ?? [];
			if (categoryApis.length === 0) continue;

			const groupEl = contentEl.createDiv({ cls: 'media-db-api-category-group' });

			const titleEl = groupEl.createEl('div', { cls: 'media-db-api-category-title' });
			const iconSpan = titleEl.createSpan({ cls: 'media-db-api-category-title-icon' });
			setIcon(iconSpan, getCategoryIcon(category));
			titleEl.createSpan({ text: category });

			for (const api of categoryApis) {
				const apiToggleRow = groupEl.createDiv({ cls: 'media-db-api-toggle-row' });

				const apiToggleTextWrapper = apiToggleRow.createDiv({ cls: 'media-db-plugin-list-text-wrapper' });
				apiToggleTextWrapper.createEl('span', { text: api.apiName, cls: 'media-db-plugin-list-text' });
				apiToggleTextWrapper.createEl('small', { text: api.apiDescription, cls: 'media-db-plugin-list-text' });

				const apiToggleComponentWrapper = apiToggleRow.createDiv({ cls: 'media-db-plugin-list-toggle' });

				const apiToggleComponent = new ToggleComponent(apiToggleComponentWrapper);
				apiToggleComponent.setTooltip(api.apiName);
				apiToggleComponent.setValue(this.selectedApis.some(x => x === api.apiName));
				apiToggleComponent.onChange(value => {
					if (value) {
						this.selectedApis.push(api.apiName);
					} else {
						this.selectedApis = this.selectedApis.filter(x => x !== api.apiName);
					}
				});
				apiToggleComponentWrapper.appendChild(apiToggleComponent.toggleEl);
			}
		}

		contentEl.createDiv({ cls: 'media-db-plugin-spacer' });

		new Setting(contentEl)
			.addButton(btn => {
				btn.setButtonText('Cancel');
				btn.onClick(() => this.close());
				btn.buttonEl.addClass('media-db-plugin-button');
			})
			.addButton(btn => {
				btn.setButtonText('Ok');
				btn.setCta();
				btn.onClick(() => {
					void this.search();
				});
				btn.buttonEl.addClass('media-db-plugin-button');
				this.searchBtn = btn;
			});
	}

	onClose(): void {
		this.closeCallback?.();
		const { contentEl } = this;
		contentEl.empty();
	}
}
