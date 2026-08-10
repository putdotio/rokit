import { existsSync } from "node:fs";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import type { PlatformError } from "effect/PlatformError";
import JSZip from "jszip";
import * as rokuDeploy from "roku-deploy";
import {
  defaultPackageRoots,
  isInsidePackageRoots,
  packageRootSpecFromRokuDeployFiles,
  packageRulesIncludePath,
  type PackageRootSpec,
} from "./package-path-rules.js";

export type PackageResult = {
  readonly path: string;
};

export type PackageFileContent = string | Uint8Array;

export type PackageFileOverride = {
  readonly contents: PackageFileContent;
  readonly path: string;
};

export type PackageZipOptions = {
  readonly exclude?: (path: string) => boolean;
  readonly overrides?: readonly PackageFileOverride[];
  readonly outFile: string;
  readonly rootDir: string;
  readonly roots?: readonly string[];
  readonly skipMissingRoots?: boolean;
};

export type PackageZipResult = {
  readonly fileCount: number;
  readonly files: readonly string[];
  readonly path: string;
};

class PackageZipError extends Schema.TaggedError<PackageZipError>()("PackageZipError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

const requiredDefaultPackageRoots = new Set<string>(["manifest"]);
const deterministicPackageDate = new Date("2020-01-01T00:00:00Z");
const nodePackageLayer = Layer.merge(NodeFileSystem.layer, NodePath.layer);

export const packageChannelEffect = Effect.fn("packageChannel")(function* (
  outputPath: string,
  rootDir?: string,
) {
  const path = yield* Path.Path;
  const fallbackRootDir = path.resolve(rootDir ?? process.cwd());
  const baseOptions = yield* packageOptionsEffect(outputPath, rootDir);
  const options = yield* getRokuDeployOptionsEffect(baseOptions, fallbackRootDir);
  const outputZipPath = yield* resolvePackageChannelOutputPath(options, fallbackRootDir);
  const hasRokuDeployConfig = yield* hasRokuDeployConfigEffect(fallbackRootDir);
  const nativeOptions =
    hasRokuDeployConfig || !canUseNativePackageZip(outputZipPath)
      ? undefined
      : nativePackageOptionsFromRokuDeploy(options, outputZipPath, fallbackRootDir);

  if (nativeOptions !== undefined) {
    const result = yield* createPackageZipEffect(nativeOptions);
    return { path: result.path };
  }

  yield* Effect.tryPromise({
    try: () => rokuDeploy.createPackage(options),
    catch: (error) =>
      new PackageZipError({
        detail: `failed to package Roku channel: ${formatErrorMessage(error)}`,
      }),
  });

  return { path: outputZipPath };
});

export const resolvePackageOutputPathEffect = Effect.fn("resolvePackageOutputPath")(function* (
  outputPath: string,
  rootDir?: string,
) {
  const path = yield* Path.Path;
  const fallbackRootDir = path.resolve(rootDir ?? process.cwd());
  const options = yield* packageOptionsEffect(outputPath, rootDir);
  return yield* getRokuDeployOutputZipFilePathEffect(options, fallbackRootDir);
});

export const createPackageZipEffect = Effect.fn("createPackageZip")(function* (
  options: PackageZipOptions,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const rootDir = path.resolve(options.rootDir);
  const rootRealPath = yield* fs.realPath(rootDir);
  const overrides = new Map<string, PackageFileContent>();
  const files = new Set<string>();
  const roots = options.roots ?? defaultPackageRoots;
  const packageRoots: string[] = [];

  for (const root of roots) {
    packageRoots.push(yield* normalizePackagePath(root));
  }

  const outFile = yield* resolvePackageZipOutputPath(
    rootDir,
    rootRealPath,
    options.outFile,
    { excluded: [], included: packageRoots },
    [".zip"],
  );

  for (const override of options.overrides ?? []) {
    const packagePath = yield* normalizePackagePath(override.path);
    overrides.set(packagePath, override.contents);
    files.add(packagePath);
  }

  const usingDefaultRoots = options.roots === undefined;

  for (const packagePath of packageRoots) {
    const skipMissingRoot =
      (options.skipMissingRoots === true && !requiredDefaultPackageRoots.has(packagePath)) ||
      (usingDefaultRoots && !requiredDefaultPackageRoots.has(packagePath));
    const rootFiles = yield* collectPackageZipFiles(
      rootDir,
      rootRealPath,
      packagePath,
      options.exclude,
      skipMissingRoot,
    );

    for (const file of rootFiles) {
      files.add(file);
    }
  }

  const sortedFiles = [...files].sort();
  const zip = new JSZip();

  for (const file of sortedFiles) {
    const content = overrides.get(file) ?? (yield* readPackageFile(rootDir, rootRealPath, file));
    const isPng = file.endsWith(".png");
    zip.file(file, content, {
      compression: isPng ? "STORE" : "DEFLATE",
      compressionOptions: isPng ? null : { level: 9 },
      createFolders: false,
      date: deterministicPackageDate,
      unixPermissions: "644",
    });
  }

  const output = yield* Effect.tryPromise({
    try: () =>
      zip.generateAsync({
        compression: "DEFLATE",
        compressionOptions: { level: 9 },
        platform: "UNIX",
        streamFiles: false,
        type: "uint8array",
      }),
    catch: (error) =>
      new PackageZipError({
        detail: `failed to generate package zip: ${formatErrorMessage(error)}`,
      }),
  });

  yield* fs.makeDirectory(path.dirname(outFile), { recursive: true });
  yield* assertPackageOutputFile(outFile);
  yield* Effect.scoped(
    Effect.gen(function* () {
      const tempFile = yield* fs.makeTempFileScoped({
        directory: path.dirname(outFile),
        prefix: `.${path.basename(outFile)}-`,
      });
      yield* fs.writeFile(tempFile, output);
      yield* fs.rename(tempFile, outFile);
    }),
  );

  return {
    fileCount: sortedFiles.length,
    files: sortedFiles,
    path: outFile,
  };
});

export const packageChannel = async (
  outputPath: string,
  rootDir?: string,
): Promise<PackageResult> =>
  await Effect.runPromise(provideNodePackage(packageChannelEffect(outputPath, rootDir)));

export const resolvePackageOutputPath = (outputPath: string, rootDir?: string): string =>
  Effect.runSync(provideNodePackage(resolvePackageOutputPathEffect(outputPath, rootDir)));

export const resolveSafePackageOutputPath = async (
  outputPath: string,
  rootDir?: string,
): Promise<string> =>
  await Effect.runPromise(
    provideNodePackage(resolveSafePackageOutputPathEffect(outputPath, rootDir)),
  );

export const resolveSafePackageOutputPathEffect = Effect.fn("resolveSafePackageOutputPath")(
  function* (outputPath: string, rootDir?: string) {
    const path = yield* Path.Path;
    const fallbackRootDir = path.resolve(rootDir ?? process.cwd());
    const baseOptions = yield* packageOptionsEffect(outputPath, rootDir);
    const options = yield* getRokuDeployOptionsEffect(baseOptions, fallbackRootDir);
    return yield* resolvePackageChannelOutputPath(options, fallbackRootDir);
  },
);

export const createPackageZip = async (options: PackageZipOptions): Promise<PackageZipResult> =>
  await Effect.runPromise(provideNodePackage(createPackageZipEffect(options)));

const collectPackageZipFiles: (
  rootDir: string,
  rootRealPath: string,
  relativePath: string,
  exclude: ((path: string) => boolean) | undefined,
  skipMissingRoot?: boolean,
) => Effect.Effect<
  readonly string[],
  PackageZipError | PlatformError,
  FileSystem.FileSystem | Path.Path
> = Effect.fn("collectPackageZipFiles")(function* (
  rootDir: string,
  rootRealPath: string,
  relativePath: string,
  exclude: ((path: string) => boolean) | undefined,
  skipMissingRoot = false,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolutePath = path.join(rootDir, relativePath);
  const exists = yield* fs.exists(absolutePath);

  if (!exists && skipMissingRoot) {
    return [];
  }

  if (hasHiddenPackageSegment(relativePath)) {
    return [];
  }

  yield* rejectPackageSymlink(absolutePath);
  yield* assertInsidePackageRoot(rootRealPath, absolutePath);
  const info = yield* fs.stat(absolutePath);

  if (info.type === "File") {
    return exclude?.(relativePath) === true ? [] : [relativePath];
  }

  if (info.type !== "Directory") {
    return [];
  }

  const files: string[] = [];
  for (const entry of yield* fs.readDirectory(absolutePath)) {
    const childPath = yield* normalizePackagePath(`${relativePath}/${entry}`);

    files.push(...(yield* collectPackageZipFiles(rootDir, rootRealPath, childPath, exclude)));
  }

  return files;
});

const readPackageFile = Effect.fn("readPackageFile")(function* (
  rootDir: string,
  rootRealPath: string,
  relativePath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolutePath = path.join(rootDir, relativePath);
  yield* rejectPackageSymlink(absolutePath);
  yield* assertInsidePackageRoot(rootRealPath, absolutePath);
  return yield* fs.readFile(absolutePath);
});

const rejectPackageSymlink = Effect.fn("rejectPackageSymlink")(function* (absolutePath: string) {
  const fs = yield* FileSystem.FileSystem;
  const linkTarget = yield* Effect.match(fs.readLink(absolutePath), {
    onFailure: () => undefined,
    onSuccess: (target) => target,
  });

  if (linkTarget === undefined) {
    return;
  }

  return yield* Effect.fail(
    new PackageZipError({ detail: `package path must not be a symlink: ${absolutePath}` }),
  );
});

const assertInsidePackageRoot = Effect.fn("assertInsidePackageRoot")(function* (
  rootRealPath: string,
  absolutePath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const realPath = yield* fs.realPath(absolutePath);
  const relative = path.relative(rootRealPath, realPath);

  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return;
  }

  return yield* Effect.fail(
    new PackageZipError({ detail: `package path resolves outside root: ${absolutePath}` }),
  );
});

