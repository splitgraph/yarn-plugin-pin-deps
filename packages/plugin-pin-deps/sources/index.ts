import { BaseCommand } from "@yarnpkg/cli";
import type {
  Descriptor,
  IdentHash,
  LocatorHash,
  Package,
  Plugin,
  Workspace,
} from "@yarnpkg/core";
import { Command, Option } from "clipanion";
import { getPluginConfiguration } from "@yarnpkg/cli";
import { ppath } from "@yarnpkg/fslib";

import {
  Cache,
  Project,
  Configuration,
  ThrowReport,
  StreamReport,
  semverUtils,
  structUtils,
  Manifest,
} from "@yarnpkg/core";

import { satisfies as semverSatisfies, gt as semverGt } from "semver";

const green = (text: string) => `\x1b[32m${text}\x1b[0m`;
const yellow = (text: string) => `\x1b[33m${text}\x1b[0m`;

const pRef = (
  pkg: Pick<Descriptor, "scope" | "name" | "range">,
  opts?: {
    highlight?: Partial<Record<keyof Descriptor, (text: any) => string>>;
  }
) => {
  const { scope, name, range } = pkg;
  const { highlight } = opts ?? {};

  const identity = <T = unknown>(x: T) => x;

  const hi = {
    all: typeof highlight === "function" ? highlight : identity,
    range: highlight?.range ?? identity,
    name: highlight?.name ?? identity,
    scope: highlight?.scope ?? identity,
  };

  return hi.all(
    `${scope ? `@${hi.scope(scope)}/` : ""}${hi.name(name)}:${hi.range(range)}`
  );
};

type Unpromise<T extends Promise<any>> = T extends Promise<infer U> ? U : never;

class PinDepsCommand extends BaseCommand {
  static paths = [["pin-deps"]];

  dryRun = Option.Boolean("--dry", {
    description:
      "Print the changes to stdout but do not apply them to package.json files.",
  });

  onlyDevDependencies = Option.Boolean("--only-dev", {
    description: "Only devDependencies",
  });

  ignoreDevDependencies = Option.Boolean("--ignore-dev", {
    description:
      "Ignore devDependencies (default is false, to pin dependencies and devDependencies).",
  });

  verbose = Option.Boolean("--verbose", {
    description:
      "Print more information about skipped or already pinned packages",
  });

  onlyPackages = Option.Array("--only", {
    description: `To _only_ include a specific name:range package (or packages).`,
  });

  alsoIncludePackages = Option.Array("--also", {
    description: `To pin a specific name:range that would otherwise be skipped`,
  });

  onlyWorkspaces = Option.Array("--workspace", {
    description: `To _only_ include a specific workspace (or workspaces)`,
  });

  configuration: Unpromise<ReturnType<typeof Configuration.find>>;
  project: Unpromise<ReturnType<typeof Project.find>>["project"];
  cache: Unpromise<ReturnType<typeof Cache.find>>;
  log: Unpromise<ReturnType<typeof StreamReport.start>>;

  locatorsByIdent: Map<IdentHash, Set<LocatorHash>>;
  workspaces: Workspace[];

  async execute() {
    this.configuration = await Configuration.find(
      this.context.cwd,
      getPluginConfiguration()
    );

    const { project } = await Project.find(
      this.configuration,
      this.context.cwd
    );

    this.project = project;

    this.cache = await Cache.find(this.configuration);

    await this.project.resolveEverything({
      cache: this.cache,
      report: new ThrowReport(),
    });

    // this.alsoIncludePackages;
    // this.onlyWorkspaces;
    // this.onlyPackages;

    await StreamReport.start(
      {
        configuration: this.configuration,
        stdout: this.context.stdout,
        includeLogs: true,
        json: false,
      },
      async (streamReport) => {
        this.log = streamReport;
        this.gatherWorkspaces();
        this.createLocatorsByIdentMap();
        await this.findPinnableDependencies();
        await this.pinDependencies();
      }
    );
  }

  createLocatorsByIdentMap() {
    const locatorsByIdent = new Map<IdentHash, Set<LocatorHash>>();
    for (const [
      descriptorHash,
      locatorHash,
    ] of this.project.storedResolutions.entries()) {
      const value = locatorHash;

      const descriptor = this.project.storedDescriptors.get(descriptorHash)!;
      const key = descriptor.identHash;

      const locators = locatorsByIdent.get(key);
      if (locators === undefined) {
        locatorsByIdent.set(key, new Set([value]));
      } else {
        locatorsByIdent.set(key, locators.add(value));
      }
    }

    this.locatorsByIdent = locatorsByIdent;

    return this.locatorsByIdent;
  }

