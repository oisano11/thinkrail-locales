import { type Catalog, completePlurals, validateCatalog } from "./catalog";

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

export interface CatalogDrift {
	/** Keys this language renders but the catalog has no usable string for. */
	readonly missing: readonly string[];
	/** Keys the catalog carries that validation silently drops, so they render English. */
	readonly invalid: readonly string[];
}

/**
 * The keys this language actually renders. Chinese resolves to `["other"]`, so a catalog that only
 * carries `_other` is complete there — counting the missing `_one` would invent work that changes
 * nothing on screen.
 */
export function neededKeys(tag: string, english: Catalog): string[] {
	const categories = new Set(pluralCategories(tag));
	return Object.keys(english).filter((key) => {
		const form = PLURAL_SUFFIX.exec(key)?.[1];
		return form === undefined || categories.has(form);
	});
}

export function pluralCategories(tag: string): readonly string[] {
	try {
		return new Intl.PluralRules(tag).resolvedOptions().pluralCategories;
	} catch {
		return [];
	}
}

/**
 * What stands between `target` and a complete catalog for `tag`. `missing` is work to do; `invalid`
 * is work to redo — those entries exist but the app drops them, so they render English today.
 */
export function catalogDrift(tag: string, english: Catalog, target: Catalog): CatalogDrift {
	const validation = validateCatalog(english, target);
	const usable: Catalog = validation.ok ? validation.strings : {};
	const completed = completePlurals(tag, english, usable);
	const missing = neededKeys(tag, english).filter((key) => !Object.hasOwn(completed, key));
	const invalid = Object.keys(target).filter(
		(key) => Object.hasOwn(english, key) && !Object.hasOwn(usable, key),
	);
	return { missing, invalid };
}
