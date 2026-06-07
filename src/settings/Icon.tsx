import { onMount, Show } from 'solid-js';
import { setIcon } from 'obsidian';

interface IconProps {
	iconName?: string;
}

export default function Icon(props: IconProps) {
	let iconEl: HTMLDivElement | undefined;

	onMount(() => {
		if (iconEl) {
			setIcon(iconEl, props.iconName || '');
		}
	});

	return (
		<Show when={(props.iconName || '').length > 0}>
			<div class="media-db-plugin-icon-wrapper">
				<div ref={iconEl} class="media-db-plugin-icon"></div>
			</div>
		</Show>
	);
}
