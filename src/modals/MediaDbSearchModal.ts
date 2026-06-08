import type { ButtonComponent } from 'obsidian';
import { Modal, Notice, Setting, TextComponent, ToggleComponent, setIcon } from 'obsidian';
import type MediaDbPlugin from '../main';
import { MediaType, MEDIA_TYPES } from '../utils/MediaType';
import type { SearchModalData, SearchModalOptions } from '../utils/ModalHelper';
import { SEARCH_MODAL_DEFAULT_OPTIONS } from '../utils/ModalHelper';
import { mediaTypeDisplayName } from '../utils/Utils';

export class MediaDbSearchModal extends Modal {
	plugin: MediaDbPlugin;

	query: string;
	isBusy: boolean;
	title: string;
	selectedTypes: MediaType[];

	searchBtn?: ButtonComponent;

	submitCallback?: (res: SearchModalData) => void;
	closeCallback?: (err?: Error) => void;

	constructor(plugin: MediaDbPlugin, searchModalOptions: SearchModalOptions) {
		searchModalOptions = Object.assign({}, SEARCH_MODAL_DEFAULT_OPTIONS, searchModalOptions);
		super(plugin.app);

		this.plugin = plugin;
		this.selectedTypes = [...(searchModalOptions.preselectedTypes ?? [])];
		this.title = searchModalOptions.modalTitle ?? '';
		this.query = searchModalOptions.prefilledSearchString ?? '';
		this.isBusy = false;
	}

	setSubmitCb(submitCallback: (res: SearchModalData) => void): void {
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

		const types: MediaType[] = this.selectedTypes;

		if (types.length === 0) {
			new Notice('MDB | No Type selected');
			return;
		}

		if (!this.isBusy) {
			this.isBusy = true;
			this.searchBtn?.setDisabled(false);
			this.searchBtn?.setButtonText('Searching...');

			this.submitCallback?.({ query: this.query, types: types });
		}
	}

	onOpen(): void {
		const { contentEl } = this;

		contentEl.createEl('h2', { text: this.title });

		const placeholder = 'Search by title';
		const searchComponent = new TextComponent(contentEl);
		let currentToggle: ToggleComponent | undefined = undefined;

		searchComponent.inputEl.addClass('media-db-width-full');
		searchComponent.setPlaceholder(placeholder);
		searchComponent.setValue(this.query);
		searchComponent.onChange(value => (this.query = value));
		searchComponent.inputEl.addEventListener('keydown', this.keyPressCallback.bind(this));

		contentEl.appendChild(searchComponent.inputEl);
		searchComponent.inputEl.focus();

		contentEl.createDiv({ cls: 'media-db-plugin-spacer' });
		contentEl.createEl('h3', { text: 'APIs to search' });

		const getMediaTypeCategory = (type: MediaType): string => {
			if (type === MediaType.Movie || type === MediaType.Series || type === MediaType.Season) {
				return 'Movie';
			}
			if (type === MediaType.Game || type === MediaType.BoardGame) {
				return 'Game';
			}
			if (type === MediaType.Book || type === MediaType.ComicManga) {
				return 'Book';
			}
			if (type === MediaType.Artist || type === MediaType.MusicRelease || type === MediaType.Song) {
				return 'Music';
			}
			if (type === MediaType.Wiki) {
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
		const typesByCategory = new Map<string, MediaType[]>();

		for (const mediaType of MEDIA_TYPES) {
			const category = getMediaTypeCategory(mediaType);
			if (!typesByCategory.has(category)) {
				typesByCategory.set(category, []);
			}
			typesByCategory.get(category)!.push(mediaType);
		}

		const toggles: { mediaType: MediaType; toggle: ToggleComponent }[] = [];

		for (const category of categories) {
			const categoryTypes = typesByCategory.get(category) ?? [];
			if (categoryTypes.length === 0) continue;

			const groupEl = contentEl.createDiv({ cls: 'media-db-api-category-group' });

			const titleEl = groupEl.createEl('div', { cls: 'media-db-api-category-title' });
			const iconSpan = titleEl.createSpan({ cls: 'media-db-api-category-title-icon' });
			setIcon(iconSpan, getCategoryIcon(category));
			titleEl.createSpan({ text: category });

			for (const mediaType of categoryTypes) {
				const toggleRow = groupEl.createDiv({ cls: 'media-db-api-toggle-row' });

				const textWrapper = toggleRow.createDiv({ cls: 'media-db-plugin-list-text-wrapper' });
				textWrapper.createEl('span', { text: mediaTypeDisplayName(mediaType), cls: 'media-db-plugin-list-text' });

				const toggleWrapper = toggleRow.createDiv({ cls: 'media-db-plugin-list-toggle' });

				const apiToggleComponent = new ToggleComponent(toggleWrapper);
				apiToggleComponent.setTooltip(mediaTypeDisplayName(mediaType));
				apiToggleComponent.setValue(this.selectedTypes.includes(mediaType));

				toggles.push({ mediaType, toggle: apiToggleComponent });

				if (apiToggleComponent.getValue()) {
					currentToggle = apiToggleComponent;
				}

				apiToggleComponent.onChange(value => {
					if (value) {
						for (const item of toggles) {
							if (item.mediaType !== mediaType) {
								item.toggle.setValue(false);
							}
						}
						currentToggle = apiToggleComponent;
						this.selectedTypes = [mediaType];
					} else {
						if (currentToggle === apiToggleComponent) {
							currentToggle = undefined;
						}
						this.selectedTypes = this.selectedTypes.filter(x => x !== mediaType);
					}
				});

				toggleWrapper.appendChild(apiToggleComponent.toggleEl);
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