const assertPackageOutputFile = Effect.fn("assertPackageOutputFile")(function* (
  outputPath: string,
) {
  const fs = yield* FileSystem.FileSystem;

  if (!(yield* fs.exists(outputPath))) {
    return;
  }

  const info = yield* fs.stat(outputPath);
  if (info.type === "File") {
    return;
  }

  return yield* Effect.fail(
    new PackageZipError({
      detail: `package output path already exists and is not a file: ${outputPath}`,
    }),
  );
});

const normalizePackagePath = Effect.fn("normalizePackagePath")(function* (packagePath: string) {
  yield* rejectUnsafeInput(packagePath, "package path");

  const normalized = packagePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
  const segments = normalized.split("/");

  if (
    normalized === "" ||
    normalized.startsWith("/") ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return yield* Effect.fail(
      new PackageZipError({ detail: `unsafe package path: ${packagePath}` }),
    );
  }

  return normalized;
});

const rejectUnsafeInput = Effect.fn("rejectUnsafeInput")(function* (value: string, label: string) {
  if (
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    return yield* Effect.fail(
      new PackageZipError({ detail: `${label} contains control characters` }),
    );
  }
});

const hasHiddenPackageSegment = (packagePath: string): boolean =>
  packagePath.split("/").some((segment) => segment.startsWith("."));

