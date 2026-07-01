import type { App, BasesEntry, BasesPropertyId } from 'obsidian';
import { Keymap, NullValue } from 'obsidian';
import type { TFile } from 'obsidian';
import { CSS_CLASSES, DATA_ATTRIBUTES } from '../constants.ts';

export interface CardRenderCtx {
	app: App;
	doc: Document;
	groupByPropertyId: BasesPropertyId | null;
	cardTitlePropertyId: BasesPropertyId | null;
	imagePropertyId: BasesPropertyId | null;
	imageFit: string;
	imageAspectRatio: number;
	wrapValues: boolean;
	order: BasesPropertyId[];
	getDisplayName: (id: BasesPropertyId) => string;
}

export interface CardCallbacks {
	onHoverPreview: (linktext: string, sourcePath: string, event: MouseEvent, targetEl: HTMLElement) => void;
	onSetActiveCard: (path: string | null) => void;
	onOpenInBackgroundTab: (file: TFile) => void;
}

interface ListLikeValue {
	length(): number;
	get(index: number): unknown;
}

interface ResolvedImageSource {
	src: string;
	fingerprint: string;
}

interface RenderableValue {
	renderTo(el: HTMLElement, ctx: unknown): void;
}

function isListLikeValue(value: unknown): value is ListLikeValue {
	return (
		typeof value === 'object' &&
		value !== null &&
		'length' in value &&
		'get' in value &&
		typeof value.length === 'function' &&
		typeof value.get === 'function'
	);
}

function uniqueValues(values: string[]): string[] {
	return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function extractImageReferences(rawInput: string): string[] {
	const raw = rawInput.trim();
	if (!raw) return [];

	const refs: string[] = [];
	for (const match of raw.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
		refs.push(match[1].trim());
	}
	for (const match of raw.matchAll(/!?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
		refs.push(match[1].trim());
	}
	if (refs.length > 0) return uniqueValues(refs);

	if (/^https?:\/\//i.test(raw)) {
		try {
			new URL(raw);
			return [raw];
		} catch {
			// Fall through to the multi-URL extractor below.
		}
	}

	const urls = raw.match(/https?:\/\/[^\s,\])]+/gi);
	if (urls && urls.length > 0) return uniqueValues(urls);

	// Obsidian can stringify an image list as plain paths separated by spaces,
	// commas, or newlines (for example: "media/a.jpg media/b.jpg"). Treat
	// those as a gallery instead of one unresolvable linkpath.
	const localImagePaths = Array.from(
		raw.matchAll(/(?:^|[\s,])([^,\s]+?\.(?:avif|bmp|gif|jpe?g|png|svg|webp))(?=$|[\s,])/gi),
		(match) => match[1].trim(),
	);
	if (localImagePaths.length > 0) return uniqueValues(localImagePaths);

	return [raw.replace(/^!\s*/, '').trim()];
}

function hasCustomToString(value: unknown): value is { toString(): string } {
	return typeof value === 'object' && value !== null && value.toString !== Object.prototype.toString;
}

function hasRenderTo(value: unknown): value is RenderableValue {
	return typeof value === 'object' && value !== null && 'renderTo' in value && typeof value.renderTo === 'function';
}

function imageReferencesFromValue(value: unknown): string[] {
	if (!value || value instanceof NullValue) return [];
	if (isListLikeValue(value)) {
		const refs: string[] = [];
		for (let i = 0; i < value.length(); i += 1) {
			refs.push(...imageReferencesFromValue(value.get(i)));
		}
		return uniqueValues(refs);
	}
	const raw = typeof value === 'string' ? value : hasCustomToString(value) ? value.toString() : '';
	return extractImageReferences(raw);
}

function fileSignature(file: { stat?: { mtime?: number; size?: number } }): string {
	const { mtime, size } = file.stat ?? {};
	return [mtime, size].filter((part): part is number => typeof part === 'number').join('-');
}

function appendCacheKey(src: string, key: string): string {
	if (!key) return src;
	return `${src}${src.includes('?') ? '&' : '?'}v=${encodeURIComponent(key)}`;
}

