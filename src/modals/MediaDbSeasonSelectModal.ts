import type MediaDbPlugin from '../main';
import { SelectModal } from './SelectModal';

export interface SeasonSelectModalElement {
	season_number: number;
	name: string;
	air_date?: string;
	poster_path?: string;
}

export class MediaDbSeasonSelectModal extends SelectModal<SeasonSelectModalElement> {
	plugin: MediaDbPlugin;
	submitCallback?: (selectedSeasons: SeasonSelectModalElement[]) => void;
	closeCallback?: (err?: Error) => void;
	seriesName?: string;

	constructor(plugin: MediaDbPlugin, seasons: SeasonSelectModalElement[], multiSelect = true, seriesName?: string) {
		super(plugin.app, seasons, multiSelect);
		this.plugin = plugin;
		this.seriesName = seriesName;
		this.title = `Select seasons for${seriesName ? ` ${seriesName}` : ''}`;
		this.description = 'Select one or more seasons to create notes for.';
		this.submitButtonText = 'Create Entry';
	}

	renderElement(season: SeasonSelectModalElement, el: HTMLElement): void {
		el.addClass('media-db-list-item-flex');

		const thumb = el.createDiv({ cls: 'media-db-list-item-thumb media-db-plugin-select-thumb' });

		if (season.poster_path) {
			const img = activeDocument.createElement('img');
			img.src = season.poster_path.startsWith('http') ? season.poster_path : `https://image.tmdb.org/t/p/w780${season.poster_path}`;
			img.loading = 'lazy';
			img.alt = season.name;
			img.onerror = () => {
				thumb.empty();
				thumb.createEl('span', { text: '📷', cls: 'media-db-font-24' });
			};
			thumb.appendChild(img);
		} else {
			thumb.createEl('span', { text: '📷', cls: 'media-db-font-24' });
		}

		const content = el.createDiv({ cls: 'media-db-plugin-select-content' });
		content.createEl('div', { text: `${season.name}` });
		if (season.air_date) {
			content.createEl('small', { text: `Air date: ${season.air_date}` });
		}
	}

	submit(): void {
		const selected = this.selectModalElements.filter(x => x.isActive()).map(x => x.value);
		this.submitCallback?.(selected);
		this.close();
	}

	skip(): void {
		this.close();
	}

	setSubmitCb(cb: (selectedSeasons: SeasonSelectModalElement[]) => void): void {
		this.submitCallback = cb;
	}

	setCloseCb(cb: (err?: Error) => void): void {
		this.closeCallback = cb;
	}
}
