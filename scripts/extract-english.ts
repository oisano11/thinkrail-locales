/**
 * Pulls the English catalog out of an installed ThinkRail build.
 *
 * The app ships the catalog inside its renderer bundle rather than as a file, so this reads the
 * bundle and evaluates the one object literal that starts at the first key. Values are template
 * literals; converting them to JSON strings first keeps `JSON.parse` honest about escapes.
 *
 * Usage: `bun scripts/extract-english.ts <app-path> [--out <file>]`
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ANCHOR = '{"app.errorBoundary.label":';
const ASSETS = "Contents/Resources/app/views/web/assets";

export function extractEnglish(appPath: string): Record<string, string> {
	const dir = join(appPath, ASSETS);
	const candidates = readdirSync(dir).filter((name) => name.endsWith(".js"));
	for (const name of candidates) {
		const bundle = readFileSync(join(dir, name), "utf8");
		const start = bundle.indexOf(ANCHOR);
		if (start < 0) continue;
		const literal = balancedObjectAt(bundle, start);
		const asJson = literal.replace(/`((?:[^`\\]|\\.)*)`/g, (_match, body: string) =>
			JSON.stringify(body.replace(/\\`/g, "`").replace(/\\\$/g, "$").replace(/\\\\/g, "\\")),
		);
		return JSON.parse(asJson) as Record<string, string>;
	}
	throw new Error(`no catalog found under ${dir}`);
}

function balancedObjectAt(source: string, start: number): string {
	let depth = 0;
	let quote: string | null = null;
	for (let index = start; index < source.length; index++) {
		const char = source[index];
		if (quote !== null) {
			if (char === "\\") {
				index++;
				continue;
			}
			if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			continue;
		}
		if (char === "{") depth++;
		else if (char === "}") {
			depth--;
			if (depth === 0) return source.slice(start, index + 1);
		}
	}
	throw new Error("unbalanced catalog literal");
}

if (import.meta.main) {
	const appPath = process.argv[2];
	if (!appPath) {
		console.error("usage: bun scripts/extract-english.ts <app-path> [--out <file>]");
		process.exit(1);
	}
	const catalog = extractEnglish(appPath);
	const outIndex = process.argv.indexOf("--out");
	if (outIndex >= 0 && process.argv[outIndex + 1]) {
		writeFileSync(process.argv[outIndex + 1], `${JSON.stringify(catalog, null, "\t")}\n`);
	}
	console.log(`extract-english: ${Object.keys(catalog).length} keys`);
}
