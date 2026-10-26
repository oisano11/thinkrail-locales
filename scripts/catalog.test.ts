import { describe, expect, test } from "bun:test";
import { acceptable, completePlurals, validateCatalog } from "./catalog";
import { catalogDrift, neededKeys } from "./drift";

const english = {
	"a.plain": "Save",
	"a.placeholder": "Deleted {{count}} files",
	"a.markup": "Open <0>settings</0> to continue",
	"a.plural_one": "{{count}} file changed",
	"a.plural_other": "{{count}} files changed",
} as const;

describe("acceptable", () => {
	test("accepts a translation that keeps every placeholder", () => {
		expect(acceptable(english, "a.placeholder", "已删除 {{count}} 个文件")).toBe(true);
	});

	test("rejects a translation that drops a placeholder", () => {
		expect(acceptable(english, "a.placeholder", "已删除文件")).toBe(false);
	});

	test("rejects a translation that drops a markup marker", () => {
		expect(acceptable(english, "a.markup", "打开设置继续")).toBe(false);
	});

	test("compares markup markers as a set, not a sequence", () => {
		// The app compares the sorted tag lists, so a translation may move a marker relative to the
		// sentence as long as it keeps the same markers. It may not invent or drop one.
		expect(acceptable(english, "a.markup", "继续 <0>设置</0>")).toBe(true);
		expect(acceptable(english, "a.markup", "<0>设置</0> 继续")).toBe(true);
		expect(acceptable(english, "a.markup", "设置继续")).toBe(false);
		expect(acceptable(english, "a.markup", "<1>设置</1> 继续")).toBe(false);
	});

	test("ignores the count placeholder when comparing plural forms", () => {
		expect(acceptable(english, "a.plural_one", "{{count}} 个文件已更改")).toBe(true);
	});
});

describe("validateCatalog", () => {
	test("keeps the entries the app keeps", () => {
		const result = validateCatalog(english, {
			"a.plain": "保存",
			"a.placeholder": "已删除文件",
		});
		expect(result.ok && Object.keys(result.strings)).toEqual(["a.plain"]);
	});

	test("refuses a document that is not an object", () => {
		expect(validateCatalog(english, [])).toEqual({ ok: false, error: "not-object" });
	});
});

describe("neededKeys", () => {
	test("skips the plural forms a language never renders", () => {
		const keys = neededKeys("zh-CN", english);
		expect(keys).toContain("a.plural_other");
		expect(keys).not.toContain("a.plural_one");
	});

	test("keeps every form for a language that renders more than one", () => {
		const keys = neededKeys("en", english);
		expect(keys).toContain("a.plural_one");
		expect(keys).toContain("a.plural_other");
	});

	test("covers every plain key", () => {
		const keys = neededKeys("zh-CN", english);
		const plain = Object.keys(english).filter((key) => !/_[a-z]+$/.test(key));
		const uncovered = plain.filter((key) => !keys.includes(key));
		expect(uncovered).toEqual([]);
	});
});

describe("completePlurals", () => {
	test("fills the forms a language renders from the ones it has", () => {
		const completed = completePlurals("en", english, { "a.plural_other": "{{count}} 个文件已更改" });
		expect(completed["a.plural_one"]).toBe("{{count}} 个文件已更改");
	});

	test("adds nothing for a language with a single form", () => {
		const completed = completePlurals("zh-CN", english, { "a.plural_other": "{{count}} 个文件" });
		expect(Object.keys(completed)).toEqual(["a.plural_other"]);
	});
});

describe("catalogDrift", () => {
	test("reports a key the catalog never translated", () => {
		const drift = catalogDrift("zh-CN", english, { "a.plain": "保存" });
		expect(drift.missing).toContain("a.markup");
		expect(drift.invalid).toEqual([]);
	});

	test("reports an entry the load-time gate would drop", () => {
		const drift = catalogDrift("zh-CN", english, { "a.plain": "保存", "a.markup": "打开设置继续" });
		expect(drift.invalid).toEqual(["a.markup"]);
	});

	test("is clean when every key is translated and valid", () => {
		const drift = catalogDrift("zh-CN", english, {
			"a.plain": "保存",
			"a.placeholder": "已删除 {{count}} 个文件",
			"a.markup": "打开 <0>设置</0> 继续",
			"a.plural_other": "{{count}} 个文件已更改",
		});
		expect(drift).toEqual({ missing: [], invalid: [] });
	});

	test("does not count a plural form the language never renders", () => {
		const drift = catalogDrift("zh-CN", english, { "a.plural_other": "{{count}} 个文件" });
		expect(drift.missing).not.toContain("a.plural_one");
	});
});