  gatherWorkspaces() {
    let shouldCheckAllWorkspaces =
      !this.onlyWorkspaces || this.onlyWorkspaces.length === 0;

    this.workspaces = shouldCheckAllWorkspaces
      ? this.project.workspaces
      : this.project.workspaces.filter((workspace) => {
          let possibleWorkspaceRefs = [
            workspace.cwd,
            workspace.relativeCwd,
            workspace.manifest?.name?.name,
          ].filter((pwr) => !!pwr);

          let include = this.onlyWorkspaces!.some((givenWorkspaceRef) =>
            possibleWorkspaceRefs.includes(givenWorkspaceRef)
          );

          if (include) {
            this.log.reportWarning(
              0,
              `${green(`✓`)} Including workspace ${
                workspace.manifest.name!.name
              } at ${workspace.cwd}`
            );
          } else {
            this.logVerboseWarning(
              `gatherWorkspaces`,
              `${yellow(`x`)} Excluding workspace ${
                workspace.manifest.name!.name
              }, no match for ${possibleWorkspaceRefs
                .map((r) => `'${r}'`)
                .join(" or ")}`
            );
          }

          return include;
        });

    return this.workspaces;
  }

  async pinDependencies() {
    this.log.reportJson({
      type: `info`,
      name: `pinnableDependencies`,
      displayName: `pinnableDependencies`,
      data: this.pinnableJSON,
    });

    for (const workspace of this.workspaces) {
      const { manifest, cwd: workspaceCwd } = workspace;
      const manifestPath = ppath.join(workspaceCwd, Manifest.fileName);
      const needsPinning = this.pinnableByWorkspaceCwd.get(workspaceCwd);

      let numPinned = 0;
      for (const [identHash, { version }] of needsPinning!) {
        // May cause unpredictable behavior if a package is both dependency and devDependency
        let curDependency = manifest.dependencies.get(identHash);
        let curDevDependency = manifest.devDependencies.get(identHash);

        // note that curValue will be mutated when applying changes
        let curValue = curDependency ?? curDevDependency;

        // do not mutate oldValue. if typescript, would use readonly
        // (makes copy for name,scope,range – YMMV for other properties)
        const oldValue = { ...curValue } as Descriptor;

        // let curPkgRef = highlight => pRef({ ...oldValue }, {highlight})

        if (curDependency && curDevDependency) {
          this.log.reportWarning(
            0,
            `Possible package.json conflict between devDependencies and dependencies in ${
              curValue!.name
            } at ${manifestPath}`
          );
        }

        if (curValue?.range === version) {
          continue;
        }

        const newDependency = Object.assign(curValue!, {
          range: version,
        });

        if (curDependency) {
          manifest.dependencies.set(identHash, newDependency as Descriptor);
        } else if (curDevDependency) {
          manifest.devDependencies.set(identHash, newDependency as Descriptor);
        }

        this.log.reportInfo(
          0,
          `${green(`→`)} Pin ${pRef(oldValue, {
            highlight: { range: yellow },
          })} → ${pRef(newDependency as Descriptor, {
            highlight: { range: green },
          })} (${manifestPath})`
        );

        numPinned = numPinned + 1;
      }

      let needsPersist = numPinned > 0;

      if (needsPersist) {
        if (!this.dryRun) {
          await workspace.persistManifest();
          // console.log("(persist)");
        }

        this.log.reportInfo(
          0,
          `${green(`✓`)} Pinned ${numPinned} and ${
            this.dryRun ? `saved[DRY RUN]` : "saved"
          } to ${manifestPath}`
        );
      }
    }
  }

  // really should not be rolling our own here, but easier for specific use case
  static referencesPackage(
    refPkg: string,
    { scope, name, range }: Pick<Descriptor, "scope" | "name" | "range">
  ) {
    let candidatePkg = pRef({ scope, name, range } as Descriptor);

    let exactMatch = refPkg === candidatePkg;
    let rangeMatch = [`:${range}`, `*:${range}`].includes(refPkg);

    return exactMatch || rangeMatch;
  }

  isDependencyExplicitlyIncluded({
    scope,
    name,
    range,
  }: Pick<Descriptor, "scope" | "name" | "range">) {
    let included = (this.alsoIncludePackages ?? []).some((includeRef) =>
      PinDepsCommand.referencesPackage(includeRef, { scope, name, range })
    );
    let selected = (this.onlyPackages ?? []).some((selectRef) =>
      PinDepsCommand.referencesPackage(selectRef, { scope, name, range })
    );

    return included || selected;
  }

  logVerboseWarning(prefix: string, msg: string) {
    if (!this.verbose) {
      return;
    }

    return this.log.reportWarning(0, `${prefix} ${msg}`);
  }

