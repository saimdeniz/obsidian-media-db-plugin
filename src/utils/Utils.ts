import { iso6392 } from 'iso-639-2';
import type { TFile, TFolder, App } from 'obsidian';
import { requestUrl } from 'obsidian';
import type { MediaTypeModel } from '../models/MediaTypeModel';
import { MediaType } from './MediaType';

export const pluginName: string = 'obsidian-media-db-plugin';
export const contactEmail: string = 'm.projects.code@gmail.com';
export const mediaDbTag: string = 'mediaDB';
export const mediaDbVersion: string = '0.5.2';
export const debug: boolean = true;

export function wrapAround(value: number, size: number): number {
	if (size <= 0) {
		throw Error('size may not be zero or negative');
	}
	return mod(value, size);
}

export function containsOnlyLettersAndUnderscores(str: string): boolean {
	return /^[\p{Letter}\p{M}_]+$/u.test(str);
}

export function replaceIllegalFileNameCharactersInString(string: string): string {
	return string.replace(/[\\/:"*?<>|]/g, '-').replace(/#/g, '');
}

export function replaceTags(template: string, mediaTypeModel: MediaTypeModel, ignoreUndefined: boolean = false): string {
	return template.replace(new RegExp('{{.*?}}', 'g'), (match: string) => replaceTag(match, mediaTypeModel, ignoreUndefined));
}

/**
 * After template rendering, remove any ## heading sections whose body content
 * is empty (only whitespace, blank lines, or the literal string 'null').
 * IMPORTANT: Only removes sections that originally contained {{variable}} placeholders.
 * Sections without {{}} (user's own note sections) are always preserved.
 */
export function removeEmptyBodySections(rendered: string, originalTemplate: string): string {
	// Build set of heading names that had {{variable}} in the original template
	const headingsWithVars = new Set<string>();
	for (const part of originalTemplate.split(/(?=^## )/m)) {
		if (!part.startsWith('## ')) continue;
		if (/\{\{.*?\}\}/.test(part)) {
			const heading = part.split('\n')[0].replace(/^## /, '').trim().toLowerCase();
			headingsWithVars.add(heading);
		}
	}

	const parts = rendered.split(/(?=^## )/m);
	const kept: string[] = [];

	for (const part of parts) {
		if (!part.startsWith('## ')) {
			// Preamble — always keep
			kept.push(part);
			continue;
		}

		const heading = part.split('\n')[0].replace(/^## /, '').trim().toLowerCase();
		const nlIdx = part.indexOf('\n');
		const body = nlIdx !== -1 ? part.slice(nlIdx + 1) : '';

		const bodyText = body
			.replace(/^---$/gm, '')
			.replace(/\bnull\b/g, '')
			.trim();

		if (bodyText.length > 0) {
			// Has content — always keep
			kept.push(part);
		} else if (!headingsWithVars.has(heading)) {
			// No {{variable}} in original template — user section, keep even if empty
			kept.push(part);
		}
		// else: was a {{variable}} section with empty/null result — silently skip
	}

	return kept.join('');
}

function replaceTag(match: string, mediaTypeModel: MediaTypeModel, ignoreUndefined: boolean): string {
	let tag = match;
	tag = tag.substring(2);
	tag = tag.substring(0, tag.length - 2);
	tag = tag.trim();

	const parts = tag.split(':');
	if (parts.length === 1) {
		const path = parts[0].split('.');

		const obj = traverseMetaData(path, mediaTypeModel);

		if (obj === undefined) {
			return ignoreUndefined ? '' : '{{ INVALID TEMPLATE TAG - object undefined }}';
		}
		// year: 0 means "unknown" — return empty string so filename templates stay clean (e.g. "Title ()")
		if (path[path.length - 1] === 'year' && obj === 0) {
			return '';
		}

		// eslint-disable-next-line @typescript-eslint/no-base-to-string
		return obj?.toString() ?? 'null';
	} else if (parts.length === 2) {
		const operator = parts[0];

		const path = parts[1].split('.');

		const obj = traverseMetaData(path, mediaTypeModel);

		if (obj === undefined) {
			return ignoreUndefined ? '' : '{{ INVALID TEMPLATE TAG - object undefined }}';
		}

		if (operator === 'LIST') {
			if (!Array.isArray(obj)) {
				return '{{ INVALID TEMPLATE TAG - operator LIST is only applicable on an array }}';
			}

			return obj.map((e: unknown) => `- ${e}`).join('\n');
		} else if (operator === 'ENUM') {
			if (!Array.isArray(obj)) {
				return '{{ INVALID TEMPLATE TAG - operator ENUM is only applicable on an array }}';
			}
			return obj.join(', ');
		} else if (operator === 'FIRST') {
			if (!Array.isArray(obj)) {
				return '{{ INVALID TEMPLATE TAG - operator FIRST is only applicable on an array }}';
			}

			const first = obj[0] as unknown;
			return first?.toString() ?? 'null';
		} else if (operator === 'LAST') {
			if (!Array.isArray(obj)) {
				return '{{ INVALID TEMPLATE TAG - operator LAST is only applicable on an array }}';
			}

			const last = obj[obj.length - 1] as unknown;
			return last?.toString() ?? 'null';
		}

		return `{{ INVALID TEMPLATE TAG - unknown operator ${operator} }}`;
	}

	return '{{ INVALID TEMPLATE TAG }}';
}

function traverseMetaData(path: string[], mediaTypeModel: MediaTypeModel): unknown {
	let o: unknown = mediaTypeModel;

	for (const part of path) {
		if (o !== undefined) {
			o = (o as Record<string, unknown>)[part];
		}
	}

	return o;
}

export function markdownTable(content: string[][]): string {
	const rows = content.length;
	if (rows === 0) {
		return '';
	}

	const columns = content[0].length;
	if (columns === 0) {
		return '';
	}
	for (const row of content) {
		if (row.length !== columns) {
			return '';
		}
	}

	const longestStringInColumns: number[] = [];

	for (let i = 0; i < columns; i++) {
		let longestStringInColumn = 0;
		for (const row of content) {
			if (row[i].length > longestStringInColumn) {
				longestStringInColumn = row[i].length;
			}
		}

		longestStringInColumns.push(longestStringInColumn);
	}

	let table = '';

	for (let i = 0; i < rows; i++) {
		table += '|';
		for (let j = 0; j < columns; j++) {
			let element = content[i][j];
			element += ' '.repeat(longestStringInColumns[j] - element.length);
			table += ' ' + element + ' |';
		}
		table += '\n';
		if (i === 0) {
			table += '|';
			for (let j = 0; j < columns; j++) {
				table += ' ' + '-'.repeat(longestStringInColumns[j]) + ' |';
			}
			table += '\n';
		}
	}

	return table;
}

export function fragWithHTML(html: string): DocumentFragment {
	return createFragment(frag => (frag.createDiv().innerHTML = html));
}

export function dateToString(date: Date): string {
	return `${date.getMonth() + 1}-${date.getDate()}-${date.getFullYear()}`;
}

export function timeToString(time: Date): string {
	return `${time.getHours()}-${time.getMinutes()}-${time.getSeconds()}`;
}

export function dateTimeToString(dateTime: Date): string {
	return `${dateToString(dateTime)} ${timeToString(dateTime)}`;
}

// js can't even implement modulo correctly...
export function mod(n: number, m: number): number {
	return ((n % m) + m) % m;
}

export function capitalizeFirstLetter(string: string): string {
	return string.charAt(0).toUpperCase() + string.slice(1);
}

export class PropertyMappingValidationError extends Error {
	constructor(message: string) {
		super(message);
	}
}

export class PropertyMappingNameConflictError extends Error {
	constructor(message: string) {
		super(message);
	}
}

/**
 * - attachTemplate: whether to attach the template (DEFAULT: false)
 * - attachFie: a file to attach (DEFAULT: undefined)
 * - openNote: whether to open the note after creation (DEFAULT: false)
 * - folder: folder to put the note in
 */
export interface CreateNoteOptions {
	attachTemplate?: boolean;
	attachFile?: TFile;
	openNote?: boolean;
	folder?: TFolder;
	overwrite?: boolean;
	preservePropertyOrder?: boolean;
	updateBody?: boolean;
	ignoredSections?: string[];
}

/** Runtime in whole minutes (TMDB/OMDb/MAL). 0 when unknown. Parses legacy string frontmatter (e.g. "136 min", "2 hr 5 min"). */
export function coerceMovieDurationMinutes(value: unknown): number {
	if (value === undefined || value === null) {
		return 0;
	}
	if (typeof value === 'number') {
		const n = Math.trunc(value);
		return Number.isFinite(n) && n >= 0 ? n : 0;
	}
	if (typeof value === 'string') {
		const t = value.trim();
		if (t === '' || t.toLowerCase() === 'unknown' || t.toUpperCase() === 'N/A' || t === 'TBA') {
			return 0;
		}
		let total = 0;
		const hours = (/(\d+)\s*(?:hours?|hrs?)\b/i.exec(t)) ?? (/(\d+)\s*h\b/i.exec(t));
		const mins = (/(\d+)\s*(?:minutes?|mins?)\b/i.exec(t)) ?? (/(\d+)\s*min\b/i.exec(t));
		if (hours) {
			total += parseInt(hours[1], 10) * 60;
		}
		if (mins) {
			total += parseInt(mins[1], 10);
		}
		if (total > 0) {
			return total;
		}
		const n = parseInt(t, 10);
		return Number.isFinite(n) && n >= 0 ? n : 0;
	}
	return 0;
}

/** Normalizes release year for metadata: integer, 0 when unknown or non-numeric. */
export function coerceYear(value: unknown): number {
	if (value === undefined || value === null) return 0;
	if (typeof value === 'number') {
		const n = Math.trunc(value);
		return Number.isFinite(n) ? n : 0;
	}
	if (typeof value === 'string') {
		const t = value.trim();
		if (t === '' || t.toLowerCase() === 'unknown' || t === 'TBA' || t.toUpperCase() === 'N/A') {
			return 0;
		}
		const n = parseInt(t, 10);
		return Number.isFinite(n) ? n : 0;
	}
	return 0;
}

export function migrateObject<T extends object>(object: T, oldData: Record<string, unknown>, defaultData: T): void {
	for (const key in object) {
		const has = Object.hasOwn(oldData, key) && oldData[key] !== undefined && oldData[key] !== null;
		if (!has) {
			object[key] = defaultData[key];
			continue;
		}
		let raw = oldData[key];
		if (key === 'year') {
			(object as Record<string, unknown>)[key] = coerceYear(raw);
			continue;
		}
		if (typeof raw === 'string' && (key === 'title' || key === 'englishTitle')) {
			raw = raw.replace(/#/g, '').replace(/\s+/g, ' ').trim();
		}
		object[key] = raw as T[typeof key];
	}
}

export function unCamelCase(str: string): string {
	return (
		str
			// insert a space between lower & upper
			.replace(/([a-z])([A-Z])/g, '$1 $2')
			// space before last upper in a sequence followed by lower
			.replace(/\b([A-Z]+)([A-Z])([a-z])/, '$1 $2$3')
			// uppercase the first character
			.replace(/^./, function (str) {
				return str.toUpperCase();
			})
	);
}

/** User-facing label for a media type (e.g. MusicRelease → Album). */
export function mediaTypeDisplayName(mediaType: MediaType): string {
	if (mediaType === MediaType.MusicRelease) {
		return 'Album';
	}
	return unCamelCase(mediaType);
}

/* eslint-disable */

export function hasTemplaterPlugin(app: App): boolean {
	const templater = (app as any).plugins.plugins['templater-obsidian'];

	return !!templater;
}

// Copied from https://github.com/anpigon/obsidian-book-search-plugin
// Licensed under the MIT license. Copyright (c) 2020 Jake Runzer
export async function useTemplaterPluginInFile(app: App, file: TFile): Promise<void> {
	const templater = (app as any).plugins.plugins['templater-obsidian'];
	if (templater && !templater?.settings.trigger_on_file_creation) {
		await templater.templater.overwrite_file_commands(file);
	}
}

/* eslint-enable */

/** Whole USD amounts as used by TMDB (empty when unknown or non-positive). */
export function formatUsdWholeDollars(amount: number): string {
	if (!Number.isFinite(amount) || amount <= 0) {
		return '';
	}
	return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

export type ModelToData<T> = {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
	[K in keyof T as T[K] extends Function ? never : K]?: T[K] | null;
};

// Checks if a given URL points to an existing image (status 200), or returns false for 404/other errors.

export async function imageUrlExists(url: string): Promise<boolean> {
	try {
		// @ts-ignore
		const response = await requestUrl({
			url,
			method: 'HEAD',
			throw: false,
		});
		return response.status === 200;
	} catch {
		return false;
	}
}

export function isTruthy<T>(value: T): value is Exclude<T, false | 0 | '' | null | undefined> {
	return Boolean(value);
}

/**
 * Wraps Obsidians `requestUrl` in a fetch like API.
 */
export async function obsidianFetch(input: Request): Promise<Response> {
	const obs_headers: Record<string, string> = {};
	input.headers.forEach((header, value) => {
		obs_headers[header] = value;
	});

	const res = await requestUrl({
		url: input.url,
		method: input.method,
		headers: obs_headers,
		throw: false, // Do not throw on error, handle it manually
	});

	const responseHeaders: Headers = new Headers();
	for (const [key, value] of Object.entries(res.headers)) {
		responseHeaders.append(key, value);
	}

	return {
		ok: res.status >= 200 && res.status < 300,
		status: res.status,
		headers: responseHeaders,
		// eslint-disable-next-line
		json: async () => res.json,
		text: async () => res.text,
	} as Response;
}

export function getLanguageName(code: string): string | null {
	const language = iso6392.find(lang => lang.iso6392B === code || lang.iso6392T === code);

	return language?.name ?? null;
}

export function normalizeTitleForAsciiAlias(title: string): string | null {
	const normalized = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
	if (normalized !== title) return normalized;
	return null;
}

export function parseUsdWholeDollarsFromDisplayString(value: string): number | null {
	const cleaned = value.replace(/[^0-9]/g, '');
	if (cleaned) return parseInt(cleaned, 10);
	return null;
}

export interface NoteSection {
	heading: string;
	originalHeading: string;
	content: string;
}

export function parseNoteBody(body: string): { preamble: string; sections: NoteSection[] } {
	const parts = body.split(/(?=^## )/m);
	let preamble = '';
	const sections: NoteSection[] = [];

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (i === 0 && !part.startsWith('## ')) {
			preamble = part;
			continue;
		}

		if (part.startsWith('## ')) {
			const newlineIndex = part.indexOf('\n');
			const headingLine = newlineIndex !== -1 ? part.slice(0, newlineIndex) : part;
			const content = newlineIndex !== -1 ? part.slice(newlineIndex + 1) : '';

			const headingTitle = headingLine.replace(/^##\s+/, '').trim();
			sections.push({
				heading: headingTitle.toLowerCase(),
				originalHeading: headingLine,
				content: content,
			});
		} else {
			preamble += part;
		}
	}
	return { preamble, sections };
}

export function mergeNoteBodies(existingBody: string, renderedTemplateBody: string, ignoredSections: string[] = []): string {
	const existing = parseNoteBody(existingBody);
	const template = parseNoteBody(renderedTemplateBody);

	const mergedSections: NoteSection[] = [];

	// Use template.sections as the base order
	for (const tSec of template.sections) {
		const existingIndex = existing.sections.findIndex(s => s.heading === tSec.heading);
		if (existingIndex !== -1) {
			const extSec = existing.sections[existingIndex];
			if (ignoredSections.includes(tSec.heading)) {
				mergedSections.push({
					heading: tSec.heading,
					originalHeading: extSec.originalHeading,
					content: extSec.content,
				});
			} else {
				mergedSections.push({
					heading: tSec.heading,
					originalHeading: tSec.originalHeading,
					content: tSec.content,
				});
			}
		} else {
			mergedSections.push(tSec);
		}
	}

	// Append any leftover sections from the existing note that are not in the template
	for (const extSec of existing.sections) {
		const templateIndex = template.sections.findIndex(s => s.heading === extSec.heading);
		if (templateIndex === -1) {
			mergedSections.push(extSec);
		}
	}

	// Re-construct the merged body
	let mergedBody = template.preamble.trimEnd();
	if (mergedBody.length > 0) {
		mergedBody += '\n\n';
	}

	for (let i = 0; i < mergedSections.length; i++) {
		const sec = mergedSections[i];
		const sectionText = sec.originalHeading.trim() + '\n' + sec.content.trim();
		mergedBody += sectionText;
		if (i < mergedSections.length - 1) {
			mergedBody += '\n\n';
		} else {
			mergedBody += '\n'; // final newline
		}
	}

	return mergedBody;
}
