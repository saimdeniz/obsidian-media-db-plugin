import { createMemo, For, Show, createSignal, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import { Portal } from 'solid-js/web';
import { PropertyMappingModel, PropertyMappingOption, propertyMappingOptions, type PropertyMappingModelData } from './PropertyMapping';
import type { MediaType } from '../utils/MediaType';
import { mediaTypeDisplayName } from '../utils/Utils';
import Icon from './Icon';

interface SolidDropdownProps {
	value: string;
	options: { value: string; display: string }[];
	onChange: (value: string) => void;
}

function SolidDropdown(props: SolidDropdownProps) {
	const [isOpen, setIsOpen] = createSignal(false);
	const [coords, setCoords] = createSignal({ top: 0, left: 0, width: 0 });
	let containerRef: HTMLDivElement | undefined;
	let triggerRef: HTMLDivElement | undefined;

	const handleOutsideClick = (e: MouseEvent) => {
		if (containerRef && !containerRef.contains(e.target as Node)) {
			setIsOpen(false);
		}
	};

	document.addEventListener('click', handleOutsideClick);
	onCleanup(() => {
		document.removeEventListener('click', handleOutsideClick);
	});

	const selectedOption = () => props.options.find(opt => opt.value === props.value);

	const toggleOpen = (e: MouseEvent) => {
		e.stopPropagation();
		if (!isOpen() && triggerRef) {
			const rect = triggerRef.getBoundingClientRect();
			setCoords({
				top: rect.bottom + 4,
				left: rect.left,
				width: rect.width,
			});
		}
		setIsOpen(!isOpen());
	};

	return (
		<div ref={containerRef} class="media-db-custom-dropdown" style={{ width: '100%' }}>
			<div
				ref={triggerRef}
				class="media-db-custom-dropdown-trigger"
				tabIndex={0}
				onClick={toggleOpen}
				onKeyDown={e => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						if (!isOpen() && triggerRef) {
							const rect = triggerRef.getBoundingClientRect();
							setCoords({
								top: rect.bottom + 4,
								left: rect.left,
								width: rect.width,
							});
						}
						setIsOpen(!isOpen());
					} else if (e.key === 'Escape') {
						setIsOpen(false);
					}
				}}
			>
				<span class="media-db-custom-dropdown-value">{selectedOption() ? selectedOption()!.display : props.value}</span>
				<span class="media-db-custom-dropdown-arrow">
					<svg
						viewBox="0 0 24 24"
						width="16"
						height="16"
						stroke="currentColor"
						stroke-width="2"
						fill="none"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="media-db-chevron-icon"
						style={isOpen() ? { transform: 'rotate(180deg)' } : {}}
					>
						<polyline points="6 9 12 15 18 9"></polyline>
					</svg>
				</span>
			</div>
			<Portal>
				<Show when={isOpen()}>
					<div
						class="media-db-custom-dropdown-menu is-open"
						style={{
							position: 'fixed',
							top: `${coords().top}px`,
							left: `${coords().left}px`,
							width: `${coords().width}px`,
							'min-width': '100px',
							'z-index': 9999,
						}}
					>
						<For each={props.options}>
							{option => (
								<div
									class={`media-db-custom-dropdown-item ${option.value === props.value ? 'is-selected' : ''}`}
									onClick={e => {
										e.stopPropagation();
										props.onChange(option.value);
										setIsOpen(false);
									}}
								>
									{option.display}
								</div>
							)}
						</For>
					</div>
				</Show>
			</Portal>
		</div>
	);
}

interface PropertyMappingModelComponentProps {
	model: PropertyMappingModelData;
	save: (model: PropertyMappingModelData) => void;
	/** When false, hides the media-type heading (e.g. modal title already shows it). Default true. */
	showMediaTypeTitle?: boolean;
}