  logVerboseInfo(prefix: string, msg: string) {
    if (!this.verbose) {
      return;
    }

    return this.log.reportInfo(0, `${prefix} ${msg}`);
  }

  pinnableByWorkspaceCwd: Map<Workspace["cwd"], Map<IdentHash, Package>>;
  reportablePinsByWorkspaceCwd: Map<Workspace["cwd"], Map<IdentHash, Package>>;

  async findPinnableDependencies() {
    this.pinnableByWorkspaceCwd = new Map<
      Workspace["cwd"],
      Map<IdentHash, Package>
    >();

    // simplified version of pinnableByWorkspaceCwd, for reporting
    // name:range -> version
    this.reportablePinsByWorkspaceCwd = new Map();

    for (let {
      manifest: { dependencies, devDependencies },
      cwd: workspaceCwd,
    } of this.workspaces) {
      let pinnableInWorkspace = new Map();
      this.pinnableByWorkspaceCwd.set(workspaceCwd, pinnableInWorkspace);

      let reportablePinsInWorkspace = new Map();
      this.reportablePinsByWorkspaceCwd.set(
        workspaceCwd,
        reportablePinsInWorkspace
      );

      // Process regular dependencies
      if (!this.onlyDevDependencies) {
        for (const [identHash, dependency] of dependencies) {
          this.processDependency([identHash, dependency], {
            workspaceCwd,
            pinnableInWorkspace,
            reportablePinsInWorkspace,
            isDevDependency: false,
          });
        }
      }

      // Process devDependencies
      if (this.onlyDevDependencies || !this.ignoreDevDependencies) {
        for (const [identHash, dependency] of devDependencies) {
          this.processDependency([identHash, dependency], {
            workspaceCwd,
            pinnableInWorkspace,
            reportablePinsInWorkspace,
            isDevDependency: true,
          });
        }
      }
    }
  }

  processDependency(
    [identHash, dependency]: [IdentHash, Descriptor],
    opts: {
      workspaceCwd: Workspace["cwd"];
      pinnableInWorkspace: Map<IdentHash, Package>;
      reportablePinsInWorkspace: Map<IdentHash, string>;
      isDevDependency?: boolean;
    }
  ) {
    const {
      workspaceCwd,
      pinnableInWorkspace,
      reportablePinsInWorkspace,
      isDevDependency: _isDevDependency = false,
    } = opts;

    const { scope, name, range } = dependency;
    const depPkgRef = pRef({ scope, name, range });

    // @ts-expect-error Possible error? Not changing as part of conversion to TS.
    let explicitlyIncluded = this.isDependencyExplicitlyIncluded({
      name,
      range,
    });

    if (!PinDepsCommand.needsPin(range)) {
      if (explicitlyIncluded) {
        this.logVerboseInfo(`${workspaceCwd}`, `Include: ${depPkgRef}`);
      } else {
        this.logVerboseWarning(`${workspaceCwd}`, `Skip: ${depPkgRef}`);
      }

      if (!explicitlyIncluded) {
        return;
      }
    }

    if (this.onlyPackages && !this.onlyPackages.includes(depPkgRef)) {
      this.logVerboseWarning(`${workspaceCwd}`, `Omit: ${depPkgRef}`);
      return;
    }

    const semverMatch = range.match(/^(.*)$/);

    // Adapt logic for package locator lookup from deduplicate plugin:
    // https://github.com/yarnplugins/yarn-plugin-deduplicate

    const locatorHashes = this.locatorsByIdent.get(identHash);

    let pinTo: Package;
    if (locatorHashes !== undefined && locatorHashes.size > 1) {
      const candidates = Array.from(locatorHashes)
        .map((locatorHash) => {
          const pkg = this.project.storedPackages.get(locatorHash);
          if (pkg === undefined) {
            throw new TypeError(
              `Can't find package for locator hash '${locatorHash}'`
            );
          }
          if (structUtils.isVirtualLocator(pkg)) {
            const sourceLocator = structUtils.devirtualizeLocator(pkg);
            return this.project.storedPackages.get(sourceLocator.locatorHash);
          }

          return pkg;
        })
        .filter((sourcePackage) => {
          if (!sourcePackage || sourcePackage?.version === null) {
            return false;
          }

          return explicitlyIncluded
            ? true
            : semverMatch === null
            ? false
            : semverSatisfies(sourcePackage.version, semverMatch[1]);
        })
        .sort((a, b) => {
          return explicitlyIncluded
            ? -1
            : semverGt(a!.version!, b!.version!)
            ? -1
            : 1;
        });

      if (candidates.length > 1) {
        // https://stackoverflow.com/questions/22566379
        const candidatePairs = candidates
          .map((v, i) => candidates.slice(i + 1).map((w) => [v, w]))
          .flat();

        let numDupes = 0;
        for (let [candidateA, candidateB] of candidatePairs) {
          if (!structUtils.areLocatorsEqual(candidateA!, candidateB!)) {
            numDupes = numDupes + 1;
          }
        }

        if (numDupes > 0) {
          this.log.reportWarningOnce(
            0,
            `Possible duplicate: ${depPkgRef} has ${candidates.length} candidates (${numDupes} conflicting pairs) in workspace ${workspaceCwd}`
          );
        }
      }

      pinTo = this.project.storedPackages.get(candidates[0]!.locatorHash)!;
    } else if (locatorHashes?.size === 1) {
      pinTo = this.project.storedPackages.get(Array.from(locatorHashes)[0])!;
    } else {
      this.log.reportWarning(
        0,
        `Missing locator: ${depPkgRef}, in workspace ${workspaceCwd}`
      );
    }

    if (pinTo!.version === range) {
      if (explicitlyIncluded) {
        this.log.reportInfo(0, `${yellow("-")} Already pinned: ${depPkgRef}`);
      } else {
        this.logVerboseWarning(
          `${workspaceCwd}`,
          `already pinned ${depPkgRef} to ${pinTo!.version}`
        );
      }
    } else {
      pinnableInWorkspace.set(identHash, pinTo!);
      reportablePinsInWorkspace.set(depPkgRef as IdentHash, pinTo!.version!);

      this.logVerboseInfo(
        `${workspaceCwd}`,
        `will pin ${depPkgRef} to ${pinTo!.version} in ${workspaceCwd}`
      );
    }
  }

