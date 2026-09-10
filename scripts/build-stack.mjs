//
// Copyright 2026 The OKDP Authors.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.
//

/**
 * Builds the OKDP stack inventory consumed by /stack/<version>.
 *
 * Reads the KuboCD Package manifests from the two package repositories and
 * flattens them into a single data file. Presentation metadata that cannot be
 * derived (display names, project URLs) lives in stack-metadata.yaml.
 *
 * This runs when a release is cut, not during `astro build`. Its output is
 * committed, so the site build stays offline and every version change shows up
 * as a reviewable diff.
 *
 * Clones the package repos from OKDP unless --repo names a local checkout.
 *
 *   node scripts/build-stack.mjs --stack 1.0
 *   node scripts/build-stack.mjs --stack 1.0 --repo platform-packages=../platform-packages
 */

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parse, stringify, Scalar } from "yaml";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const REPOS = {
  "platform-packages": {
    url: "https://github.com/OKDP/platform-packages.git",
    registry: "quay.io/okdp/platform-packages",
    sections: { services: "data-services", system: "control-plane" },
  },
  "sandbox-dependencies": {
    url: "https://github.com/OKDP/sandbox-dependencies.git",
    registry: "quay.io/okdp/sandbox-dependencies",
    sections: { services: "dependencies", system: "dependencies" },
  },
};

const OKDP_CHART_PREFIXES = ["quay.io/okdp/charts/"];
const OKDP_IMAGE_PREFIXES = ["quay.io/okdp/"];

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const args = { stack: null, repos: {}, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--stack") args.stack = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--repo") {
      const [name, path] = argv[++i].split("=");
      if (!REPOS[name]) fail(`unknown repo '${name}'`);
      args.repos[name] = resolve(path);
    } else fail(`unknown argument '${arg}'`);
  }
  if (!args.stack) fail("--stack <version> is required");
  return args;
}

/**
 * Forces a double-quoted scalar. Without this an ISO date round-trips through
 * YAML as a timestamp rather than a string, and the collection schema rejects it.
 */
function quoted(value) {
  const scalar = new Scalar(value);
  scalar.type = Scalar.QUOTE_DOUBLE;
  return scalar;
}

function fail(message) {
  console.error(`build-stack: ${message}`);
  process.exit(1);
}

// ------------------------------------------------------------------ sources

/**
 * Resolves each package repo to a local checkout.
 *
 * Clones from OKDP by default so the inventory always reflects the canonical
 * repositories. A local checkout has to be named explicitly with --repo, and
 * is checked against the expected origin: generating the public inventory from
 * someone's fork would be silent and wrong.
 */
function resolveSources({ repos }) {
  const sources = {};
  for (const [name, repo] of Object.entries(REPOS)) {
    if (repos[name]) {
      if (!exists(repos[name])) fail(`no checkout at ${repos[name]}`);
      sources[name] = repos[name];
      checkLocal(name, repos[name], repo.url);
    } else {
      const dir = join(mkdtempSync(join(tmpdir(), "okdp-stack-")), name);
      console.error(`  cloning ${name}…`);
      execFileSync("git", ["clone", "--depth", "1", "--quiet", repo.url, dir]);
      sources[name] = dir;
    }
    const path = sources[name];
    const head = git(path, "rev-parse", "HEAD");
    // The source commit date, not the time the script ran: keeping the output
    // deterministic is what lets a re-run be diffed to detect drift.
    const date = git(path, "show", "-s", "--format=%cI", "HEAD");
    console.error(`  ${name} @ ${head.slice(0, 7)}  (${path})`);
    sources[name] = { path, head, date };
  }
  return sources;
}

