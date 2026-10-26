# thinkrail-locales

Simplified Chinese (and, eventually, other languages) for [ThinkRail](https://github.com/JetBrains/thinkrail).

ThinkRail loads language files from `~/.thinkrail/locales/`, so a translation needs no build and no
release: drop a JSON file in that folder and the interface switches to it. This repo keeps those
files up to date as the app itself changes.

## What it does

A scheduled job (`.github/workflows/sync.yml`, every six hours) reads the newest published build,
downloads that build's `packages/locales/en.json`, and stops unless the catalog has drifted from it.
When it has, `scripts/sync-catalog.ts` translates **only** what is missing or broken, commits it, and
uploads the file to the [`catalogs`](https://github.com/oisano11/thinkrail-locales/releases/tag/catalogs)
release. When upstream renames a key, drops one, or rewrites a sentence, the file follows; nothing is
retranslated that already works.

A key the app cannot use is worse than a missing one: the app silently drops an entry whose
`{{placeholders}}` or `<0>…</0>` markers do not match the English, so a broken translation renders
English without saying so. Every reply is therefore checked against the same rules the app applies at
load time (`scripts/catalog.ts`), and a rejected key stays on the list instead of being written.

The job needs a `CATALOG_API_KEY` secret (an OpenAI-compatible key); optional `CATALOG_API_BASE` and
`CATALOG_MODEL` repository variables pick the backend. Without a key it still publishes the file and
leaves new keys in English, so the download never breaks.

## Use it

```sh
# straight from the release — no build, no checkout
curl -sSL -o ~/.thinkrail/locales/zh-CN.json \
  https://github.com/oisano11/thinkrail-locales/releases/download/catalogs/zh-CN.json
```

Settings → Language picks the file up within a second; no restart.

### Locally

```sh
# 1. grab the English catalog out of your installed build
bun scripts/extract-english.ts /Applications/ThinkRail.app --out /tmp/en.json

# 2. see what is missing (exit 1 when anything is)
bun scripts/sync-catalog.ts --tag zh-CN --english /tmp/en.json --check

# 3. translate it (needs an OpenAI-compatible key)
THINKRAIL_CATALOG_API_KEY=sk-… bun scripts/sync-catalog.ts --tag zh-CN --english /tmp/en.json

# 4. install it
cp locales/zh-CN.json ~/.thinkrail/locales/
```

`THINKRAIL_CATALOG_API_BASE` (default `https://openrouter.ai/api/v1`) and
`THINKRAIL_CATALOG_MODEL` (default `deepseek/deepseek-chat`) choose the backend.

## Layout

| Path | What |
|---|---|
| `locales/<tag>.json` | the catalogs, keyed exactly like `packages/locales/en.json` upstream |
| `scripts/extract-english.ts` | reads the English catalog out of a built app |
| `scripts/sync-catalog.ts` | translates the missing and the broken keys |
| `scripts/catalog.ts` | the app's load-time rules, so a translation is checked before it is written |
| `scripts/drift.ts` | what stands between a catalog and complete |

## Adding a language

`--tag` takes any tag the app accepts (`ja`, `pt-BR`, `zh-Hant`). Nothing is hardcoded to Chinese;
`locales/zh-CN.json` is simply the one that exists today.

## Why not upstream?

The translations were contributed upstream as [#866](https://github.com/JetBrains/thinkrail/pull/866)
and [#871](https://github.com/JetBrains/thinkrail/pull/871) and are merged. This repo exists because a
released build only carries the translations it was built with: a reader who installs the current
release gets whatever was translated before that build, and nothing after. Keeping the file here lets
it track the app between releases, and lets a language the project has not shipped yet work today.
