# OKDP.io

<div align="center">
  <img src="https://raw.githubusercontent.com/OKDP/OKDP/main/logo/inverted/okdp-inverted.png" alt="OKDP Logo" width="320" />

  <br/>

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Website](https://img.shields.io/badge/website-okdp.io-informational)](https://okdp.io)

</div>

## About the Site

This repository contains the source of the **okdp.io** website, featuring:

- Marketing landing page;
- Documentation;
- i18n (FR/EN) support.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Stack inventory

`/stack/<version>` lists every component shipped in an OKDP release, with its
version, provenance and source links. The data is **generated**, not written by
hand: `src/data/stack/okdp-1-0.yaml` is produced by `scripts/build-stack.mjs`
from the KuboCD Package manifests in
[`platform-packages`](https://github.com/OKDP/platform-packages) and
[`sandbox-dependencies`](https://github.com/OKDP/sandbox-dependencies).

The generator runs when a release is cut, never during `astro build`. Its output
is committed, so the site build stays offline and deterministic, and every
version change lands as a reviewable diff.

### Regenerating

```bash
node scripts/build-stack.mjs --stack 1.0
git diff src/data/stack/   # expect no change unless a package actually moved
```

By default it clones both package repositories from `OKDP` at their current
`main`. To generate from a local checkout instead:

```bash
node scripts/build-stack.mjs --stack 1.0 \
  --repo platform-packages=../platform-packages
```

A local checkout is only safe if it is level with `main`. The generator warns
when it is not: a stale one parses fine and silently produces a different
platform. Prefer the default unless you are testing an unmerged change.

### Adding a release

```bash
node scripts/build-stack.mjs --stack 1.1
```

This writes `src/data/stack/okdp-1-1.yaml`, and the new route appears
automatically. Existing stack files are never rewritten, so a shipped inventory
stays frozen at what that release contained.

### Editing what is shown

Versions, charts, images and provenance are all derived from the package
manifests. Do not edit the generated file: re-run the script.

Everything that cannot be derived (display names, project homepages, logos, and
the occasional upstream version a package tag cannot express) lives in
`scripts/stack-metadata.yaml`. That is the file to edit.

## Preview deployments from forks

To let contributors share a live preview without deploying anything in the upstream `OKDP` organization, the repository includes a fork-only GitHub Actions workflow in `.github/workflows/preview.yml`.

### How it works

- it runs on every push to a non-`master` branch in a fork
- it publishes the built site to the fork's `gh-pages` branch under `previews/<branch-slug>/`
- it is skipped automatically in the upstream `OKDP/okdp.io` repository
- it removes the production `CNAME` file before publishing, so a fork preview never tries to claim `okdp.io`

### One-time setup in a fork

1. Fork `OKDP/okdp.io`
2. In the fork, enable GitHub Actions if prompted
3. In **Settings → Pages**, configure GitHub Pages to deploy from the `gh-pages` branch (root)
4. Push your feature branch to the fork

Your preview will then be available at:

```text
https://<fork-owner>.github.io/<fork-repo-name>/previews/<branch-slug>/
```

When opening a pull request against upstream, you can paste that preview URL into the PR description.

## Community

- Organization: [TOSIT Association](https://tosit.fr)
- Communication: [Github discussion](https://github.com/orgs/OKDP/discussions)
