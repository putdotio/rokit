export type PackageRootSpec = {
  readonly excluded: readonly string[];
  readonly included: readonly string[];
  readonly rules?: readonly PackagePathRule[];
};

export type PackagePathRule = {
  readonly included: boolean;
  readonly patterns: readonly string[];
  readonly roots: readonly string[];
  readonly supported: boolean;
};

export const defaultPackageRoots = [
  "manifest",
  "source",
  "components",
  "images",
  "locale",
] as const;

const defaultRokuDeployFiles = [
  "source/**/*.*",
  "components/**/*.*",
  "images/**/*.*",
  "locale/**/*.*",
  "manifest",
] as const;

export const packageRootSpecFromRokuDeployFiles = (
  files: readonly unknown[] | undefined,
): PackageRootSpec => {
  const included = new Set<string>();
  const excluded = new Set<string>();

  for (const entry of files ?? defaultRokuDeployFiles) {
    for (const pattern of packageFileEntryPatterns(entry)) {
      const isExcludedPattern = isNegatedPackagePattern(pattern);
      const roots = isExcludedPattern
        ? packageExcludedRootsFromFilePattern(pattern)
        : packageRootsFromFilePattern(pattern);
      const target = isExcludedPattern ? excluded : included;

      for (const root of roots) {
        target.add(root);
      }
    }
  }

  return {
    excluded: [...excluded],
    included: included.size === 0 ? defaultPackageRoots : [...included],
    rules: packagePathRulesFromRokuDeployFiles(files),
  };
};

export const isInsidePackageRoots = (
  relativeOutput: string,
  packageRoots: readonly string[],
): boolean => packageRoots.some((packageRoot) => isInsidePackageRoot(relativeOutput, packageRoot));

export const packageRulesIncludePath = (
  relativeOutput: string,
  rules: readonly PackagePathRule[],
): boolean => {
  let included = false;
  let hasUnknownMatchingRule = false;

  for (const rule of rules) {
    if (!isInsidePackageRoots(relativeOutput, rule.roots)) {
      continue;
    }

    if (!rule.supported) {
      hasUnknownMatchingRule = true;
      continue;
    }

    if (rule.patterns.some((pattern) => packagePatternMatchesPath(pattern, relativeOutput))) {
      included = rule.included;
      hasUnknownMatchingRule = false;
    }
  }

  return hasUnknownMatchingRule ? true : included;
};

const packageRootsFromFilePattern = (pattern: string): readonly string[] => {
  const normalized = normalizePackageFilePattern(pattern);

  if (normalized === undefined) {
    return [];
  }

  const root = normalized.split("/")[0];

  return packageRootsFromFirstSegment(root);
};

const packageExcludedRootsFromFilePattern = (pattern: string): readonly string[] => {
  const normalized = normalizePackageFilePattern(pattern);

  if (normalized === undefined) {
    return [];
  }

  const [root, ...rest] = normalized.split("/");
  const suffix = rest.join("/");

  if (suffix !== "**" && suffix !== "**/*") {
    return [];
  }

  return packageRootsFromFirstSegment(root);
};

const packagePathRulesFromRokuDeployFiles = (
  files: readonly unknown[] | undefined,
): readonly PackagePathRule[] => {
  const rules: PackagePathRule[] = [];

  for (const entry of files ?? defaultRokuDeployFiles) {
    for (const pattern of packageFileEntryPatterns(entry)) {
      const normalized = normalizePackageFilePattern(pattern);

      if (normalized === undefined) {
        continue;
      }

      rules.push({
        included: !isNegatedPackagePattern(pattern),
        patterns: expandBraceAlternates(normalized),
        roots: packageRootsFromFilePattern(pattern),
        supported: expandBraceAlternates(normalized).every(isSupportedPackageGlobPattern),
      });
    }
  }

  return rules;
};

const normalizePackageFilePattern = (pattern: string): string | undefined => {
  const trimmed = pattern.trim();
  const normalized = (isNegatedPackagePattern(trimmed) ? trimmed.replace(/^!+/, "") : trimmed)
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "");

  return normalized === "" ? undefined : normalized;
};

const isNegatedPackagePattern = (pattern: string): boolean => {
  const trimmed = pattern.trim();
  return trimmed.startsWith("!") && !trimmed.startsWith("!(");
};

const packageRootsFromFirstSegment = (root: string | undefined): readonly string[] => {
  if (root === undefined || root === "" || root === "." || root === "..") {
    return [];
  }

  if (root.startsWith("{") && root.endsWith("}")) {
    return root
      .slice(1, -1)
      .split(",")
      .filter((part) => part !== "" && !/[*?[\]{}()!+@|]/.test(part));
  }

  if (/[*?[\]{}()!+@|]/.test(root)) {
    return [""];
  }

  return [root];
};

const packageFileEntryPatterns = (entry: unknown): readonly string[] => {
  if (typeof entry === "string") {
    return [entry];
  }

  if (!isFileEntryObject(entry)) {
    return [];
  }

  if (typeof entry.src === "string") {
    return [entry.src];
  }

  if (Array.isArray(entry.src) && entry.src.every((item) => typeof item === "string")) {
    return entry.src;
  }

  return [];
};

const isFileEntryObject = (value: unknown): value is { readonly src?: unknown } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isInsidePackageRoot = (relativeOutput: string, packageRoot: string): boolean =>
  packageRoot === "" ||
  relativeOutput === packageRoot ||
  relativeOutput.startsWith(`${packageRoot}/`);

const isSupportedPackageGlobPattern = (pattern: string): boolean => !/[()[\]{}+@!|]/.test(pattern);

const packagePatternMatchesPath = (pattern: string, relativeOutput: string): boolean => {
  if (pathHasHiddenSegment(relativeOutput) && !patternAllowsHiddenSegments(pattern)) {
    return false;
  }

  return globPatternToRegExp(pattern).test(relativeOutput);
};

const expandBraceAlternates = (pattern: string): readonly string[] => {
  const match = /\{([^{}]+)\}/.exec(pattern);

  if (match === null) {
    return [pattern];
  }

  const [braced, alternates] = match;

  if (!alternates.includes(",")) {
    return [pattern];
  }

  const prefix = pattern.slice(0, match.index);
  const suffix = pattern.slice(match.index + braced.length);

  return alternates
    .split(",")
    .filter((alternate) => alternate !== "")
    .flatMap((alternate) => expandBraceAlternates(`${prefix}${alternate}${suffix}`));
};

const globPatternToRegExp = (pattern: string): RegExp => {
  let source = "";

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    const next = pattern[index + 1];
    const afterNext = pattern[index + 2];

    if (character === "*" && next === "*" && afterNext === "/") {
      source += "(?:.*/)?";
      index += 2;
      continue;
    }

    if (character === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }

    if (character === "*") {
      source += "[^/]*";
      continue;
    }

    if (character === "?") {
      source += "[^/]";
      continue;
    }

    source += escapeRegExpCharacter(character ?? "");
  }

  return new RegExp(`^${source}$`);
};

const pathHasHiddenSegment = (packagePath: string): boolean =>
  packagePath.split("/").some((segment) => segment.startsWith("."));

const patternAllowsHiddenSegments = (pattern: string): boolean =>
  pattern.split("/").some((segment) => segment.startsWith("."));

const escapeRegExpCharacter = (character: string): string =>
  /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