function exists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function remoteOf(path) {
  try {
    return execFileSync("git", ["-C", path, "remote", "get-url", "origin"], {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

/** Compares remotes ignoring protocol, credentials and a trailing .git. */
const sameRepo = (a, b) =>
  a.replace(/^.*github\.com[:/]/, "").replace(/\.git$/, "") ===
  b.replace(/^.*github\.com[:/]/, "").replace(/\.git$/, "");

function git(path, ...args) {
  try {
    return execFileSync("git", ["-C", path, ...args], {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

/**
 * A local checkout is only safe to generate from if it points at the OKDP repo
 * *and* is level with its main branch. A stale checkout is the dangerous case:
 * it parses fine and silently yields the wrong inventory.
 */
function checkLocal(name, path, url) {
  const origin = remoteOf(path);
  if (origin && !sameRepo(origin, url)) {
    console.error(`  warn: ${name} origin is ${origin}, expected ${url}`);
  }
  const head = git(path, "rev-parse", "HEAD");
  const remoteMain = git(path, "ls-remote", url, "refs/heads/main")?.split(
    /\s+/,
  )[0];
  if (head && remoteMain && head !== remoteMain) {
    const behind = git(path, "rev-list", "--count", `${head}..${remoteMain}`);
    console.error(
      `  warn: ${name} is not level with main (${head.slice(0, 7)} vs ${remoteMain.slice(0, 7)}` +
        (behind && behind !== "0" ? `, ${behind} commits behind` : "") +
        `). Drop --repo to clone the canonical repository.`,
    );
  }
}

function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(path));
    else if (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))
      found.push(path);
  }
  return found;
}

// --------------------------------------------------------------- extraction

/**
 * Expands an image repository to its fully-qualified form.
 *
 * A reference on the page reads as something to `docker pull`, so it has to name
 * its registry. Manifests leave that implicit three different ways: an explicit
 * `registry:` key beside `repository:`, a Docker Hub namespace (`trinodb/trino`),
 * or a bare official image (`postgres`). Only the first is dangerous - dropping
 * an explicit `quay.io` produces a Docker Hub path that resolves to nothing.
 */
function qualify(repository, registry) {
  if (registry) return `${registry.replace(/\/$/, "")}/${repository}`;
  const [head] = repository.split("/");
  if (head.includes(".") || head.includes(":") || head === "localhost") {
    return repository;
  }
  return repository.includes("/")
    ? `docker.io/${repository}`
    : `docker.io/library/${repository}`;
}

/**
 * Pulls chart and image coordinates out of one module. A module's `values` is
 * a Go template rather than YAML, so images are matched textually.
 */
function readModule(module) {
  const source = module.source ?? {};
  const entry = { name: module.name, charts: [], images: [] };

  if (source.helmRepository) {
    const { url, chart, version } = source.helmRepository;
    entry.charts.push({
      name: chart,
      version: String(version),
      repository: url,
      origin: "upstream",
    });
  }
  if (source.oci) {
    const { repository, tag } = source.oci;
    entry.charts.push({
      name: repository.split("/").pop(),
      version: String(tag),
      repository,
      origin: isOkdpChart(repository) ? "okdp" : "upstream",
    });
  }
  if (source.local) {
    // Plumbing charts vendored in the package repo (secret generation, OIDC
    // client registration). Never the component itself.
    entry.charts.push({
      name: module.name,
      version: null,
      repository: null,
      origin: "local",
    });
  }

  const values = typeof module.values === "string" ? module.values : "";
  // Charts split the host from the path (`registry:` + `repository:`, the
  // Bitnami convention) as often as they inline it. Dropping the host silently
  // turns a quay.io path into a Docker Hub one that does not exist.
  //
  // `tag:` is not always the next line either. `pullPolicy:` sits between the
  // two often enough that requiring adjacency dropped five images, the Polaris
  // server and the CloudNativePG operator among them. Intervening keys are
  // allowed, but not another `repository:`, so two adjacent image blocks can
  // never be paired across.
  for (const [, registry, repository, tag] of values.matchAll(
    /(?:registry:\s*"?([\w.:-]+)"?\s*\n\s*)?repository:\s*"?([\w./-]+)"?[ \t]*\n(?:[ \t]*(?!repository:|tag:)[\w.-]+:[^\n]*\n){0,4}\s*tag:\s*"?([\w.-]+)"?/g,
  )) {
    entry.images.push({
      repository: qualify(repository, registry),
      tag: String(tag),
    });
  }
  for (const [, ref] of values.matchAll(
    /image:\s*"?([\w./-]+:[\w.-]+)"?\s*$/gm,
  )) {
    const index = ref.lastIndexOf(":");
    entry.images.push({
      repository: qualify(ref.slice(0, index)),
      tag: ref.slice(index + 1),
    });
  }

  // A chart published as OCI also matches the repository/tag pattern above.
  const chartRefs = new Set(entry.charts.map((chart) => chart.repository));
  entry.images = dedupe(
    entry.images.filter((image) => !chartRefs.has(image.repository)),
    (image) => `${image.repository}:${image.tag}`,
  );
  entry.charts = dedupe(
    entry.charts,
    (chart) => `${chart.repository}:${chart.version}`,
  );
  return entry;
}

function dedupe(items, key) {
  const seen = new Map();
  for (const item of items) if (!seen.has(key(item))) seen.set(key(item), item);
  return [...seen.values()];
}

const isOkdpChart = (ref) =>
  OKDP_CHART_PREFIXES.some((prefix) => ref.startsWith(prefix));
const isOkdpImage = (ref) =>
  OKDP_IMAGE_PREFIXES.some((prefix) => ref.startsWith(prefix));

const basename = (ref) => (ref ?? "").split("/").pop();

/**
 * Picks the chart and image that *are* the component, as opposed to the helper
 * modules packaged alongside it. Without this, Airflow reports `oidc-dcr` and
 * Trino reports `internal-secrets`, both of which are plumbing.
 */
function selectPrimary(pkg, modules, meta) {
  const charts = modules.flatMap((module) => module.charts);
  const images = modules.flatMap((module) => module.images);
  const named = (name) => (candidate) => {
    const a = basename(candidate.repository) ?? candidate.name;
    return a === name || candidate.name === name;
  };

  const chart =
    (meta.primaryChart && charts.find((c) => c.name === meta.primaryChart)) ??
    charts.find(named(pkg.name)) ??
    charts.find((c) => c.origin === "upstream" && c.version) ??
    charts.find((c) => c.origin === "okdp" && c.version) ??
    null;

  const image =
    images.find(named(pkg.name)) ??
    images.find((i) => isOkdpImage(i.repository)) ??
    images.find((i) => !isOkdpChart(i.repository)) ??
    null;

  return { chart, image };
}

/**
 * upstream-chart | okdp-chart | okdp-image, as displayed in the Provenance
 * column. Derived from the primary chart and image only: every package vendors
 * a local secrets helper, so counting those would tag all 27 as OKDP-authored.
 */
function provenanceOf(primary) {
  const tags = [];
  if (primary.chart?.origin === "upstream") tags.push("upstream-chart");
  if (primary.chart?.origin === "okdp") tags.push("okdp-chart");
  if (primary.image && isOkdpImage(primary.image.repository))
    tags.push("okdp-image");
  return tags.length ? tags : ["okdp-chart"];
}

/**
 * The version a reader cares about: "Trino 480", not the package tag.
 *
 * Two tag shapes are supported, so the inventory survives the release-please
 * migration without a rewrite:
 *
 *   <upstream>-pNN       today, e.g. 3.5.1-p08
 *   <upstream>-X.Y.Z     after the migration, e.g. 3.5.1-1.0.0
 *
 * Both carry the upstream version in front, which is the part a reader wants.
 * Two packages still need naming explicitly in stack-metadata.yaml: trino
 * carries a SemVer-shaped tag the console's parser requires, and keycloak's tag
 * tracks the Bitnami chart rather than Keycloak itself.
 */
const PACKAGE_SUFFIX = /-(?:p\d+|\d+\.\d+\.\d+)$/;

function upstreamVersionOf(pkg, primary, override) {
  const derived = pkg.tag.replace(PACKAGE_SUFFIX, "");
  if (override)
    return { version: String(override), source: "metadata override", derived };

  // An image named after the package states the version most directly.
  if (primary.image && basename(primary.image.repository) === pkg.name) {
    return {
      version: primary.image.tag,
      source: `image ${primary.image.repository}`,
      derived,
    };
  }
  return { version: derived, source: "package tag", derived };
}

// ------------------------------------------------------------------ collect

function collect(sources, metadata) {
  const components = [];
  const warnings = [];

  for (const [repoName, repo] of Object.entries(REPOS)) {
    const root = join(sources[repoName].path, "packages");
    for (const file of walk(root).sort()) {
      const raw = readFileSync(file, "utf8");
      let pkg;
      try {
        pkg = parse(raw);
      } catch (error) {
        warnings.push(
          `${relative(root, file)}: unparseable (${error.message})`,
        );
        continue;
      }
      if (!pkg?.name || !pkg?.tag) continue;

      const group = relative(root, file).split("/")[0];
      const section = repo.sections[group];
      if (!section) {
        warnings.push(`${pkg.name}: unmapped group '${group}'`);
        continue;
      }

      const meta = metadata.components?.[pkg.name] ?? {};
      const modules = (pkg.modules ?? []).map(readModule);
      const primary = selectPrimary(pkg, modules, meta);
      const upstream = upstreamVersionOf(pkg, primary, meta.upstreamVersion);

      if (!meta.upstreamVersion && upstream.version !== upstream.derived) {
        warnings.push(
          `${pkg.name}: derived upstream ${upstream.version} from ${upstream.source}, ` +
            `package tag suggests ${upstream.derived}`,
        );
      }
      if (!metadata.components?.[pkg.name]) {
        warnings.push(
          `${pkg.name}: no entry in stack-metadata.yaml (using defaults)`,
        );
      }

      components.push({
        id: pkg.name,
        name: meta.name ?? pkg.name,
        section,
        upstreamVersion: upstream.version,
        upstreamVersionSource: upstream.source,
        package: {
          repository: `${repo.registry}/${pkg.name}`,
          tag: String(pkg.tag),
        },
        provenance: provenanceOf(primary),
        protected: pkg.protected === true,
        description: meta.description ?? firstSentence(pkg.description),
        primaryChart: primary.chart,
        primaryImage: primary.image,
        charts: modules.flatMap((module) => module.charts),
        images: modules.flatMap((module) => module.images),
        modules: modules.filter(
          (module) => module.charts.length || module.images.length,
        ),
        links: {
          upstream: meta.upstream ?? null,
          source: `https://github.com/OKDP/${repoName}/blob/${sources[repoName].head}/${relative(sources[repoName].path, file)}`,
        },
        notice: meta.notice ?? null,
      });
    }
  }

  components.sort((a, b) => a.name.localeCompare(b.name));
  return { components, warnings };
}

function firstSentence(text) {
  if (typeof text !== "string") return null;
  const line = text.trim().split("\n")[0].trim();
  return line.replace(/^[\w\s]+ - /, "") || null;
}

// -------------------------------------------------------------------- write

const args = parseArgs(process.argv.slice(2));
const metadataPath = join(ROOT, "scripts", "stack-metadata.yaml");
const metadata = exists(metadataPath)
  ? parse(readFileSync(metadataPath, "utf8"))
  : {};

console.error(`build-stack: OKDP ${args.stack}`);
const sources = resolveSources(args);
const { components, warnings } = collect(sources, metadata);

const output = {
  stack: args.stack,
  generated: {
    by: "scripts/build-stack.mjs",
    note: "Generated file. Re-run the script instead of editing by hand.",
    sources: Object.fromEntries(
      Object.entries(sources).map(([name, source]) => [
        name,
        {
          sha: source.head,
          date: source.date ? quoted(source.date.slice(0, 10)) : null,
          url: `${REPOS[name].url.replace(/\.git$/, "")}/tree/${source.head}`,
        },
      ]),
    ),
  },
  components,
};

const outPath = args.out
  ? resolve(args.out)
  : join(
      ROOT,
      "src",
      "data",
      "stack",
      `okdp-${args.stack.replace(/\./g, "-")}.yaml`,
    );
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, stringify(output, { lineWidth: 0 }));

const counts = components.reduce((acc, component) => {
  acc[component.section] = (acc[component.section] ?? 0) + 1;
  return acc;
}, {});
console.error(
  `  ${components.length} components  ` +
    Object.entries(counts)
      .map(([section, count]) => `${section}=${count}`)
      .join(" "),
);
for (const warning of warnings) console.error(`  warn: ${warning}`);
console.error(`  wrote ${relative(ROOT, outPath)}`);
