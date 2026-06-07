import { MediaType } from '../utils/MediaType';
import type { ModelToData } from '../utils/Utils';
import { mediaDbTag, migrateObject } from '../utils/Utils';
import { MediaTypeModel } from './MediaTypeModel';

export type BookData = ModelToData<BookModel>;

export class BookModel extends MediaTypeModel {
	author: string;
	plot: string;
	pages: number;
	image: string;
	onlineRating: number;
	isbn: number;
	isbn13: number;
	genres: string[];
	ratingCount: number;
	seriesName: string;
	seriesNumber: number;
	publisher: string;
	language: string;
	subtitle: string;
	originalTitle: string;

	released: boolean;

	userData: {
		read: boolean;
		lastRead: string;
		personalRating: number;
	};

	constructor(obj: BookData) {
		super();

		this.author = '';
		this.plot = '';
		this.pages = 0;
		this.image = '';
		this.onlineRating = 0;
		this.isbn = 0;
		this.isbn13 = 0;
		this.genres = [];
		this.ratingCount = 0;
		this.seriesName = '';
		this.seriesNumber = 0;
		this.publisher = '';
		this.language = '';
		this.subtitle = '';
		this.originalTitle = '';

		this.released = false;

		this.userData = {
			read: false,
			lastRead: '',
			personalRating: 0,
		};

		migrateObject(this, obj, this);

		if (!Object.hasOwn(obj, 'userData')) {
			migrateObject(this.userData, obj, this.userData);
		}

		this.type = this.getMediaType();
	}

	getTags(): string[] {
		return [mediaDbTag, 'book'];
	}

	getMediaType(): MediaType {
		return MediaType.Book;
	}

	getSummary(): string {
		return this.englishTitle + (this.year > 0 ? ` (${this.year})` : '') + ' - ' + this.author;
	}

	/** isbn === 0 means unknown — write null so YAML shows blank instead of 0.
	 *  Also reorders properties so subtitle/originalTitle are adjacent to their title-related fields. */
	override getWithOutUserData(): Record<string, unknown> {
		const raw = super.getWithOutUserData();

		// Null out zero ISBNs so YAML shows blank instead of 0
		if (raw.isbn === 0) raw.isbn = null;
		if (raw.isbn13 === 0) raw.isbn13 = null;

		// Explicit property order for YAML frontmatter
		const order = [
			'type',
			'subType',
			'title',
			'subtitle', // subtitle immediately after title
			'englishTitle',
			'originalTitle', // originalTitle immediately after englishTitle
			'year',
			'dataSource',
			'url',
			'id',
			'image',
			'author',
			'plot',
			'pages',
			'onlineRating',
			'isbn',
			'isbn13',
			'genres',
			'ratingCount',
			'seriesName',
			'seriesNumber',
			'publisher',
			'language',
			'released',
		];

		const ordered: Record<string, unknown> = {};
		for (const key of order) {
			if (Object.hasOwn(raw, key)) ordered[key] = raw[key];
		}
		// Append any keys not covered by the explicit list (future-proof)
		for (const key of Object.keys(raw)) {
			if (!Object.hasOwn(ordered, key)) ordered[key] = raw[key];
		}
		return ordered;
	}
}
