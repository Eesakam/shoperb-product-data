/* global __dirname */
const fs = require("node:fs"),
  fsp = require("node:fs/promises"),
  path = require("node:path"),
  { Readable, Transform } = require("node:stream"),
  { pipeline } = require("node:stream/promises");
const ROOT = path.resolve(__dirname, "..");
const URL =
  "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz";
const USER_AGENT =
  "Shoperb/1.0 CataloguePreparation (+https://eesakam.github.io/shoperb-privacy/)";
async function download() {
  const target = path.join(ROOT, ".cache", "off-products.csv.gz"),
    partial = target + ".part";
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const head = await fetch(URL, {
    method: "HEAD",
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(30000),
  });
  if (!head.ok) throw Error(`Official export HEAD failed: HTTP ${head.status}`);
  const expected = Number(head.headers.get("content-length"));
  if (!Number.isSafeInteger(expected) || expected <= 0)
    throw Error("Cannot establish export size before download.");
  const disk = await fsp.statfs(ROOT);
  const free = Number(disk.bavail) * Number(disk.bsize);
  if (free < expected + 4 * 1024 ** 3)
    throw Error(
      "Insufficient disk space: need export size plus 4 GiB headroom.",
    );
  const metadata = {
    url: URL,
    resolvedUrl: head.url,
    expectedBytes: expected,
    freeDiskBytesBefore: free,
    lastModified: head.headers.get("last-modified"),
    etag: head.headers.get("etag"),
    userAgent: USER_AGENT,
    startedAt: new Date().toISOString(),
  };
  console.log(JSON.stringify(metadata));
  const response = await fetch(URL, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(30 * 60 * 1000),
  });
  if (!response.ok)
    throw Error(`Official export failed: HTTP ${response.status}`);
  if (response.headers.get("content-type")?.includes("text/html"))
    throw Error("Export returned HTML, not gzip.");
  let received = 0,
    last = Date.now();
  const counter = new Transform({
    transform(chunk, encoding, done) {
      received += chunk.length;
      if (received > expected + 1024 * 1024)
        return done(Error("Export changed size during download; retry later."));
      if (Date.now() - last > 15000) {
        console.log(
          `Downloaded ${Math.round(received / 1024 ** 2)} MiB / ${Math.round(expected / 1024 ** 2)} MiB`,
        );
        last = Date.now();
      }
      done(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      counter,
      fs.createWriteStream(partial),
    );
    if (received !== expected)
      throw Error(`Incomplete export: ${received}/${expected} bytes`);
    metadata.downloadedBytes = received;
    metadata.completedAt = new Date().toISOString();
    await fsp.rename(partial, target);
    await fsp.writeFile(
      target + ".metadata.json",
      JSON.stringify(metadata, null, 2) + "\n",
    );
    console.log(`Download complete: ${received} bytes`);
  } catch (error) {
    metadata.downloadedBytes = received;
    metadata.error = error.message;
    await fsp.writeFile(
      target + ".failure.json",
      JSON.stringify(metadata, null, 2) + "\n",
    );
    throw error;
  }
}
if (require.main === module)
  download().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { download, URL, USER_AGENT };