const resolvePackageZipOutputPath = Effect.fn("resolvePackageZipOutputPath")(function* (
  rootDir: string,
  rootRealPath: string,
  outputPath: string,
  packageRoots: PackageRootSpec,
  allowedExtensions: readonly string[],
  sandboxRealPath = rootRealPath,
) {
  yield* rejectUnsafeInput(outputPath, "package output path");

  const path = yield* Path.Path;
  const resolvedOutput = path.isAbsolute(outputPath)
    ? path.resolve(outputPath)
    : path.resolve(rootDir, outputPath);

  const extension = path.extname(resolvedOutput).toLowerCase();
  if (!allowedExtensions.includes(extension)) {
    return yield* Effect.fail(
      new PackageZipError({
        detail: `package output path must end with ${formatAllowedExtensions(allowedExtensions)}: ${outputPath}`,
      }),
    );
  }

  yield* assertPackageOutputFile(resolvedOutput);

  const relativeOutput = path.relative(rootDir, resolvedOutput).replace(/\\/g, "/");
  const isInsideRoot =
    relativeOutput !== "" && !relativeOutput.startsWith("..") && !path.isAbsolute(relativeOutput);

  const realOutput = yield* resolveRealOutputCandidatePath(resolvedOutput);
  const relativeRealOutput = path.relative(rootRealPath, realOutput).replace(/\\/g, "/");
  const realOutputIsInsideRoot =
    relativeRealOutput !== "" &&
    !relativeRealOutput.startsWith("..") &&
    !path.isAbsolute(relativeRealOutput);
  const relativeSandboxOutput = path.relative(sandboxRealPath, realOutput).replace(/\\/g, "/");
  const realOutputIsInsideSandbox =
    relativeSandboxOutput !== "" &&
    !relativeSandboxOutput.startsWith("..") &&
    !path.isAbsolute(relativeSandboxOutput);

  if (!realOutputIsInsideSandbox) {
    return yield* Effect.fail(
      new PackageZipError({
        detail: `package output path must stay within the app root: ${outputPath}`,
      }),
    );
  }

  if (realOutputIsInsideRoot) {
    yield* rejectPackageOutputInsideRoots(outputPath, relativeRealOutput, packageRoots);
  }

  if (!isInsideRoot) {
    return resolvedOutput;
  }

  yield* rejectPackageOutputInsideRoots(outputPath, relativeOutput, packageRoots);

  return resolvedOutput;
});

