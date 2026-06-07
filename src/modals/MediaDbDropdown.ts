import { ValueComponent } from 'obsidian';

export class MediaDbDropdown extends ValueComponent<string> {
	private containerEl: HTMLElement;
	private options: { value: string; display: string }[] = [];
	private selectedValue: string = '';

	public selectEl: HTMLDivElement;
	private triggerEl: HTMLDivElement;
	private valueTextEl: HTMLSpanElement;
	private chevronEl: HTMLSpanElement;
	private menuEl: HTMLDivElement;

	private isOpen = false;
	private changeListeners: ((value: string) => void)[] = [];

	constructor(containerEl: HTMLElement) {
		super();
		this.containerEl = containerEl;

		// Create main wrapper
		this.selectEl = this.containerEl.createDiv({ cls: 'media-db-custom-dropdown' });

		// Create trigger button
		this.triggerEl = this.selectEl.createDiv({ cls: 'media-db-custom-dropdown-trigger' });
		this.triggerEl.setAttribute('tabindex', '0');

		this.valueTextEl = this.triggerEl.createEl('span', { cls: 'media-db-custom-dropdown-value' });

		this.chevronEl = this.triggerEl.createEl('span', { cls: 'media-db-custom-dropdown-arrow' });
		this.chevronEl.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="media-db-chevron-icon"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

		// Create menu container in memory (will be portaled to body on open)
		this.menuEl = document.createElement('div');
		this.menuEl.className = 'media-db-custom-dropdown-menu';

		// Event Listeners
		this.triggerEl.addEventListener('click', e => {
			e.stopPropagation();
			this.toggle();
		});

		this.triggerEl.addEventListener('keydown', e => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				this.toggle();
			} else if (e.key === 'ArrowDown' && this.isOpen) {
				e.preventDefault();
				this.focusNextOption(1);
			} else if (e.key === 'ArrowUp' && this.isOpen) {
				e.preventDefault();
				this.focusNextOption(-1);
			} else if (e.key === 'Escape' && this.isOpen) {
				e.preventDefault();
				this.close();
			}
		});

		document.addEventListener('click', this.handleOutsideClick);
	}

	private handleOutsideClick = (e: MouseEvent): void => {
		if (this.isOpen && !this.selectEl.contains(e.target as Node)) {
			this.close();
		}
	};

	addOption(value: string, display: string): this {
		this.options.push({ value, display });
		if (!this.selectedValue && this.options.length === 1) {
			this.setValue(value);
		}
		this.renderMenu();
		return this;
	}

	addOptions(options: Record<string, string>): this {
		for (const [value, display] of Object.entries(options)) {
			this.options.push({ value, display });
		}
		this.renderMenu();
		return this;
	}

	getValue(): string {
		return this.selectedValue;
	}

	setValue(value: string): this {
		this.selectedValue = value;
		const option = this.options.find(opt => opt.value === value);
		this.valueTextEl.setText(option ? option.display : value);
		this.updateSelectedOptionStyle();
		return this;
	}

	onChange(callback: (value: string) => void): this {
		this.changeListeners.push(callback);
		return this;
	}

	private triggerChange(value: string): void {
		for (const cb of this.changeListeners) {
			cb(value);
		}
	}

	private toggle(): void {
		if (this.isOpen) {
			this.close();
		} else {
			this.open();
		}
	}

	private open(): void {
		if (this.isOpen) return;
		this.isOpen = true;

		// Append to body and calculate position
		document.body.appendChild(this.menuEl);
		const rect = this.triggerEl.getBoundingClientRect();
		this.menuEl.style.top = `${rect.bottom + 4}px`;
		this.menuEl.style.left = `${rect.left}px`;
		this.menuEl.style.width = `${rect.width}px`;
		this.menuEl.style.minWidth = '140px';

		// Trigger CSS layout recalculation to run animations
		this.menuEl.getBoundingClientRect();

		this.selectEl.addClass('is-open');
		this.menuEl.addClass('is-open');

		const activeItem = this.menuEl.querySelector('.media-db-custom-dropdown-item.is-selected');
		if (activeItem) {
			(activeItem as HTMLElement).focus();
		}
	}

	private close(): void {
		if (!this.isOpen) return;
		this.isOpen = false;
		this.selectEl.removeClass('is-open');
		this.menuEl.removeClass('is-open');
		this.triggerEl.focus();

		// Wait for closing transition, then remove from DOM
		setTimeout(() => {
			if (!this.isOpen) {
				this.menuEl.remove();
			}
		}, 150);
	}

	private renderMenu(): void {
		this.menuEl.empty();

		this.options.forEach(option => {
			const itemEl = this.menuEl.createDiv({
				cls: 'media-db-custom-dropdown-item',
				text: option.display,
			});
			itemEl.setAttribute('tabindex', '-1');
			itemEl.setAttribute('data-value', option.value);

			if (option.value === this.selectedValue) {
				itemEl.addClass('is-selected');
			}

			itemEl.addEventListener('click', e => {
				e.stopPropagation();
				this.selectValue(option.value);
			});

			itemEl.addEventListener('keydown', e => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					e.stopPropagation();
					this.selectValue(option.value);
				} else if (e.key === 'ArrowDown') {
					e.preventDefault();
					this.focusNextOption(1);
				} else if (e.key === 'ArrowUp') {
					e.preventDefault();
					this.focusNextOption(-1);
				} else if (e.key === 'Escape') {
					e.preventDefault();
					this.close();
				}
			});
		});

		if (this.selectedValue) {
			const option = this.options.find(opt => opt.value === this.selectedValue);
			if (option) {
				this.valueTextEl.setText(option.display);
			}
		}
	}

	private selectValue(value: string): void {
		this.setValue(value);
		this.triggerChange(value);
		this.close();
	}

	private updateSelectedOptionStyle(): void {
		const items = this.menuEl.querySelectorAll('.media-db-custom-dropdown-item');
		items.forEach(item => {
			const itemVal = item.getAttribute('data-value');
			if (itemVal === this.selectedValue) {
				item.addClass('is-selected');
			} else {
				item.removeClass('is-selected');
			}
		});
	}

	private focusNextOption(direction: number): void {
		const items = Array.from(this.menuEl.querySelectorAll<HTMLElement>('.media-db-custom-dropdown-item'));
		if (items.length === 0) return;

		const activeElement = document.activeElement;
		let index = activeElement instanceof HTMLElement ? items.indexOf(activeElement) : -1;

		if (index === -1) {
			index = direction === 1 ? 0 : items.length - 1;
		} else {
			index = (index + direction + items.length) % items.length;
		}

		items[index].focus();
	}

	public destroy(): void {
		document.removeEventListener('click', this.handleOutsideClick);
		this.menuEl.remove();
	}
}