function resolveImageSource(rawRef: string, filePath: string, ctx: CardRenderCtx): ResolvedImageSource | null {
	const ref = rawRef.trim();
	if (!ref) return null;
	if (/^https?:\/\//i.test(ref)) {
		return { src: ref, fingerprint: `url:${ref}` };
	}

	const app = ctx.app;
	if (!app) return null;
	const file = app.metadataCache.getFirstLinkpathDest(ref, filePath);
	if (!file) return null;

	const signature = fileSignature(file);
	const resourcePath = app.vault.getResourcePath(file);
	return {
		src: appendCacheKey(resourcePath, signature),
		fingerprint: `file:${file.path}:${signature}:${resourcePath}`,
	};
}

function imageSourcesFromRenderedValue(value: unknown, ctx: CardRenderCtx): ResolvedImageSource[] {
	if (!hasRenderTo(value)) return [];
	try {
		const scratchEl = ctx.doc.createElement('div');
		value.renderTo(scratchEl, ctx.app.renderContext);
		return Array.from(scratchEl.querySelectorAll<HTMLImageElement>('img[src]'))
			.map((img) => img.getAttribute('src')?.trim() ?? '')
			.filter((src) => src.length > 0)
			.map((src) => ({ src, fingerprint: `rendered:${src}` }));
	} catch (error) {
		console.warn('KanbanView: unable to render image property value for gallery extraction', error);
		return [];
	}
}

function sourceDedupKey(src: string): string {
	try {
		const url = new URL(src);
		url.searchParams.delete('v');
		return url.toString();
	} catch {
		return src.replace(/([?&])v=[^&]+(&|$)/, '$1').replace(/[?&]$/, '');
	}
}

