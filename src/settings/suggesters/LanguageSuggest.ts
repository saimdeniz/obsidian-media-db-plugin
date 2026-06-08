import { AbstractInputSuggest } from 'obsidian';
import type { App } from 'obsidian';

interface LanguageOption {
	code: string;
	name: string;
}

const LANGUAGES: LanguageOption[] = [
	{ code: 'en-US', name: 'English (United States)' },
	{ code: 'en-GB', name: 'English (United Kingdom)' },
	{ code: 'tr-TR', name: 'Turkish (Turkey)' },
	{ code: 'de-DE', name: 'German (Germany)' },
	{ code: 'fr-FR', name: 'French (France)' },
	{ code: 'es-ES', name: 'Spanish (Spain)' },
	{ code: 'it-IT', name: 'Italian (Italy)' },
	{ code: 'ja-JP', name: 'Japanese (Japan)' },
	{ code: 'ko-KR', name: 'Korean (South Korea)' },
	{ code: 'ru-RU', name: 'Russian (Russia)' },
	{ code: 'zh-CN', name: 'Chinese (Simplified, China)' },
	{ code: 'zh-TW', name: 'Chinese (Traditional, Taiwan)' },
	{ code: 'pt-PT', name: 'Portuguese (Portugal)' },
	{ code: 'pt-BR', name: 'Portuguese (Brazil)' },
	{ code: 'nl-NL', name: 'Dutch (Netherlands)' },
	{ code: 'pl-PL', name: 'Polish (Poland)' },
	{ code: 'sv-SE', name: 'Swedish (Sweden)' },
	{ code: 'no-NO', name: 'Norwegian (Norway)' },
	{ code: 'da-DK', name: 'Denmark (Denmark)' },
	{ code: 'fi-FI', name: 'Finnish (Finland)' },
	{ code: 'el-GR', name: 'Greek (Greece)' },
	{ code: 'uk-UA', name: 'Ukrainian (Ukraine)' },
	{ code: 'hi-IN', name: 'Hindi (India)' },
	{ code: 'ar-AE', name: 'Arabic (UAE)' },
	{ code: 'he-IL', name: 'Hebrew (Israel)' },
];

export class LanguageSuggest extends AbstractInputSuggest<LanguageOption> {
	private inputEl: HTMLInputElement;

	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.inputEl = inputEl;
	}

	protected getSuggestions(query: string): LanguageOption[] {
		const lower = query.toLowerCase().trim();
		if (!lower) {
			return LANGUAGES;
		}
		return LANGUAGES.filter(
			l => l.name.toLowerCase().includes(lower) || l.code.toLowerCase().includes(lower),
		);
	}

	renderSuggestion(value: LanguageOption, el: HTMLElement): void {
		el.setText(`${value.name} (${value.code})`);
	}

	selectSuggestion(value: LanguageOption, evt: MouseEvent | KeyboardEvent): void {
		this.inputEl.value = value.code;
		this.inputEl.dispatchEvent(new Event('input'));
		this.close();
	}
}
