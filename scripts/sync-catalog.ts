/**
 * Translates the keys a catalog is missing, and redoes the ones the app would silently drop.
 *
 * Only ever adds or repairs entries: keys the English catalog no longer has are removed, everything
 * else is left untouched. The app falls back to English for a missing key, so a partial run is a
 * smaller improvement rather than a broken catalog.
 *
 * Usage:
 *   bun scripts/sync-catalog.ts --tag zh-CN --english <en.json> [--check] [--dry-run]
 *
 * Environment:
 *   THINKRAIL_CATALOG_API_KEY   required to translate (OpenAI-compatible bearer token)
 *   THINKRAIL_CATALOG_API_BASE  default https://openrouter.ai/api/v1
 *   THINKRAIL_CATALOG_MODEL     default deepseek/deepseek-chat
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Catalog, acceptable, completePlurals, validateCatalog } from "./catalog";
import { catalogDrift } from "./drift";

const ROOT = join(import.meta.dir, "..");
const LOCALES = join(ROOT, "locales");

const DEFAULT_API_BASE = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "deepseek/deepseek-chat";
const BATCH_SIZE = 25;
const CONCURRENCY = 3;
const ATTEMPTS = 3;

interface Options {
	readonly tag: string;
	readonly englishPath: string | null;
	readonly check: boolean;
	readonly dryRun: boolean;
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
	const index = argv.indexOf(flag);
	return index >= 0 ? argv[index + 1] : undefined;
}

function parseOptions(argv: readonly string[]): Options {
	return {
		tag: flagValue(argv, "--tag") ?? "zh-CN",
		englishPath: flagValue(argv, "--english") ?? null,
		check: argv.includes("--check"),
		dryRun: argv.includes("--dry-run"),
	};
}

function readJson(path: string): Catalog {
	if (!existsSync(path)) return {};
	return JSON.parse(readFileSync(path, "utf8")) as Catalog;
}

/**
 * Deliberately not `validateCatalog`: this needs to see the entries the app drops, otherwise a
 * broken translation looks like a finished one and never gets redone.
 */
function readCatalog(tag: string): Catalog {
	const raw = readJson(join(LOCALES, `${tag}.json`));
	const entries = Object.entries(raw).filter(
		(entry): entry is [string, string] => typeof entry[1] === "string",
	);
	return Object.fromEntries(entries);
}

function writeCatalog(tag: string, strings: Catalog): void {
	const sorted = Object.keys(strings).sort();
	const lines = sorted.map((key) => `\t${JSON.stringify(key)}: ${JSON.stringify(strings[key])}`);
	writeFileSync(join(LOCALES, `${tag}.json`), `{\n${lines.join(",\n")}\n}\n`);
}

function systemPrompt(tag: string): string {
	return [
		`You translate ThinkRail's interface strings into the locale "${tag}".`,
		"Reply with a single JSON object and nothing else: no prose, no code fence.",
		"The input object's keys are identifiers. Do not translate them; keep them byte for byte.",
		"Translate only the values.",
		"Keep every {{placeholder}} byte for byte. Keep every <0> and </0> marker, and keep the",
		"same number of them in the same order.",
		"Do not translate product names: ThinkRail, GitHub, Git, MCP, Claude, Codex, Pi.",
		"Match the register of an application interface: short, direct, no honorifics.",
		"Keys ending in _one, _other and the other plural forms are plural categories of one",
		"message: translate each form, and keep {{count}} in every one of them.",
	].join("\n");
}

function parseReply(content: string): Record<string, string> {
	const start = content.indexOf("{");
	const end = content.lastIndexOf("}");
	if (start < 0 || end <= start) throw new Error(`reply is not a JSON object: ${content.slice(0, 200)}`);
	const parsed: unknown = JSON.parse(content.slice(start, end + 1));
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("reply is not a JSON object");
	}
	return Object.fromEntries(
		Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
	);
}