function dedupeSources(sources: ResolvedImageSource[]): ResolvedImageSource[] {
	const seen = new Set<string>();
	return sources.filter((source) => {
		const key = sourceDedupKey(source.src);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function getCardImageSources(entry: BasesEntry, filePath: string, ctx: CardRenderCtx): ResolvedImageSource[] {
	if (!ctx.imagePropertyId) return [];
	const value = entry.getValue(ctx.imagePropertyId);
	const parsedSources = uniqueValues(imageReferencesFromValue(value))
		.map((ref) => resolveImageSource(ref, filePath, ctx))
		.filter((source): source is ResolvedImageSource => source !== null);
	const renderedSources = parsedSources.length <= 1 ? imageSourcesFromRenderedValue(value, ctx) : [];
	return dedupeSources([...parsedSources, ...renderedSources]);
}

export function computeCardFingerprint(entry: BasesEntry, ctx: CardRenderCtx): string {
	const parts: string[] = [];
	for (const propId of ctx.order) {
		if (propId === ctx.groupByPropertyId) continue;
		const val = entry.getValue(propId);
		parts.push(val === null ? '' : val.toString());
	}
	if (ctx.cardTitlePropertyId) {
		const val = entry.getValue(ctx.cardTitlePropertyId);
		parts.push(val === null ? '' : val.toString());
	}
	if (ctx.imagePropertyId) {
		const val = entry.getValue(ctx.imagePropertyId);
		parts.push(val === null ? '' : val.toString());
		parts.push(...getCardImageSources(entry, entry.file.path, ctx).map((source) => source.fingerprint));
	}
	return parts.join('\x00');
}

export function renderCardTitle(titleEl: HTMLElement, entry: BasesEntry, ctx: CardRenderCtx): void {
	if (!ctx.cardTitlePropertyId) {
		titleEl.textContent = entry.file.basename;
		return;
	}
	const titleValue = entry.getValue(ctx.cardTitlePropertyId);
	if (!titleValue || titleValue instanceof NullValue) {
		titleEl.textContent = entry.file.basename;
		return;
	}
	titleValue.renderTo(titleEl, ctx.app.renderContext);
}

export function renderCardCover(
	coverEl: HTMLElement,
	entry: BasesEntry,
	filePath: string,
	ctx: CardRenderCtx,
): boolean {
	const sources = getCardImageSources(entry, filePath, ctx);
	if (sources.length === 0) return false;

	if (sources.length > 1) {
		coverEl.classList.add(CSS_CLASSES.CARD_COVER_GALLERY);
	}

	sources.forEach((source) => {
		coverEl.createEl('img', { attr: { src: source.src, alt: '' } });
	});
	return true;
}

export function createCard(entry: BasesEntry, ctx: CardRenderCtx, cb: CardCallbacks): HTMLElement {
	const cardEl = ctx.doc.createElement('div');
	cardEl.className = CSS_CLASSES.CARD;
	const filePath = entry.file.path;
	cardEl.setAttribute(DATA_ATTRIBUTES.ENTRY_PATH, filePath);

	if (ctx.imagePropertyId) {
		const coverEl = cardEl.createDiv({ cls: CSS_CLASSES.CARD_COVER });
		coverEl.classList.add(
			ctx.imageFit === 'contain' ? CSS_CLASSES.CARD_COVER_FIT_CONTAIN : CSS_CLASSES.CARD_COVER_FIT_COVER,
		);
		coverEl.style.aspectRatio = `1 / ${ctx.imageAspectRatio}`;
		const rendered = renderCardCover(coverEl, entry, filePath, ctx);
		if (!rendered) coverEl.remove();
	}

	const titleEl = cardEl.createDiv({ cls: CSS_CLASSES.CARD_TITLE });
	renderCardTitle(titleEl, entry, ctx);

	for (const propertyId of ctx.order) {
		if (propertyId === ctx.groupByPropertyId || propertyId === ctx.imagePropertyId) continue;
		const value = entry.getValue(propertyId);
		if (!value || value instanceof NullValue) continue;
		if (!value.toString().trim()) continue;
		const label = ctx.getDisplayName(propertyId);
		const propertyEl = cardEl.createDiv({ cls: CSS_CLASSES.CARD_PROPERTY });
		propertyEl.setAttribute('data-label', propertyId);
		if (ctx.wrapValues) {
			propertyEl.classList.add(CSS_CLASSES.CARD_PROPERTY_WRAP);
		}
		propertyEl.createSpan({ text: label, cls: CSS_CLASSES.CARD_PROPERTY_LABEL });
		const valueEl = propertyEl.createSpan({ cls: CSS_CLASSES.CARD_PROPERTY_VALUE });
		value.renderTo(valueEl, ctx.app.renderContext);
	}

	// JS-managed hover: mouseenter/mouseleave instead of CSS :hover so the
	// class is never applied when an element slides under a stationary cursor
	// after a drag reorders the DOM.
	cardEl.addEventListener('mouseenter', () => cardEl.classList.add(CSS_CLASSES.CARD_HOVER));
	cardEl.addEventListener('mouseleave', () => cardEl.classList.remove(CSS_CLASSES.CARD_HOVER));
	cardEl.addEventListener('mouseover', (e) => {
		if (e.target instanceof Element && e.target.closest('a')) return;
		if (e.relatedTarget instanceof Element && cardEl.contains(e.relatedTarget)) return;
		cb.onHoverPreview(filePath, '', e, cardEl);
	});

	const clickHandler = (e: MouseEvent) => {
		if (e.target instanceof Element && e.target.closest('a')) return;
		if (e.type === 'auxclick' && e.button !== 1) return;
		cb.onSetActiveCard(filePath);
		if (!ctx.app?.workspace) return;
		if (e.button === 1) {
			cb.onOpenInBackgroundTab(entry.file);
			return;
		}
		void ctx.app.workspace.openLinkText(filePath, '', Keymap.isModEvent(e));
	};
	cardEl.addEventListener('click', clickHandler);
	cardEl.addEventListener('auxclick', clickHandler);

	// Prevent middle-click autoscroll inside cards.
	cardEl.addEventListener('mousedown', (e) => {
		if (e.button !== 1) return;
		if (e.target instanceof Element && e.target.closest('a')) return;
		e.preventDefault();
	});

	return cardEl;
}
