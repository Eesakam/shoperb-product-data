/* global __dirname */
const fs = require("node:fs"),
  fsp = require("node:fs/promises"),
  path = require("node:path"),
  zlib = require("node:zlib"),
  readline = require("node:readline"),
  { PassThrough } = require("node:stream"),
  { pipeline } = require("node:stream/promises");
const { Buffer } = require("node:buffer");
const ROOT = path.resolve(__dirname, "..");
const SOURCE =
  "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz";
function clean(value) {
  return typeof value === "string"
    ? value.normalize("NFC").replace(/\s+/gu, " ").trim()
    : "";
}
function quantity(value) {
  return clean(value).replace(
    /(\d(?:[.,]\d+)?)\s*(kg|mg|g|ml|cl|dl|l)\b/gi,
    (_, number, unit) =>
      number + (unit.toLowerCase() === "l" ? "L" : unit.toLowerCase()),
  );
}
function isSouthAfrican(tags) {
  return String(tags)
    .split(",")
    .some((tag) => tag.trim() === "en:south-africa");
}
function parseRecord(source) {
  const fields = [];
  let value = "",
    quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      if (quoted && source[i + 1] === '"') {
        value += '"';
        i++;
      } else if (quoted) {
        quoted = false;
      } else if (value === "") {
        quoted = true;
      } else throw Error("Malformed unescaped quote in CSV record");
    } else if (c === "\t" && !quoted) {
      fields.push(value);
      value = "";
    } else value += c;
  }
  if (quoted) throw Error("Unterminated CSV quote");
  fields.push(value);
  return fields;
}
function normalizeProduct(raw) {
  const id = clean(raw.code);
  const segments = quantity(raw.product_name).split(/\s+-\s+/);
  while (segments.length > 1 && segments.at(-1) === segments.at(-2))
    segments.pop();
  const name = segments.join(" - ");
  if (!/^\d{1,32}$/.test(id)) return { reason: "invalidBarcode" };
  if (!name || [...name].filter((c) => /\p{L}/u.test(c)).length < 2)
    return { reason: "missingOrNonmeaningfulName" };
  if (
    /^(?:timing[ _-]*test|test(?:[ _-]*(?:product|entry|item|food|record|123))?|testing|asdf|qwerty|unknown|n\/?a|none|null|product[ _-]*name)$/i.test(
      name,
    )
  )
    return { reason: "obviousTestOrJunkName" };
  if (
    /^(?:(?:R|ZAR|USD|EUR|GBP|[$£€])\s*)?\d+(?:[.,]\d{1,2})?(?:\s*(?:ZAR|USD|EUR|GBP))?$/i.test(
      name,
    )
  )
    return { reason: "priceOnlyName" };
  if (
    /^prod(?:uction)?\s*date\s*:/i.test(name) &&
    /may contain|item no\.|made in/i.test(name)
  )
    return { reason: "packagingTextInsteadOfName" };
  const rawQuantity = quantity(raw.quantity);
  const validQuantity =
    !rawQuantity ||
    /\d/.test(rawQuantity) ||
    /^(?:per\s*\/?\s*(?:kg|g|l|ml)|each)$/i.test(rawQuantity);
  return {
    invalidOptionalQuantityCleared: !validQuantity,
    product: {
      id,
      name,
      brand: clean(raw.brands),
      quantity: validQuantity ? rawQuantity : "",
      category: clean(raw.categories),
    },
  };
}
async function prepare(
  input = path.join(ROOT, ".cache", "off-products.csv.gz"),
  { outputDirectory = path.join(ROOT, "data") } = {},
) {
  const destination = path.resolve(outputDirectory);
  if (!destination.startsWith(ROOT + path.sep))
    throw Error("Output must stay inside Shoperb.");
  const inputPath = path.resolve(input);
  if (!inputPath.startsWith(ROOT + path.sep) || inputPath.endsWith(".part"))
    throw Error("Use a completed export inside the Shoperb project.");
  const report = {
    source: "Open Food Facts",
    country: "South Africa",
    version: 1,
    status: "processing",
    complete: false,
    readyForAutocomplete: false,
    sourceUrl: SOURCE,
    countryFilter: {
      field: "countries_tags",
      equals: "en:south-africa",
      meaning:
        "Products tagged as sold in South Africa, including imported/multi-country products.",
    },
    totalRecordsReportedByApi: null,
    totalRecordsDownloaded: 0,
    countryRecordsMatched: 0,
    totalProductsRetained: 0,
    recordsRejected: 0,
    duplicateRecordsRemoved: 0,
    invalidOptionalQuantitiesCleared: 0,
    productsMissingBrands: 0,
    productsMissingQuantities: 0,
    productsMissingCategories: 0,
    rejectionReasons: {},
    apiFailures: [],
    incompletePages: [],
    warnings: [
      "The nightly worldwide snapshot may differ from the live API.",
      "Product text is crowdsourced and may contain errors.",
      "No barcode check-digit repair, translation or name generation is performed.",
    ],
    licence: {
      database: "ODbL-1.0",
      url: "https://opendatacommons.org/licenses/odbl/1-0/",
      contents: "https://opendatacommons.org/licenses/dbcl/1-0/",
    },
  };
  const products = [],
    seen = new Set(),
    barcodes = new Map();
  let header,
    record = "",
    quoteParity = 0,
    physicalLines = 0;
  const inputStream = fs.createReadStream(inputPath),
    gunzip = zlib.createGunzip(),
    output = new PassThrough();
  const lines = readline.createInterface({
    input: output,
    crlfDelay: Infinity,
  });
  const consume = (async () => {
    for await (const line of lines) {
      physicalLines++;
      record += (record ? "\n" : "") + line;
      if (record.length > 16 * 1024 * 1024)
        throw Error(
          "CSV record exceeds the safety limit; no catalogue will be published.",
        );
      const quotes = line.match(/"/g);
      quoteParity ^= (quotes?.length || 0) % 2;
      if (quoteParity) continue;
      if (!header) {
        header = parseRecord(record.replace(/^\uFEFF/, ""));
        for (const field of [
          "code",
          "product_name",
          "brands",
          "quantity",
          "categories",
          "countries_tags",
        ])
          if (!header.includes(field))
            throw Error(`Export missing required field: ${field}`);
        record = "";
        console.log("CSV header validated: " + header.length + " fields");
        continue;
      }
      if (!record) {
        continue;
      }
      report.totalRecordsDownloaded++;
      if (record.includes("en:south-africa")) {
        const fields = parseRecord(record);
        if (fields.length !== header.length)
          throw Error("Column count mismatch in a South Africa candidate row.");
        const get = (key) => fields[header.indexOf(key)];
        if (isSouthAfrican(get("countries_tags"))) {
          report.countryRecordsMatched++;
          const normalized = normalizeProduct(
            Object.fromEntries(
              ["code", "product_name", "brands", "quantity", "categories"].map(
                (key) => [key, get(key)],
              ),
            ),
          );
          if (normalized.reason) {
            report.recordsRejected++;
            report.rejectionReasons[normalized.reason] =
              (report.rejectionReasons[normalized.reason] || 0) + 1;
          } else {
            if (normalized.invalidOptionalQuantityCleared)
              report.invalidOptionalQuantitiesCleared++;
            const product = normalized.product,
              key = JSON.stringify(product);
            if (seen.has(key)) report.duplicateRecordsRemoved++;
            else {
              seen.add(key);
              products.push(product);
              barcodes.set(product.id, (barcodes.get(product.id) || 0) + 1);
            }
          }
        }
      }
      record = "";
      if (report.totalRecordsDownloaded % 500000 === 0)
        console.log(
          `Read ${report.totalRecordsDownloaded} worldwide rows; ${report.countryRecordsMatched} South Africa rows`,
        );
    }
    if (quoteParity || record) throw Error("Incomplete final CSV record");
  })();
  try {
    await Promise.all([pipeline(inputStream, gunzip, output), consume]);
    if (
      !header ||
      !report.totalRecordsDownloaded ||
      !report.countryRecordsMatched
    )
      throw Error(
        "No valid worldwide/South Africa records found; refusing to publish an empty catalogue.",
      );
    products.sort(
      (a, b) =>
        a.name.localeCompare(b.name, "en-ZA") || a.id.localeCompare(b.id),
    );
    const metadataPath = inputPath + ".metadata.json";
    let metadata = null;
    if (fs.existsSync(metadataPath))
      metadata = JSON.parse(await fsp.readFile(metadataPath, "utf8"));
    const stat = await fsp.stat(inputPath);
    if (metadata?.downloadedBytes && metadata.downloadedBytes !== stat.size)
      throw Error(
        "Downloaded file size no longer matches acquisition metadata.",
      );
    const retrievedAt = metadata?.completedAt || null,
      processedAt = new Date().toISOString();
    const catalogue = {
      source: "Open Food Facts",
      country: "South Africa",
      version: 1,
      sourceUrl: SOURCE,
      retrievedAt,
      processedAt,
      sourceLastModified: metadata?.lastModified || null,
      licence: report.licence,
      attribution:
        "Contains information from Open Food Facts, made available under the Open Database License (ODbL). © Open Food Facts contributors.",
      products,
    };
    const json = JSON.stringify(catalogue);
    Object.assign(report, {
      status: "complete",
      complete: true,
      readyForAutocomplete: true,
      downloadMethod:
        "Official nightly worldwide gzip CSV (tab-separated); streamed decompression and local country filtering.",
      compressedDownloadBytes: stat.size,
      retrievedAt,
      processedAt,
      sourceLastModified: metadata?.lastModified || null,
      sourceEtag: metadata?.etag || null,
      totalProductsRetained: products.length,
      productsMissingBrands: products.filter((p) => !p.brand).length,
      productsMissingQuantities: products.filter((p) => !p.quantity).length,
      productsMissingCategories: products.filter((p) => !p.category).length,
      productsWithNamesOver160Characters: products.filter(
        (p) => p.name.length > 160,
      ).length,
      conflictingBarcodeIds: [...barcodes.values()].filter((count) => count > 1)
        .length,
      finalJsonFileSizeBytes: Buffer.byteLength(json),
      sampleProducts: Array.from(
        { length: Math.min(12, products.length) },
        (_, i) =>
          products[
            Math.floor(
              ((i + 0.5) * products.length) / Math.min(12, products.length),
            )
          ],
      ),
      filterVerified: true,
      physicalLinesRead: physicalLines,
      catalogueFileCreated: true,
      readyForPublicDistribution: false,
      distributionNote:
        "Data preparation complete, but attribution/share-alike and a derivative database download/reconstruction offer must be arranged before public app distribution.",
    });
    await fsp.mkdir(destination, { recursive: true });
    const target = path.join(destination, "southAfricanProducts.json");
    await fsp.writeFile(target + ".tmp", json);
    await fsp.rename(target + ".tmp", target);
    await fsp.writeFile(
      path.join(destination, "productCatalogueReport.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report, null, 2));
    return report;
  } catch (error) {
    inputStream.destroy();
    gunzip.destroy();
    output.destroy();
    lines.close();
    await fsp.mkdir(destination, { recursive: true });
    Object.assign(report, {
      status: "processing-failed",
      stopReason: error.message,
      processedAt: new Date().toISOString(),
      catalogueFileCreated: false,
      finalJsonFileSizeBytes: null,
    });
    await fsp.writeFile(
      path.join(destination, "productCatalogueReport.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    throw error;
  }
}
if (require.main === module)
  prepare(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = {
  prepare,
  parseRecord,
  normalizeProduct,
  isSouthAfrican,
  quantity,
};
