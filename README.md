# `yarn pin-deps`: pin dependencies to their currently resolved exact versions

This plugin will find any dependencies referenced with a semver identifier, and
will update `package.json` to replace that identifier with the exact version of
the package currently resolved in the lockfile for that reference.

You may find it useful when migrating a repository to use pinned version
identifiers, or when fixing a mistake after acidentally installing without `-E`.

It will not modify the lockfile or install any packages. It will only edit
`package.json`, and then you must run `yarn install` to update the lockfile.

## Installation

This plugin is available for both Yarn v2 and Yarn v3, but only the Yarn v3
version will receive updates. The `main` branch is the latest stable release.

### Yarn v3

```bash
yarn plugin import https://raw.githubusercontent.com/splitgraph/yarn-plugin-pin-deps/main/packages/plugin-pin-deps/bundles/%40yarnpkg/plugin-pin-deps.js
```

### Yarn v2

The version of this plugin for Yarn v2 is not expected to receive updates, but
it is stable and running in production.

```bash
yarn plugin import https://raw.githubusercontent.com/splitgraph/yarn-plugin-pin-deps/main/packages/plugin-pin-deps/bundles/%40yarnpkg/plugin-pin-deps-v2.cjs
```

## Usage

Add `--dry` to execute normally, except without writing to any files.

```bash
yarn pin-deps --dry
```

Pin the dependencies and write any changes to the relevant package.json files:

```bash
yarn pin-deps
```

After modifying the `package.json` files, you still need to run `yarn install`
to update the lockfile:

```bash
yarn install
```

Optionally, for an extra sanity check, in some cases, you may find it helpful to
run `yarn dedupe`, followed by `yarn install --immutable` to be certain.

```bash
yarn dedupe
yarn install
yarn install --immutable
```

Ultimately, the best sanity check is to run `git diff` after `yarn pin-deps`, to
see the `package.json` changes, and then again after `yarn install`, to see the
lockfile changes. For this reason, it's a good idea to ensure you have a clean
Git workspace (or at least no changes to `package.json` and `yarn.lock` files)
before running `yarn pin-deps`.

```bash
yarn pin-deps

# Update the lockfile (in theory this won't fetch any updates, only change local resolutions)
yarn install

# Optionally dedupe and install --immutable to make sure everything is okay
yarn dedupe
yarn install --immutable
```

## Stability

We originally developed this plugin for Yarn v2, while pinning the dependencies
in our monorepo. It worked well, and we occasionally still use it when fixing an
accidental install of a non-pinned package. We're still using Yarn v2 in some
production projects, and this plugin is stable.

Porting it to v3 required [minimal changes][v2 to v3], and also gave the
opportunity to [add TypeScript annotations][v3 to typescript]. The underlying
JavaScript implementation is almost identical to that of the v2 version, and it
uses no v3 specific features. Early testing indicates it's stable, but we are
not yet running this version in production.

We use the `node-modules` linker, and so this plugin has not been tested with
any other linker. In theory, the `nodeLinker` setting should not affect behavior
of this plugin, as it looks only at manifest files and otherwise relies on the
Yarn plugin API for inspecting the project.

There are no tests, and it was written in a day, but it works. PRs welcome! :)

## Documentation

Documentation is available with `yarn pin-deps --help`:

```bash
❯ yarn pin-deps --help

Pin-deps [--dry] [--include name:range]

━━━ Usage ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

$ yarn pin-deps

━━━ Options ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  --dry             Print the changes to stdout but do not apply them to package.json files.
  --only-dev        Only devDependencies
  --ignore-dev      Ignore devDependencies (default is false, to pin dependencies and devDependencies).
  --verbose         Print more information about skipped or already pinned packages
  --only #0         To _only_ include a specific name:range package (or packages).
  --also #0         To pin a specific name:range that would otherwise be skipped
  --workspace #0    To _only_ include a specific workspace (or workspaces)

━━━ Details ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Pin any unpinned dependencies to their currently resolved version.Pass `--dry`
for a dry-run. Otherwise, write changes to `package.json`files directly. You
will still need to `yarn install` for the changesto take effect.Search all
workspaces by default. Pass `--workspace` flag(s) to focuson one or multiple
workspace(s).Search all packages with semver range references by default. To
includeotherwise skipped packages, specify `--include name:range`. To focusonly
on specific package(s), specify `--only name:range`

━━━ Examples ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Update package.json in every workspace, to pin all packages with          semver range to their currently resolved version.
  $ yarn pin-deps

Perform a "dry run" – do not apply any changes to files, but otherwise          run command as normally.
  $ yarn pin-deps --dry

Include (do not skip) any packages with reference next:canary
  $ yarn pin-deps --include next:canary

Include any package with range `canary` (not a regex, only works for this syntax)
  $ yarn pin-deps --include :canary

Include _only_ packages with reference next:canary or material-ui/core:latest
  $ yarn pin-deps --only next:canary --only material-ui/core:latest

Include _only_ workspaces by matching one of workspace.name, workspace.cwd, or workspace.relativeCwd
  $ yarn pin-deps --workspace acmeco/design --workspace acmeco/auth

Ignore devDependencies (pin only regular dependencies)
  $ yarn pin-deps --ignore-dev

Pin only devDependencies in acmeco/design or acmeco/components
  $ yarn pin-deps --only-dev --workspace acmeco/design --workspace acmeco/components

Hacky: print a specific package resolution (`yarn why` or `yarn info` is likely better)
  $ yarn pin-deps --dry --workspace @acmeco/design --only next:canary

Print verbose logs (including alerady pinned packages)
```

# Contributing

This monorepo uses Yarn 3, and the plugin is in `packages/plugin-pin-deps`,
which was scaffolded with [`@yarnpkg/builder`][yarnpkg builder].

## Install for development

After cloning the repository:

```bash
yarn set version berry
yarn install --immutable
```

Tip: If you need to setup `nvm`, make sure that you install `yarn` after
creating a new version of node:

```bash
nvm install
nvm use
npm install -g yarn
```

or try this, to [migrate global packages][nvm migrate global packages] while
installing:

```bash
nvm install --reinstall-packages-from=current
```

## Typecheck

```bash
yarn typecheck
```

## Build

```bash
yarn workspace plugin-pin-deps build
```

Main CLI:

```bash
yarn run scripts --help
```

## Format with Prettier

Try to format files, but exit 1 if any change is required:

```bash
yarn format.check
```

Try to format files, and write changes to any file that requires them:

```
yarn format
```

See [`.github/workflows/build.yml`][ci build steps] for CI commands.

## Upgrade everything at once, interactively

```bash
yarn up -E -i '*'
```

[v2 to v3]:
  https://github.com/splitgraph/yarn-plugin-pin-deps/compare/b13f58f64b75a9345bbdecc0ffc73592a4891a4f...32c00aeb7d4566bf6f7ad71c4fe81c149f42da2a?w=1
[v3 to typescript]:
  https://github.com/splitgraph/yarn-plugin-pin-deps/compare/32c00aeb7d4566bf6f7ad71c4fe81c149f42da2a...219943345a611141925db1c6fb6ebf3f442f3a82?w=1
[yarnpkg builder]:
  https://github.com/yarnpkg/berry/tree/master/packages/yarnpkg-builder
[nvm migrate global packages]:
  https://github.com/nvm-sh/nvm#migrating-global-packages-while-installing
[ci build steps]:
  https://github.com/splitgraph/yarn-plugin-pin-deps/blob/main/.github/workflows/build.yml#L14-L17