const resolvePackageChannelOutputPath = Effect.fn("resolvePackageChannelOutputPath")(function* (
  options: ReturnType<typeof rokuDeploy.getOptions>,
  fallbackRootDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const rootDir = path.resolve(options.rootDir ?? fallbackRootDir);
  const rootRealPath = yield* fs.realPath(rootDir);
  const sandboxRealPath = yield* fs.realPath(path.resolve(fallbackRootDir));
  const outputZipPath = yield* getRokuDeployOutputZipFilePathEffect(options, rootDir);
  const packageRootSpec = packageRootSpecFromRokuDeployFiles(options.files);
  const includedPackageRoots: string[] = [];
  const excludedPackageRoots: string[] = [];

  for (const root of packageRootSpec.included) {
    includedPackageRoots.push(root === "" ? root : yield* normalizePackagePath(root));
  }

  for (const root of packageRootSpec.excluded) {
    excludedPackageRoots.push(root === "" ? root : yield* normalizePackagePath(root));
  }

  return yield* resolvePackageZipOutputPath(
    rootDir,
    rootRealPath,
    outputZipPath,
    {
      excluded: excludedPackageRoots,
      included: includedPackageRoots,
      rules: packageRootSpec.rules,
    },
    [".squashfs", ".zip"],
    sandboxRealPath,
  );
});

const formatAllowedExtensions = (extensions: readonly string[]): string =>
  extensions.length === 1
    ? extensions[0]!
    : `${extensions.slice(0, -1).join(", ")} or ${extensions[extensions.length - 1]}`;

const canUseNativePackageZip = (outputPath: string): boolean =>
  outputPath.toLowerCase().endsWith(".zip");

const rejectPackageOutputInsideRoots = Effect.fn("rejectPackageOutputInsideRoots")(function* (
  outputPath: string,
  relativeOutput: string,
  packageRoots: PackageRootSpec,
) {
  if (packageRoots.rules !== undefined) {
    const includedByRules = packageRulesIncludePath(relativeOutput, packageRoots.rules);

    if (includedByRules === true) {
      return yield* Effect.fail(
        new PackageZipError({
          detail: `package output path must be outside packaged roots: ${outputPath}`,
        }),
      );
    }

    if (includedByRules === false) {
      return;
    }
  }

  if (isInsidePackageRoots(relativeOutput, packageRoots.excluded)) {
    return;
  }

  for (const packageRoot of packageRoots.included) {
    if (packageRoot === "") {
      return yield* Effect.fail(
        new PackageZipError({
          detail: `package output path must be outside packaged roots: ${outputPath}`,
        }),
      );
    }

    if (isInsidePackageRoots(relativeOutput, [packageRoot])) {
      return yield* Effect.fail(
        new PackageZipError({
          detail: `package output path must be outside packaged roots: ${outputPath}`,
        }),
      );
    }
  }
});