async function requestBatch(
	entries: Record<string, string>,
	tag: string,
	apiBase: string,
	model: string,
	apiKey: string,
): Promise<Record<string, string>> {
	const response = await fetch(`${apiBase}/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
		body: JSON.stringify({
			model,
			temperature: 0,
			messages: [
				{ role: "system", content: systemPrompt(tag) },
				{ role: "user", content: JSON.stringify(entries, null, 2) },
			],
		}),
	});
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`);
	}
	const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
	const content = body.choices?.[0]?.message?.content;
	if (typeof content !== "string") throw new Error("reply carried no content");
	return parseReply(content);
}

async function translate(
	keys: readonly string[],
	english: Catalog,
	tag: string,
	apiBase: string,
	model: string,
	apiKey: string,
): Promise<{ translated: Record<string, string>; rejected: string[] }> {
	const translated: Record<string, string> = {};
	const rejected: string[] = [];
	const batches: string[][] = [];
	for (let index = 0; index < keys.length; index += BATCH_SIZE) {
		batches.push(keys.slice(index, index + BATCH_SIZE));
	}
	const queue = [...batches];
	const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
		for (let batch = queue.shift(); batch !== undefined; batch = queue.shift()) {
			const request = Object.fromEntries(
				batch.map((key) => [key, english[key]]).filter((e): e is [string, string] => !!e[1]),
			);
			let reply: Record<string, string> | null = null;
			for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
				try {
					reply = await requestBatch(request, tag, apiBase, model, apiKey);
					break;
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					console.warn(`  attempt ${attempt}/${ATTEMPTS} failed: ${message}`);
					if (attempt === ATTEMPTS) throw error;
					await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
				}
			}
			for (const key of batch) {
				const value = reply?.[key];
				if (value !== undefined && acceptable(english, key, value)) translated[key] = value;
				else rejected.push(key);
			}
		}
	});
	await Promise.all(workers);
	return { translated, rejected };
}

async function main(): Promise<void> {
	const options = parseOptions(process.argv.slice(2));
	if (options.englishPath === null) {
		console.error("sync-catalog: --english <en.json> is required");
		process.exit(1);
	}
	const english = readJson(options.englishPath);
	const target = readCatalog(options.tag);
	const drift = catalogDrift(options.tag, english, target);

	if (drift.missing.length === 0 && drift.invalid.length === 0) {
		console.log(
			`sync-catalog: ${options.tag} is level with the build (${Object.keys(english).length} keys)`,
		);
		return;
	}
	console.log(
		`sync-catalog: ${drift.missing.length} missing, ${drift.invalid.length} invalid for ${options.tag}`,
	);
	const todo = [...drift.missing, ...drift.invalid];
	if (options.check) {
		for (const key of todo) console.log(`  ${key}`);
		process.exitCode = 1;
		return;
	}
	if (options.dryRun) {
		for (const key of todo) console.log(`  ${key}`);
		return;
	}

	const apiKey = process.env.THINKRAIL_CATALOG_API_KEY;
	if (!apiKey) {
		console.error("sync-catalog: THINKRAIL_CATALOG_API_KEY is not set");
		process.exit(1);
	}
	const apiBase = process.env.THINKRAIL_CATALOG_API_BASE ?? DEFAULT_API_BASE;
	const model = process.env.THINKRAIL_CATALOG_MODEL ?? DEFAULT_MODEL;
	const { translated, rejected } = await translate(todo, english, options.tag, apiBase, model, apiKey);

	// Rebuild from the English key list so the catalog can never carry a key the app removed.
	const merged: Record<string, string> = {};
	for (const key of Object.keys(english)) {
		const value = translated[key] ?? target[key];
		if (value !== undefined) merged[key] = value;
	}
	const completed = completePlurals(options.tag, english, validateCatalog(english, merged).ok ? merged : {});
	writeCatalog(options.tag, completed);

	const after = catalogDrift(options.tag, english, readCatalog(options.tag));
	console.log(
		`sync-catalog: wrote ${Object.keys(translated).length} translations, ${rejected.length} rejected by the gate`,
	);
	if (after.missing.length > 0 || after.invalid.length > 0) {
		console.error(
			`sync-catalog: ${after.missing.length} still missing, ${after.invalid.length} still invalid`,
		);
		process.exitCode = 1;
	}
}

if (import.meta.main) {
	await main();
}
