/**
 * The catalog rules the ThinkRail app applies at load time, copied so this repo can enforce the same
 * gate on what it produces. A translation that breaks a placeholder or a `<0>` marker is silently
 * dropped by the app and falls back to English, so it has to be rejected here instead.
 *
 * Kept in sync with `packages/locales/src/index.ts` in JetBrains/thinkrail. The rules are deliberately
 * reimplemented rather than imported: this repo must not depend on a build of the app.
 */

export type Catalog = Readonly<Record<string, string>>;

const PLURAL_SUFFIX = /_(?:zero|one|two|few|many|other)$/;
const PLURAL_KEY = /^(.+)_(zero|one|two|few|many|other)$/;
const PARSED_TAG = /<!--[\s\S]*?-->|<[a-zA-Z0-9\-!/](?:"[^"]*"|'[^']*'|[^'">])*>/g;
const BARE_MARKER = /^<\/?\d+\/?>$/;

function placeholders(text: string, ignoreCount: boolean): string {
	const names = new Set<string>();
	for (const match of text.matchAll(/\{\{\s*([^\s,}]+)[^}]*\}\}/g)) {
		if (match[1] && !(ignoreCount && match[1] === "count")) names.add(match[1]);
	}
	if (/\{\{(?![^{}]*\}\})/.test(text)) names.add("{{");
	return [...names].sort().join("\u0000");
}

function markup(text: string): string | null {
	const tags: string[] = [];
	for (const match of text.matchAll(PARSED_TAG)) {
		if (!BARE_MARKER.test(match[0])) return null;
		tags.push(match[0]);
	}
	return tags.sort().join("\u0000");
}

function own(catalog: Catalog, key: string): string | undefined {
	return Object.hasOwn(catalog, key) ? catalog[key] : undefined;
}

function englishReference(english: Catalog, key: string): string | undefined {
	if (!PLURAL_SUFFIX.test(key)) return own(english, key);
	const base = key.replace(PLURAL_SUFFIX, "");
	return own(english, `${base}_other`) ?? own(english, key) ?? own(english, base);
}

/** True when `value` can stand in for `english[key]` without losing a placeholder or a marker. */
export function acceptable(english: Catalog, key: string, value: string): boolean {
	if (value === "" || value.includes("$t(") || /<\s*\/?\s*\{\{/.test(value)) return false;
	const shape = markup(value);
	if (shape === null) return false;
	const reference = englishReference(english, key);
	if (reference === undefined) return shape === "";
	const plural = PLURAL_SUFFIX.test(key);
	return (
		placeholders(reference, plural) === placeholders(value, plural) && markup(reference) === shape
	);
}

export function pluralCategories(tag: string): readonly string[] {
	try {
		return new Intl.PluralRules(tag).resolvedOptions().pluralCategories;
	} catch {
		return [];
	}
}

/**
 * Fills in the plural forms a language renders but the catalog leaves out, the way the app does at
 * load time. Chinese renders only `other`, so a catalog with `_one` and `_other` still works there.
 */
export function completePlurals(tag: string, english: Catalog, strings: Catalog): Catalog {
	const families = new Map<string, Map<string, string>>();
	for (const [key, value] of Object.entries(strings)) {
		const match = PLURAL_KEY.exec(key);
		if (!match?.[1] || !match[2] || own(english, `${match[1]}_other`) === undefined) continue;
		const forms = families.get(match[1]) ?? new Map<string, string>();
		forms.set(match[2], value);
		families.set(match[1], forms);
	}
	if (families.size === 0) return strings;
	const categories = pluralCategories(tag);
	const completed: Record<string, string> = { ...strings };
	for (const [base, forms] of families) {
		const source = forms.get("other") ?? forms.values().next().value;
		if (source === undefined) continue;
		for (const category of categories) {
			if (!forms.has(category)) completed[`${base}_${category}`] = source;
		}
	}
	return completed;
}

export type CatalogValidation =
	| { ok: true; strings: Catalog }
	| { ok: false; error: "not-object" };

/** The app's load-time gate: entries that fail `acceptable` are dropped, everything else is kept. */
export function validateCatalog(english: Catalog, raw: unknown): CatalogValidation {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return { ok: false, error: "not-object" };
	}
	const entries = Object.entries(raw).filter(
		(entry): entry is [string, string] =>
			typeof entry[1] === "string" && acceptable(english, entry[0], entry[1]),
	);
	return { ok: true, strings: Object.fromEntries(entries) };
}