  get pinnableJSON() {
    // https://stackoverflow.com/questions/57611237
    const toObject = <MK extends string, MV = unknown>(
      map = new Map<MK, MV>()
    ): { [k: string]: MV | { [k: string]: MV } } =>
      Object.fromEntries(
        Array.from(map.entries(), ([k, v]) =>
          v instanceof Map ? [k, toObject(v)] : [k, v]
        )
      );

    return toObject(this.reportablePinsByWorkspaceCwd);
  }

  static needsPin(range: Descriptor["range"]) {
    if (!semverUtils.validRange(range)) {
      return false;
    }

    return true;
  }
}

// Show descriptive usage for a --help argument passed to this command
PinDepsCommand.usage = Command.Usage({
  description: `pin-deps [--dry] [--include name:range]`,
  details: `
        Pin any unpinned dependencies to their currently resolved version.
        Pass \`--dry\` for a dry-run. Otherwise, write changes to \`package.json\`
        files directly. You will still need to \`yarn install\` for the changes
        to take effect.
        Search all workspaces by default. Pass \`--workspace\` flag(s) to focus
        on one or multiple workspace(s).
        Search all packages with semver range references by default. To include
        otherwise skipped packages, specify \`--include name:range\`. To focus
        only on specific package(s), specify \`--only name:range\`
      `,
  examples: [
    [
      `Update package.json in every workspace, to pin all packages with
          semver range to their currently resolved version.`,
      `$0 pin-deps`,
    ],
    [
      `Perform a "dry run" – do not apply any changes to files, but otherwise
          run command as normally.`,
      `$0 pin-deps --dry`,
    ],
    [
      `Include (do not skip) any packages with reference next:canary`,
      `$0 pin-deps --include next:canary`,
    ],
    [
      `Include any package with range \`canary\` (not a regex, only works for this syntax)`,
      `$0 pin-deps --include :canary`,
    ],
    [
      `Include _only_ packages with reference next:canary or material-ui/core:latest`,
      `$0 pin-deps --only next:canary --only material-ui/core:latest`,
    ],
    [
      `Include _only_ workspaces by matching one of workspace.name, workspace.cwd, or workspace.relativeCwd`,
      `$0 pin-deps --workspace acmeco/design --workspace acmeco/auth`,
    ],
    [
      `Ignore devDependencies (pin only regular dependencies)`,
      `$0 pin-deps --ignore-dev`,
    ],
    [
      `Pin only devDependencies in acmeco/design or acmeco/components`,
      `$0 pin-deps --only-dev --workspace acmeco/design --workspace acmeco/components`,
    ],
    [
      `Hacky: print a specific package resolution (\`yarn why\` or \`yarn info\` is likely better)`,
      `$0 pin-deps --dry --workspace @acmeco/design --only next:canary`,
    ],
    [`Print verbose logs (including alerady pinned packages)`, `$0 --verbose`],
  ],
});

const plugin: Plugin = {
  commands: [PinDepsCommand],
};

export default plugin;