const resolveRealOutputCandidatePath = Effect.fn("resolveRealOutputCandidatePath")(function* (
  outputPath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const linkTarget = yield* Effect.match(fs.readLink(outputPath), {
    onFailure: () => undefined,
    onSuccess: (target) => target,
  });

  if (linkTarget !== undefined) {
    return yield* Effect.fail(
      new PackageZipError({
        detail: `package output path must not be a symlink: ${outputPath}`,
      }),
    );
  }

  if (yield* fs.exists(outputPath)) {
    return yield* fs.realPath(outputPath);
  }

  const pendingSegments = [path.basename(outputPath)];
  let ancestor = path.dirname(outputPath);

  while (!(yield* fs.exists(ancestor))) {
    pendingSegments.unshift(path.basename(ancestor));
    const parent = path.dirname(ancestor);

    if (parent === ancestor) {
      break;
    }

    ancestor = parent;
  }

  const realAncestor = yield* fs.realPath(ancestor);
  return path.join(realAncestor, ...pendingSegments);
});

const provideNodePackage = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
): Effect.Effect<A, E> => Effect.provide(effect, nodePackageLayer);

const packageOptionsEffect = Effect.fn("packageOptions")(function* (
  outputPath: string,
  rootDir: string | undefined,
) {
  const path = yield* Path.Path;
  const resolvedRoot = path.resolve(rootDir ?? process.cwd());
  const resolvedOutput = path.isAbsolute(outputPath)
    ? path.resolve(outputPath)
    : path.resolve(resolvedRoot, outputPath);

  const options = {
    outDir: path.dirname(resolvedOutput),
    outFile: path.basename(resolvedOutput),
  };

  return rootDir === undefined ? options : { ...options, rootDir: resolvedRoot };
});

type RokuDeployInputOptions = {
  readonly outDir: string;
  readonly outFile: string;
  readonly rootDir?: string;
};

type RokuDeployResolvedOptions = ReturnType<typeof rokuDeploy.getOptions>;

const nativePackageOptionsFromRokuDeploy = (
  options: RokuDeployResolvedOptions,
  outputZipPath: string,
  fallbackRootDir: string,
): PackageZipOptions | undefined => {
  const files = options.files;
  const rootSpec = packageRootSpecFromRokuDeployFiles(files);
  const rules = rootSpec.rules ?? [];

  if (
    !usesOnlyStringFileEntries(files) ||
    rules.some((rule) => !rule.supported) ||
    rootSpec.included.some((root) => root === "")
  ) {
    return undefined;
  }

  return {
    exclude: (packagePath) => !packageRulesIncludePath(packagePath, rules),
    outFile: outputZipPath,
    rootDir: options.rootDir ?? fallbackRootDir,
    roots: rootSpec.included,
    skipMissingRoots: true,
  };
};

const usesOnlyStringFileEntries = (files: readonly unknown[] | undefined): boolean =>
  files === undefined || files.every((entry) => typeof entry === "string");

const hasRokuDeployConfigEffect = Effect.fn("hasRokuDeployConfig")(function* (rootDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return (
    (yield* fs.exists(path.join(rootDir, "rokudeploy.json"))) ||
    (yield* fs.exists(path.join(rootDir, "bsconfig.json")))
  );
});

const getRokuDeployOptionsEffect = Effect.fn("getRokuDeployOptions")(function* (
  options: RokuDeployInputOptions,
  configRootDir: string,
) {
  return yield* Effect.try({
    try: () => withCwd(configRootDir, () => rokuDeploy.getOptions(options)),
    catch: (error) =>
      new PackageZipError({
        detail: `failed to read Roku package options: ${formatErrorMessage(error)}`,
      }),
  });
});

const getRokuDeployOutputZipFilePathEffect = Effect.fn("getRokuDeployOutputZipFilePath")(function* (
  options: RokuDeployInputOptions | RokuDeployResolvedOptions,
  configRootDir = process.cwd(),
) {
  return yield* Effect.try({
    try: () => withCwd(configRootDir, () => rokuDeploy.getOutputZipFilePath(options)),
    catch: (error) =>
      new PackageZipError({
        detail: `failed to resolve Roku package output path: ${formatErrorMessage(error)}`,
      }),
  });
});

const withCwd = <A>(cwd: string, run: () => A): A => {
  if (!existsSync(cwd)) {
    return run();
  }

  const previousCwd = process.cwd();
  process.chdir(cwd);
  try {
    return run();
  } finally {
    process.chdir(previousCwd);
  }
};

const formatErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
