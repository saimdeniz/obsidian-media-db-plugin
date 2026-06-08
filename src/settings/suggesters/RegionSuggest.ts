import { AbstractInputSuggest } from 'obsidian';
import type { App } from 'obsidian';

interface CountryOption {
	code: string;
	name: string;
}

const COUNTRIES: CountryOption[] = [
	{ code: 'US', name: 'United States' },
	{ code: 'TR', name: 'Turkey' },
	{ code: 'GB', name: 'United Kingdom' },
	{ code: 'CA', name: 'Canada' },
	{ code: 'DE', name: 'Germany' },
	{ code: 'FR', name: 'France' },
	{ code: 'ES', name: 'Spain' },
	{ code: 'IT', name: 'Italy' },
	{ code: 'JP', name: 'Japan' },
	{ code: 'KR', name: 'South Korea' },
	{ code: 'BR', name: 'Brazil' },
	{ code: 'MX', name: 'Mexico' },
	{ code: 'IN', name: 'India' },
	{ code: 'AU', name: 'Australia' },
	{ code: 'NL', name: 'Netherlands' },
	{ code: 'RU', name: 'Russia' },
	{ code: 'CN', name: 'China' },
	{ code: 'PL', name: 'Poland' },
	{ code: 'SE', name: 'Sweden' },
	{ code: 'NO', name: 'Norway' },
	{ code: 'DK', name: 'Denmark' },
	{ code: 'FI', name: 'Finland' },
	{ code: 'GR', name: 'Greece' },
	{ code: 'UA', name: 'Ukraine' },
	{ code: 'PT', name: 'Portugal' },
	{ code: 'IE', name: 'Ireland' },
	{ code: 'NZ', name: 'New Zealand' },
	{ code: 'ZA', name: 'South Africa' },
	{ code: 'CH', name: 'Switzerland' },
	{ code: 'AT', name: 'Austria' },
	{ code: 'BE', name: 'Belgium' },
];

export class RegionSuggest extends AbstractInputSuggest<CountryOption> {
	private inputEl: HTMLInputElement;

	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.inputEl = inputEl;
	}

	protected getSuggestions(query: string): CountryOption[] {
		const lower = query.toLowerCase().trim();
		if (!lower) {
			return COUNTRIES;
		}
		return COUNTRIES.filter(
			c => c.name.toLowerCase().includes(lower) || c.code.toLowerCase().includes(lower),
		);
	}

	renderSuggestion(value: CountryOption, el: HTMLElement): void {
		el.setText(`${value.name} (${value.code})`);
	}

	selectSuggestion(value: CountryOption, evt: MouseEvent | KeyboardEvent): void {
		this.inputEl.value = value.code;
		this.inputEl.dispatchEvent(new Event('input'));
		this.close();
	}
}
