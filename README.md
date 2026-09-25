# US Market News Tool

Fetches US stock market news via the Finnhub API and outputs normalized JSON. Includes development guardrails for secrets, rate limits, and error handling.

**Disclaimer:** For informational purposes only. Not investment advice.

## Setup

```bash
npm install
cp .env.example .env
# Edit .env and set FINNHUB_API_KEY (https://finnhub.io/register)
```

## Usage

General US market news:

```bash
npm run news
```

News for a specific ticker:

```bash
npm run news -- --symbol AAPL
npm run news -- --symbol MSFT --limit 5
```

## Documentation

- [Operational guide & troubleshooting](docs/us-market-news.md)
- [Agent instructions](AGENTS.md)
- [Cursor project rules](.cursor/rules/us-market-news.mdc)

## Project layout

```
src/news/           Core fetcher, config, errors, normalization
tools/us-market-news/   CLI entry point
docs/               Human-facing documentation
```

The Parcel browser demo (`index.html` → `src/index3.js`) is separate from the news tool.

## Kakeibo (household budget) tool

Combines MoneyForward ME "収入・支出詳細" CSV exports into one ledger, lets you mark each transaction as yours / your spouse's / shared, and aggregates expenses by month and person. Runs entirely in the browser (no data leaves your machine); a CLI is also available for a spreadsheet-based workflow.

```bash
npm install
npm run kakeibo
# open http://localhost:1235/kakeibo.html and select your exported CSVs
```

See [`docs/kakeibo.md`](docs/kakeibo.md) for full usage (including the CLI) and the data format.

**Note:** Never commit real exported CSVs or ledgers — the `data/` directory is gitignored for this reason.

This tool is 100% client-side, so it can also be hosted as a static site and used from a phone browser via GitHub Pages (`.github/workflows/deploy-pages.yml`, requires a one-time `Settings → Pages → Source = GitHub Actions` setup) — see [`docs/kakeibo.md`](docs/kakeibo.md) for details. Note the deployed page is publicly reachable (no login) since this repo is public.

## Receipts OCR tool

Batch-load receipt images, OCR them with Google Cloud Document AI Expense Parser (OAuth access token in memory only — no API key stored), edit line items in a table, and download CSV. Matching against the kakeibo ledger is planned for a later version.

```bash
npm install
npm run receipts
# open http://localhost:1236/receipts.html
```

See [`docs/receipts.md`](docs/receipts.md). Never commit real receipt images or exported receipt CSVs.

## BodyCombat program builder

Builds a 30, 45, or 60 minute BodyCombat class from tracks listed on [ボディコンバットナビ](https://www.fhstr.net/archives/34). Ratings and durations start as placeholders and can be edited in the browser.

```bash
npm install
npm run bodycombat
# open http://localhost:1237/bodycombat.html
```

See [`docs/bodycombat.md`](docs/bodycombat.md).

## Parcel demo (legacy sandbox)

```bash
npx parcel index.html --port 1234
npm run build
```
