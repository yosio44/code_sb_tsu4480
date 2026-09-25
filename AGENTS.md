# AGENTS.md

## Cursor Cloud specific instructions

This is a single, minimal vanilla-JS sandbox bundled with **Parcel v1** (`parcel-bundler`). There is no backend, database, or external service for the Parcel demo. Scripts live in `package.json`; the active entry is `index.html` → `src/index3.js`.

- Dependencies are installed by the startup update script (`npm install`). A `package-lock.json` is committed, so `npm install` resolves against it (use `npm ci` for a clean, lockfile-exact install).
- Dev server: run `npx parcel index.html --port 1234` rather than `npm start`. The `npm start` script appends `--open`, which tries to launch a browser and is not useful in a headless VM. Default port is `1234`.
- Build: `npm run build` (outputs to `dist/`). There is no separate prod server; serve `dist/` statically if needed.
- No lint or test scripts are defined in this repo.
- The app only logs to the browser console (`checkSum(50, 49)` prints `under 100`); there is no visible UI output beyond the static `updated!` text. Verify behavior via the browser devtools console, not the page body.
- Parcel v1 is unmaintained but builds/runs fine on the VM's Node 22.

## US market news tool

A separate **Node CLI** fetches US stock market news via the Finnhub API. It is independent of the Parcel browser demo.

- Entry point: `node tools/us-market-news/cli.js` (or `npm run news`)
- Core module: `src/news/fetchUsMarketNews.js`
- Guardrails: `src/news/config.js`, `src/news/errors.js`
- Human docs: `docs/us-market-news.md`
- Agent rules: `.cursor/rules/us-market-news.mdc`

### Environment

1. Copy `.env.example` to `.env`
2. Set `FINNHUB_API_KEY` (free key from https://finnhub.io/register)
3. The CLI loads `.env` via `dotenv`; never hardcode keys in source

### Verification

- Run the CLI and inspect JSON stdout — do **not** use the Parcel browser console for news tool verification
- Example: `npm run news` (general market) or `npm run news -- --symbol AAPL`
- Bulk quotes + news: `npm run quotes -- AAPL GOOG MSFT` or `npm run quotes -- --symbol AAPL,GOOG --limit 5` (see `.cursor/skills/bulk-stock-quotes/SKILL.md`)
- Without a valid API key, expect a typed `ConfigError`, not an empty result

### Scope limits

- Fetch and normalize news only — no investment advice, predictions, or trading logic
- Do not modify `src/index3.js` for news features unless explicitly requested

## Kakeibo (household budget) tool

A separate **browser tool + Node CLI** for combining MoneyForward ME "収入・支出詳細" CSV exports into one ledger, letting the user manually mark each transaction as belonging to themselves/spouse/shared/excluded (excluded = money-movement-only transactions, e.g. a bank transfer, that should be dropped from all totals), and aggregating expenses by month and person. It is independent of the Parcel demo and the news tool.

- Browser entry: `kakeibo.html` → `src/kakeibo/kakeiboApp.js` (run via `npm run kakeibo`, serves on port 1235). All CSV parsing/marking/aggregation happens client-side; nothing is sent to a server.
- Core modules (framework-agnostic, shared by browser + CLI): `src/kakeibo/csv.js`, `parseMoneyForwardCsv.js`, `combineTransactions.js`, `aggregate.js`, `ledgerCsv.js` (read/write the tool's own "全データCSV" export format, which round-trips both transactions and marks)
- CLI entry point: `node tools/kakeibo/cli.js` (`combine` and `summarize` subcommands) for users who prefer a spreadsheet workflow
- Human docs: `docs/kakeibo.md`
- Agent rules: `.cursor/rules/kakeibo.mdc`
- Tests: `test/kakeibo/kakeibo.test.js` (run via `npm test`), using only fabricated sample data
- Deployment: `.github/workflows/deploy-pages.yml` builds and deploys `index.html` + `kakeibo.html` as a static site to GitHub Pages on push to `main` (requires Settings → Pages → Source = GitHub Actions to be enabled once, manually, on GitHub)

### Privacy (critical)

- This tool processes real personal financial data. **Never commit actual MoneyForward export CSVs, combined ledgers, or exported mark files.** The `data/` directory is gitignored for this reason — keep it that way.
- Test fixtures must use fabricated data only, never a real export.

### Scope limits

- Combine, mark, and aggregate expenses only — no budgeting advice, spending predictions, or investment logic
- Keep separate from `src/index3.js` and `src/news/**` unless explicitly requested otherwise

## Receipts OCR tool

A separate **browser tool** that batch-loads receipt images, runs Google Cloud Document AI (Expense Parser), shows editable line-item rows, and exports CSV. Independent of the Parcel demo, news tool, and (for now) kakeibo reconciliation.

- Browser entry: `receipts.html` → `src/receipts/receiptsApp.js` (run via `npm run receipts`, port **1236**)
- Core modules: `src/receipts/parseExpenseDocument.js`, `documentAiClient.js`, `oauthAccessToken.js`, `processorConfigStore.js`, `parseReceiptText.js`, `receiptCsv.js`, `quota.js`, `config.js`, `errors.js`
- Reuses kakeibo Google Sign-In (`src/kakeibo/auth.js` + `syncAuthConfig.js`) plus a separate GIS OAuth access-token grant for Document AI
- Human docs: `docs/receipts.md`
- Agent rules: `.cursor/rules/receipts.mdc`
- Tests: `test/receipts/receipts.test.js` (`npm test`)

### Environment / secrets

1. `GOOGLE_CLIENT_ID` in `.env` (same as kakeibo) for login + Document AI OAuth
2. **Do not** store service-account JSON or API keys in the browser or `.env` for this static-site design — Document AI uses a short-lived OAuth access token kept in memory only
3. Processor project/location/id may be stored in `localStorage` (not secrets). Recommend a GCP budget alert (no Always Free tier)

### Verification

- Unit tests cover Expense Parser mapping / CSV / quota math
- Manual: `npm run receipts` → confirm processor settings → authorize Document AI → drop sample images → confirm table + CSV download
- Without OAuth consent or incomplete processor config, expect a typed `ConfigError`; when the monthly soft counter is exhausted, expect a quota stop (no Document AI call)

### Scope limits

- OCR → table → CSV only in v1 — no kakeibo matching until requested
- Do not modify `src/index3.js` or `src/news/**` for receipts features unless explicitly requested
- Never commit real receipt images or exported receipt CSVs

## BodyCombat program builder

A separate **browser tool** that assembles a Les Mills BodyCombat class for 30, 45, or 60 minutes from tracks published on ボディコンバットナビ (https://www.fhstr.net/archives/34 and the BC release pages linked from it). The catalog is stored in the app. It does not give training advice.

- Browser entry: `bodycombat.html` → `src/bodycombat/bodycombatApp.js` (run via `npm run bodycombat`, port **1237**)
- Core modules: `src/bodycombat/catalog.js` (embedded track list), `buildProgram.js` (time-fit class builder), `roles.js`, `customFormat.js` (one saved custom order), `metaStore.js` (rating and duration edits in localStorage)
- Human docs: `docs/bodycombat.md`
- Agent rules: `.cursor/rules/bodycombat.mdc`
- Tests: `test/bodycombat/bodycombat.test.js` (`npm test`)

### Scope limits

- Build a class that follows the fixed 30/45/60 track order, or the one saved custom order, and fits the selected duration
- Ratings shipped with the catalog are placeholders (1–5). Durations are estimates until the user edits them
- Do not modify `src/index3.js`, `src/news/**`, `src/kakeibo/**`, or `src/receipts/**` for this tool unless explicitly requested
