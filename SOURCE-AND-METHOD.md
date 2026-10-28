# South African Open Food Facts catalogue

This directory holds Shoperb's prepared external product catalogue and acquisition report. The cleaned JSON is now imported lazily by the offline autocomplete utility. The original worldwide CSV remains excluded from runtime and version control. No OCR, shopping-list sharing, shopping calculations, app configuration or versions are changed by the integration.

## Supported download method

The [official data page](https://world.openfoodfacts.org/data) publishes nightly worldwide CSV and JSONL exports. The chosen source is:

**https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz**

The official URL redirects to Open Food Facts' S3-hosted dataset. On 28 October 2026, its HEAD response reported **1,524,125,031 compressed bytes** (about 1.42 GiB), last modified **09:05:12 UTC**. Before downloading, C: had about **282.76 GB** free. The downloader checks Content-Length and disk space plus 4 GiB headroom, writes a `.part` file, and promotes it only when the complete byte count matches. The processor streams gzip decompression; no giant uncompressed CSV is written. A complete gzip/CSV pass must finish before publishing the compact catalogue.

### Why the filtered website controls may not work

The filtered advanced-search URL tested was:

https://world.openfoodfacts.org/cgi/search.pl?search_terms=&search_simple=1&action=process&tagtype_0=countries&tag_contains_0=contains&tag_0=south-africa

It returned **HTTP 503, Page temporarily unavailable**, so this investigation did not observe the user's live browser session or prove a browser/CSS defect. However, the official source identifies an independent, concrete explanation:

- [Display.pm](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/lib/ProductOpener/Display.pm) defaults on-demand exports to **10,000 products**, permits limit changes only for administrators, and returns a too-many-products error above that limit.
- [list_of_products.tt.html](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/templates/web/common/includes/list_of_products.tt.html) prints the download-section heading, but renders the CSV/XLSX anchor links **only when `count <= export_limit`**. The earlier user-reported 10,455 results would hide those controls. A current live search count was not retrieved.
- Download links are generated for a search-query context, not automatically for every country/facet page. When allowed, the form's links add `download=on&format=csv` or `format=xlsx` to the filtered query.
- The [official API guidance](https://openfoodfacts.github.io/openfoodfacts-server/api/#rate-limits) requests bulk exports for collections larger than a few hundred products. This workflow does not split searches, alter an export limit or paginate the search API to evade restrictions.

For these reasons, the complete worldwide export plus local filtering is the reliable supported route. The official JSONL alternative is https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz; it was not downloaded because the smaller tab-separated CSV already supplies the needed fields.

## Verified South Africa filter and fields

Filter the **`countries_tags`** column by exact comma-separated token **`en:south-africa`**. The [official country taxonomy](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/taxonomies/countries.txt) lists South Africa, Republic of South Africa, RSA, ZA and ZAF as aliases. The [field documentation](https://static.openfoodfacts.org/data/data-fields.txt) defines countries as where a product is sold, not where it was manufactured. Multi-country/imported products with the tag are included. Do not filter by name, barcode prefix, origin or manufacturer country.

Extracted fields are `code`, `product_name`, `brands`, `quantity`, `categories`. Barcodes stay strings, including leading zeroes. Text whitespace is collapsed and common units normalized (`1 kg` → `1kg`, `2 l` → `2L`). Brand spelling and product-name casing are preserved; brand/size information is not invented or redundantly appended. Missing optional values remain empty strings. Exact normalized record duplicates are removed; different barcodes or differing variants remain distinct. No images or product prices are downloaded into the compact catalogue.

The source CSV has tab separators, quoted/escaped fields and possible embedded newlines; the JavaScript processor handles those rather than splitting every physical line into products. It counts all worldwide records, verifies candidate country-tag columns and reports retained/rejected/duplicate counts. Gzip integrity, an incomplete final record or malformed candidate rows cause failure, not a false completeness claim. The report distinguishes the worldwide export row count from matched South African rows and from the unknown current API total.

## Completed acquisition result (28 October 2026)

- Worldwide source rows downloaded and read: **4,879,512**.
- Rows with the exact South Africa tag: **10,554**.
- Usable products retained: **9,751**.
- Rejected records: **803** (801 absent/nonmeaningful names, one explicit test entry and one packaging-text record).
- Exact duplicate records removed: **0**; genuine barcode variants remain.
- Invalid optional quantity descriptions cleared: **76**. Product records themselves were retained when otherwise useful.
- Final compact JSON: **1,043,245 bytes** (about **0.995 MiB**).
- Missing optional fields after cleaning: see the report's exact counts. No missing brands, quantities or categories were invented.

The full gzip pass completed successfully, including end-of-stream integrity checks. A final local refinement used the already filtered source records: it cleared obvious flavour descriptions misfiled as quantity, removed a known-format packaging-text name and an explicit Timing test entry, and collapsed exact repeated hyphen-separated suffixes. It did not use AI or manufacture substitute names. Existing short genuine names such as Halo Test were retained. The same rules are included in the reusable processor for future complete export runs. All retained names currently fit Shoperb's 160-character item-name limit, and barcode IDs have no conflicts.

The catalogue is technically prepared for future local autocomplete integration, with source/ODbL metadata embedded. It is now used by the Add/Edit Item suggestions, and public distribution still requires the licensing arrangements below and in PUBLICATION.md. The catalogue is a complete filtered subset of this dated OFF export, **not** a claim to cover every product sold in South Africa or every live database edit after the nightly snapshot.

## Refresh and validation

From `C:\shopdev\Shoperb`:

```powershell
node tools/downloadOpenFoodFacts.js
# Proceed only after the downloader reports success:
node tools/prepareSouthAfricanProducts.js
node --test tests/product-catalogue.test.js
```

Only process the completed `.cache/off-products.csv.gz`, never `.part`. Acquisition metadata records source URL, redirect, Last-Modified, ETag, bytes and download times. A failed download is reported separately and does not replace the previous completed archive. The downloader identifies Shoperb using its configured public privacy-policy URL; no email address is invented. It performs one official export download, not API pagination. A failed run can be retried manually; incomplete archives are never treated as complete data.

`data/productCatalogueReport.json` is the authoritative result of the most recent processing attempt, including sample products, missing optional fields, exact final JSON byte size and warnings. A nightly export is a dated snapshot, not proof of the current live API count or completeness of the South African retail market. Crowdsourced names/categories can still need review. Technical readiness for future autocomplete does not mean public redistribution obligations have already been satisfied. No APK/AAB is built, and no data is committed, pushed or published by these scripts.

## Licensing before future distribution

Source attribution: **Contains information from Open Food Facts, made available under the Open Database License (ODbL).** Link to [Open Food Facts](https://world.openfoodfacts.org/) and [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/), retaining provenance and license notices with the downloadable catalogue and accompanying documentation. Future catalogue metadata should record the actual source/export URL and retrieval date; neither should be invented before retrieval.

[Open Food Facts' licensing guidance](https://openfoodfacts.github.io/openfoodfacts-server/api/tutorials/license-be-on-the-legal-side/) distinguishes the database's ODbL from the individual contents' [Database Contents License](https://opendatacommons.org/licenses/dbcl/1-0/). Images have separate licensing and are not part of this request.

Treat the extracted, cleaned catalogue conservatively as a **Derivative Database**. ODbL sections 4.2–4.4 require notices, attribution and share-alike licensing when publicly conveying/using a derivative database. Under section 4.6, public use of a derivative database or a produced work from it requires offering recipients a machine-readable copy of the entire derivative database or the changes/method needed to reconstruct it, under the applicable license. Network availability must be free of charge; physical distribution may charge reasonable production cost. Section 4.7 also addresses technical restrictions: where restrictions apply, an unrestricted alternative must be offered as required by the license.

Before bundling the catalogue publicly, provide the license/notices, a practical source-download or reconstruction offer, document the cleaning transformations and verify the attribution placement for the future app integration against OFF's current guidance. Do not assume merely linking the original full database satisfies obligations for Shoperb's cleaned derivative. Keep this external catalogue separate from users' private shopping/purchase data; no private data should be included in a public database offer. ODbL does not automatically license Shoperb's application source code, but how datasets are combined can affect database obligations.

No public distribution has taken place. Settings → About & Legal now includes OFF attribution, source/license links and an export of the exact adapted catalogue without personal data or application code. This note records implementation requirements, not a determination that a future distribution arrangement is already compliant.


## Runtime autocomplete integration

`src/data/catalogueSearch.js` lazily requires the single cleaned JSON module and caches a derived search index for the JS session. No API, image, database migration or search dependency is added. Original source casing/spelling stays available for display; separate search keys normalize case, common accents, apostrophes, punctuation, whitespace and spaced pack units. Search handles multiple words in any order. Results are capped at seven with purchased personal products first, then strong catalogue matches, prior entered products, and weaker catalogue substrings. Personal names are deduplicated against complete, unambiguous catalogue labels only; pack-size tokens are never discarded. Different source barcodes are retained when descriptions are ambiguous.

Selection combines only available source brand/name/pack information into the existing name field, without inventing sizes. It leaves the shopping quantity, entered unit price and purchased status untouched. The metadata subtitle omits information already visible in the primary source name. Free typing remains available. The Add/Edit Item sheet retains its outer scroll and fixed actions; a compact More products control reveals the remaining results when the keyboard/screen budget initially allows fewer rows. Keyboard dismissal closes suggestions. Source names that would exceed the existing 160-character limit after adding metadata are excluded rather than silently truncated.

Price-history lookup still uses the existing strict stored-name identity and same-currency, purchased-only observations. Search normalization is not reused as a price identity. A selected catalogue row whose full description maps to multiple source barcodes suppresses previous-price/variance hints for that selection, because no barcode is stored on existing shopping items. The original historical data is neither migrated nor rewritten. Historical/manual items with indistinguishable names remain subject to the existing name-only model; missing brand/size/barcode information cannot be reconstructed. Explicit sizes such as 500g and 1kg remain different saved labels and do not share comparisons.

See PUBLICATION.md for the adapted-database export mechanism and remaining publication/compliance steps. No legal-compliance completion is claimed. The catalogue's source JSON is unchanged by this integration.


### Integration file inventory and verification

Created: `src/data/catalogueSearch.js`, `src/services/catalogueExport.js`, `tests/catalogue-search.test.js`, `tests/catalogue-export.test.js`, `data/PUBLICATION.md`.

Modified: `src/data/autocomplete.js`, `src/components/ItemEditor.jsx`, `src/components/ItemEntrySheet.jsx`, `src/app/(tabs)/settings.jsx`, `tests/item-editor.test.js`, `tests/item-entry-sheet.test.js`, `tests/currency-settings.test.js`, `tests/list-detail.test.js`, this README and `DEVICE_TESTS.md`.

Verification: all 185 automated tests, ESLint and JavaScript checks passed. Android Hermes export passed (about 7.7 MB entry bundle); no APK/AAB was built. The actual source still contains 9,751 records and the whole catalogue remains exportable. A desktop Node.js run of 100 warm searches across Alb, clover milk, jungle oats, nestle and milk 2l measured median about 1.48 ms, P95 about 3.93 ms and maximum about 8.80 ms. One-time index construction was about 138 ms on that host; 761 indexed rows have ambiguous complete descriptions and preserve their distinct source barcodes. These figures are not Android measurements. First-open warmup, low-end-device typing, keyboard/safe-area layout and legal-export share targets still require device verification.

There are no newly installed dependencies or database migrations. Expo Go can exercise these JS/JSON changes after reloading Metro; an already installed standalone preview needs an updated compatible JS bundle or a new preview build to include the new catalogue. Existing OCR native-build requirements are unchanged.