export default function PropertyMappingModelComponent(props: PropertyMappingModelComponentProps) {
	// Create a store from the model's plain data
	const [modelData, setModelData] = createStore(props.model);

	// Derive the validation result reactively
	const validationResult = createMemo(() => {
		const model = PropertyMappingModel.fromJSON(modelData);
		return model.validate();
	});

	let draggedIndex: number | null = null;

	const onDragStart = (e: DragEvent, index: number) => {
		draggedIndex = index;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			// Firefox requires data to be set to drag
			e.dataTransfer.setData('text/plain', index.toString());
		}
	};

	const onDragOver = (e: DragEvent, index: number) => {
		e.preventDefault();
		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = 'move';
		}
	};

	const onDrop = (e: DragEvent, dropIndex: number) => {
		e.preventDefault();
		if (draggedIndex === null || draggedIndex === dropIndex) {
			draggedIndex = null;
			return;
		}

		const newProperties = [...modelData.properties];
		const item = newProperties.splice(draggedIndex, 1)[0];
		newProperties.splice(dropIndex, 0, item);

		setModelData('properties', newProperties);
		persistIfValid();
		draggedIndex = null;
	};

	const persistIfValid = () => {
		const model = PropertyMappingModel.fromJSON(modelData);
		if (model.validate().res) {
			props.save(model);
		}
	};

	const showTitle = () => props.showMediaTypeTitle !== false;

	return (
		<div class="media-db-plugin-property-mappings-model-container">
			<Show when={showTitle()}>
				<div class="media-db-plugin-property-mappings-model-header">
					<div class="setting-item-name">{mediaTypeDisplayName(modelData.type as MediaType)}</div>
				</div>
			</Show>

			<Show when={!validationResult().res}>
				<div class="media-db-plugin-property-mapping-validation">{validationResult().err?.message}</div>
			</Show>

			<div class="media-db-plugin-property-mappings-table-container">
				<table class="media-db-plugin-property-mappings-table">
					<thead>
						<tr>
							<th class="col-drag"></th>
							<th class="col-property">Property</th>
							<th class="col-mapping">Mapping</th>
							<th class="col-new-name">New name</th>
							<th class="col-tag-prefix"></th>
							<th class="col-tag">Tag</th>
							<th class="col-wikilink">Wikilink</th>
							<th class="col-pin">Pin</th>
						</tr>
					</thead>
					<tbody>
						<For each={modelData.properties}>
							{(property, index) => (
								<tr
									draggable={!property.locked}
									onDragStart={e => onDragStart(e, index())}
									onDragOver={e => onDragOver(e, index())}
									onDrop={e => onDrop(e, index())}
									style={{
										cursor: property.locked ? 'default' : 'grab',
									}}
								>
									<td class="col-drag">
										<Show when={!property.locked}>
											<span class="media-db-plugin-drag-handle" style="cursor: grab; opacity: 0.5;">
												≡
											</span>
										</Show>
									</td>
									<td class="col-property">
										<code>{property.property}</code>
									</td>

									<Show
										when={!property.locked}
										fallback={
											<td class="col-locked" colspan={6}>
												<div class="media-db-plugin-property-binding-text">property cannot be remapped</div>
											</td>
										}
									>
										<td class="col-mapping">
											<SolidDropdown
												value={property.mapping}
												options={propertyMappingOptions.map(opt => ({
													value: opt,
													display: opt === 'default' ? 'Default' : opt === 'remap' ? 'Remap' : 'Remove',
												}))}
												onChange={value => {
													setModelData('properties', index(), 'mapping', value as PropertyMappingOption);
													setModelData('properties', index(), 'newProperty', '');
													persistIfValid();
												}}
											/>
										</td>

										<td class="col-new-name">
											<Show
												when={property.mapping === PropertyMappingOption.Map}
												fallback={<span class="media-db-plugin-property-mapping-to-disabled">—</span>}
											>
												<div class="media-db-plugin-property-mapping-to">
													<Icon iconName="arrow-right" />
													<input
														class="media-db-plugin-property-mapping-input"
														type="text"
														spellcheck={false}
														value={property.newProperty}
														onInput={e => {
															setModelData('properties', index(), 'newProperty', e.currentTarget.value);
															persistIfValid();
														}}
													/>
												</div>
											</Show>
										</td>

										<td class="col-tag-prefix">
											<Show when={property.autoTag}>
												<input
													class="media-db-plugin-tag-prefix-input"
													type="text"
													placeholder="prefix"
													spellcheck={false}
													title="Optional tag prefix (e.g. 'genre' → 'genre/action')"
													value={property.autoTagPrefix ?? ''}
													onInput={e => {
														setModelData('properties', index(), 'autoTagPrefix', e.currentTarget.value);
														persistIfValid();
													}}
												/>
											</Show>
										</td>

										<td class="col-tag">
											<label class="media-db-plugin-property-mapping-pin-label" title="Generate Obsidian tags from this property's values">
												<input
													type="checkbox"
													checked={property.autoTag}
													onChange={e => {
														setModelData('properties', index(), 'autoTag', e.currentTarget.checked);
														persistIfValid();
													}}
												/>
											</label>
										</td>

										<td class="col-wikilink">
											<label class="media-db-plugin-property-mapping-wikilink-label" title="Convert value to wikilink ([[value]])">
												<input
													type="checkbox"
													checked={property.wikilink}
													onChange={e => {
														setModelData('properties', index(), 'wikilink', e.currentTarget.checked);
														persistIfValid();
													}}
												/>
											</label>
										</td>

										<td class="col-pin">
											<label class="media-db-plugin-property-mapping-pin-label" title="Pin this property below custom template variables">
												<input
													type="checkbox"
													checked={property.pinBottom}
													onChange={e => {
														setModelData('properties', index(), 'pinBottom', e.currentTarget.checked);
														persistIfValid();
													}}
												/>
											</label>
										</td>
									</Show>
								</tr>
							)}
						</For>
					</tbody>
				</table>
			</div>
		</div>
	);
}
