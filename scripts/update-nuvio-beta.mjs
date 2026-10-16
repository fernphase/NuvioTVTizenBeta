import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const appDir = path.join(repoRoot, "app");
const nuvioRepo = "NuvioMedia/NuvioTVSmart";

// Files in the official .wgt that only make sense for an installed Tizen widget.
const wgtOnlyEntries = new Set(["config.xml", "icon.png", "services"]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd ?? repoRoot, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

async function fetchWithRetry(url, headers, attempts = 4) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(120_000) });
      if (response.ok) {
        return response;
      }
      const error = new Error(`Request failed: ${response.status} ${response.statusText} ${url}`);
      if (response.status < 500 && response.status !== 429) {
        throw Object.assign(error, { fatal: true });
      }
      throw error;
    } catch (error) {
      if (error.fatal || attempt >= attempts) {
        throw error;
      }
      console.warn(`${error.message}; retrying (${attempt}/${attempts - 1})`);
      await new Promise((resolve) => setTimeout(resolve, 5_000 * attempt));
    }
  }
}

function githubHeaders() {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "NuvioTVTizenBeta-updater" };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function latestRelease() {
  const response = await fetchWithRetry(`https://api.github.com/repos/${nuvioRepo}/releases/latest`, githubHeaders());
  return response.json();
}

function findTizenWgtAsset(release) {
  return release.assets?.find((asset) => {
    const name = asset.name ?? "";
    return name.endsWith(".wgt") && /tizen/i.test(name);
  });
}

async function downloadVerified(asset, destination) {
  const response = await fetchWithRetry(asset.browser_download_url, { "User-Agent": "NuvioTVTizenBeta-updater" });
  const bytes = Buffer.from(await response.arrayBuffer());

  if (asset.digest) {
    const [algorithm, expected] = asset.digest.split(":");
    const actual = createHash(algorithm).update(bytes).digest("hex");
    if (actual !== expected) {
      throw new Error(`Digest mismatch for ${asset.name}: expected ${expected}, got ${actual}`);
    }
  }

  await writeFile(destination, bytes);
}

// The official entry page loads Tizen widget-only APIs ($WEBAPIS and the wrt:service
// module). TizenBrew runs the app as a plain web page, so drop them.
function toTizenBrewIndexHtml(html) {
  const result = html
    .replace(/[ \t]*<script src="\$WEBAPIS\/[^"]*"><\/script>\r?\n/g, "")
    .replace(/[ \t]*<script type="module">[\s\S]*?wrt:service[\s\S]*?<\/script>\r?\n/g, "");

  if (result.includes("$WEBAPIS") || result.includes("wrt:service")) {
    throw new Error("Official index.html changed shape; update toTizenBrewIndexHtml().");
  }
  return result;
}

// The packaged native services (EngineFS, plugins) are not installed under TizenBrew.
function toTizenBrewMainJs(source) {
  return source.replace(/(__NUVIO_TIZEN_\w+_SERVICE_ENABLED__\s*=\s*)true/g, "$1false");
}

// AVPlay (webapis.avplay) is unavailable under TizenBrew. For remote files on Tizen the
// bundle offers only AVPlay, never HTML5 <video> ("native-file"):
// `(!isTizen||!isRemote)&&push("native-file")`, so playback fails before it starts.
// Also offer "native-file" when AVPlay is unsupported, as releases before 1.x did.
function toTizenBrewBundle(source) {
  const pattern =
    /(let (\w+)=\[\],(\w+)=this\.isRemoteDirectHttpSource\(\w+\);return (\w+)&&(\w+)&&(\w+)\(\2,\w+\),\(!\4\|\|!\3)\)&&\6\(\2,"native-file"\)/;
  if (!pattern.test(source)) {
    throw new Error("Official app.bundle.js changed shape; update toTizenBrewBundle().");
  }
  return source.replace(pattern, (match, head, list, remote, tizen, avplay, push) =>
    `${head}||!${avplay})&&${push}(${list},"native-file")`
  );
}

async function patchPackageJson(version) {
  const packagePath = path.join(repoRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));

  packageJson.version = version.replace(/^v/, "");
  packageJson.description =
    "Self-contained Nuvio TV module for TizenBrew, updated from the latest NuvioMedia/NuvioTVSmart release.";

  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  await writeFile(path.join(repoRoot, ".nuvio-beta-version"), `${version}\n`);
}

async function main() {
  const release = await latestRelease();
  const tag = release.tag_name;
  const wgtAsset = findTizenWgtAsset(release);

  if (!wgtAsset) {
    throw new Error(`Release ${tag} does not contain a Tizen .wgt asset.`);
  }

  const tmp = await mkdtemp(path.join(os.tmpdir(), "nuvio-update-"));
  const wgtPath = path.join(tmp, wgtAsset.name);
  const wgtDir = path.join(tmp, "wgt");

  try {
    await downloadVerified(wgtAsset, wgtPath);
    run("unzip", ["-q", wgtPath, "-d", wgtDir]);

    for (const required of ["index.html", "main.js", "app.bundle.js", "nuvio.env.js"]) {
      if (!existsSync(path.join(wgtDir, required))) {
        throw new Error(`Release ${tag} .wgt did not include ${required}.`);
      }
    }

    const indexHtml = toTizenBrewIndexHtml(await readFile(path.join(wgtDir, "index.html"), "utf8"));
    const mainJs = toTizenBrewMainJs(await readFile(path.join(wgtDir, "main.js"), "utf8"));
    const bundleJs = toTizenBrewBundle(await readFile(path.join(wgtDir, "app.bundle.js"), "utf8"));

    await rm(appDir, { recursive: true, force: true });
    await cp(wgtDir, appDir, {
      recursive: true,
      filter: (source) => !wgtOnlyEntries.has(path.relative(wgtDir, source))
    });
    await writeFile(path.join(appDir, "index.html"), indexHtml);
    await writeFile(path.join(appDir, "main.js"), mainJs);
    await writeFile(path.join(appDir, "app.bundle.js"), bundleJs);
    await cp(path.join(wgtDir, "icon.png"), path.join(repoRoot, "icon.png"));

    await patchPackageJson(tag);
    console.log(`Bundled Nuvio ${tag} from ${wgtAsset.name}`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
