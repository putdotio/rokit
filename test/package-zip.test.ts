import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createPackageZip, packageChannel, resolveSafePackageOutputPath } from "../src/roku.js";

describe("package zip helper", () => {
  it("packages selected Roku roots with exclusions and file overrides", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-package-"));

    try {
      await mkdir(join(root, "source"), { recursive: true });
      await mkdir(join(root, "components/lab"), { recursive: true });
      await mkdir(join(root, "images"), { recursive: true });
      await writeFile(join(root, "manifest"), "title=Original\n");
      await writeFile(join(root, "source/Main.brs"), "sub Main()\nend sub\n");
      await writeFile(join(root, "source/BuildConfig.brs"), "old config\n");
      await writeFile(join(root, "components/lab/Lab.xml"), "<component />\n");
      await writeFile(join(root, "images/icon.png"), "png");

      const result = await createPackageZip({
        exclude: (path) => path === "components/lab" || path.startsWith("components/lab/"),
        outFile: "dist/channel.zip",
        overrides: [
          { contents: "title=Example Dev\n", path: "manifest" },
          { contents: "generated config\n", path: "source/BuildConfig.brs" },
        ],
        rootDir: root,
      });

      const zip = await JSZip.loadAsync(await readFile(result.path));

      expect(result).toMatchObject({
        fileCount: 4,
        path: resolve(root, "dist/channel.zip"),
      });
      expect(result.files).toEqual([
        "images/icon.png",
        "manifest",
        "source/BuildConfig.brs",
        "source/Main.brs",
      ]);
      expect(await zip.file("manifest")?.async("string")).toBe("title=Example Dev\n");
      expect(await zip.file("source/BuildConfig.brs")?.async("string")).toBe("generated config\n");
      expect(zip.file("components/lab/Lab.xml")).toBeNull();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects unsafe override paths", async () => {
    await expect(
      createPackageZip({
        outFile: "dist/channel.zip",
        overrides: [{ contents: "bad", path: "../manifest" }],
        rootDir: process.cwd(),
        roots: ["manifest"],
      }),
    ).rejects.toThrow("unsafe package path");
  });

  it("rejects outputs that can overwrite or enter packaged source roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-package-"));
    const outside = await mkdtemp(join(tmpdir(), "rokit-package-outside-"));

    try {
      await mkdir(join(root, "source"), { recursive: true });
      await writeFile(join(root, "manifest"), "title=Example\n");
      await writeFile(join(root, "source/Main.brs"), "sub Main()\nend sub\n");

      await expect(
        createPackageZip({
          outFile: "manifest",
          rootDir: root,
        }),
      ).rejects.toThrow("must end with .zip");
      await expect(
        createPackageZip({
          outFile: "source/channel.zip",
          rootDir: root,
        }),
      ).rejects.toThrow("outside packaged roots");
      await symlink(join(root, "source"), join(root, "dist"));
      await expect(
        createPackageZip({
          outFile: "dist/channel.zip",
          rootDir: root,
        }),
      ).rejects.toThrow("outside packaged roots");
      await symlink(join(root, "source"), join(outside, "linked-source"));
      await expect(
        createPackageZip({
          outFile: join(outside, "linked-source/channel.zip"),
          rootDir: root,
        }),
      ).rejects.toThrow("outside packaged roots");
      await mkdir(join(root, "dist"), { recursive: true });
      await symlink(join(root, "source/Main.brs"), join(root, "dist/channel.zip"));
      await expect(
        createPackageZip({
          outFile: "dist/channel.zip",
          rootDir: root,
        }),
      ).rejects.toThrow("must not be a symlink");
      await mkdir(join(root, "nested.zip/keep"), { recursive: true });
      await writeFile(join(root, "nested.zip/keep/file.txt"), "do not delete\n");
      await expect(
        createPackageZip({
          outFile: "nested.zip",
          rootDir: root,
        }),
      ).rejects.toThrow("already exists and is not a file");
      expect(await readFile(join(root, "nested.zip/keep/file.txt"), "utf8")).toBe(
        "do not delete\n",
      );
      expect(await readFile(join(root, "manifest"), "utf8")).toBe("title=Example\n");
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(outside, { force: true, recursive: true });
    }
  });

  it("skips missing optional roots and keeps Roku locale files", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-package-"));

    try {
      await mkdir(join(root, "source"), { recursive: true });
      await mkdir(join(root, "locale/en_US"), { recursive: true });
      await writeFile(join(root, "manifest"), "title=Localized\n");
      await writeFile(join(root, "source/Main.brs"), "sub Main()\nend sub\n");
      await writeFile(join(root, "locale/en_US/strings.xml"), "<strings />\n");

      const result = await createPackageZip({
        outFile: "dist/channel.zip",
        rootDir: root,
      });

      expect(result.files).toEqual(["locale/en_US/strings.xml", "manifest", "source/Main.brs"]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("keeps hidden files out of createPackageZip archives by default", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-package-"));

    try {
      await mkdir(join(root, "components"), { recursive: true });
      await mkdir(join(root, "source/.hidden"), { recursive: true });
      await writeFile(join(root, "manifest"), "title=Example\n");
      await writeFile(join(root, "components/.secret.xml"), "<secret />\n");
      await writeFile(join(root, "source/.env"), "TOKEN=secret\n");
      await writeFile(join(root, "source/.hidden/Secret.brs"), "sub Main()\nend sub\n");
      await writeFile(join(root, "source/Main.brs"), "sub Main()\nend sub\n");

      const result = await createPackageZip({
        outFile: "dist/channel.zip",
        rootDir: root,
      });
      const zip = await JSZip.loadAsync(await readFile(result.path));

      expect(result.files).toEqual(["manifest", "source/Main.brs"]);
      expect(zip.file("components/.secret.xml")).toBeNull();
      expect(zip.file("source/.env")).toBeNull();
      expect(zip.file("source/.hidden/Secret.brs")).toBeNull();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("still requires the manifest when using default roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-package-"));

    try {
      await mkdir(join(root, "source"), { recursive: true });
      await writeFile(join(root, "source/Main.brs"), "sub Main()\nend sub\n");

      await expect(
        createPackageZip({
          outFile: "dist/channel.zip",
          rootDir: root,
        }),
      ).rejects.toThrow("NotFound");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects symlinked package files before following them", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-package-"));
    const outside = await mkdtemp(join(tmpdir(), "rokit-package-outside-"));

    try {
      await mkdir(join(root, "source"), { recursive: true });
      await writeFile(join(root, "manifest"), "title=Example\n");
      await writeFile(join(outside, "secret.txt"), "secret\n");
      await symlink(join(outside, "secret.txt"), join(root, "source/secret.txt"));

      await expect(
        createPackageZip({
          outFile: "dist/channel.zip",
          rootDir: root,
        }),
      ).rejects.toThrow("must not be a symlink");
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(outside, { force: true, recursive: true });
    }
  });

  it("packages a channel with the public package helper", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-package-"));

    try {
      await mkdir(join(root, "source/screens"), { recursive: true });
      await writeFile(join(root, "manifest"), "title=Example\n");
      await writeFile(join(root, "source/Main.brs"), "sub Main()\nend sub\n");
      await writeFile(join(root, "source/screens/Details.xml"), "<component />\n");

      const result = await packageChannel("out/channel", root);
      const zip = await JSZip.loadAsync(await readFile(result.path));

      expect(result.path).toBe(resolve(root, "out/channel.zip"));
      expect(await zip.file("manifest")?.async("string")).toBe("title=Example\n");
      expect(await zip.file("source/Main.brs")?.async("string")).toBe("sub Main()\nend sub\n");
      expect(await zip.file("source/screens/Details.xml")?.async("string")).toBe("<component />\n");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("keeps hidden files out of native packages by default", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-package-"));

    try {
      await mkdir(join(root, "components"), { recursive: true });
      await mkdir(join(root, "source/.hidden"), { recursive: true });
      await writeFile(join(root, "manifest"), "title=Example\n");
      await writeFile(join(root, "components/.secret.xml"), "<secret />\n");
      await writeFile(join(root, "source/.env"), "TOKEN=secret\n");
      await writeFile(join(root, "source/.hidden/Secret.brs"), "sub Main()\nend sub\n");
      await writeFile(join(root, "source/Main.brs"), "sub Main()\nend sub\n");

      const result = await packageChannel("out/channel", root);
      const zip = await JSZip.loadAsync(await readFile(result.path));

      expect(result.path).toBe(resolve(root, "out/channel.zip"));
      expect(await zip.file("manifest")?.async("string")).toBe("title=Example\n");
      expect(await zip.file("source/Main.brs")?.async("string")).toBe("sub Main()\nend sub\n");
      expect(zip.file("components/.secret.xml")).toBeNull();
      expect(zip.file("source/.env")).toBeNull();
      expect(zip.file("source/.hidden/Secret.brs")).toBeNull();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects native package symlinks that point elsewhere in the app root", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-package-"));

    try {
      await mkdir(join(root, ".rokit"), { recursive: true });
      await mkdir(join(root, "source"), { recursive: true });
      await writeFile(join(root, "manifest"), "title=Example\n");
      await writeFile(join(root, ".rokit/.env"), "TOKEN=secret\n");
      await symlink(join(root, ".rokit/.env"), join(root, "source/leak.txt"));

      await expect(packageChannel("out/channel", root)).rejects.toThrow("must not be a symlink");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("keeps squashfs package outputs on the Roku deploy compatibility path", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-package-"));

    try {
      await mkdir(join(root, "source"), { recursive: true });
      await writeFile(join(root, "manifest"), "title=Example\n");
      await writeFile(join(root, "source/Main.brs"), "sub Main()\nend sub\n");

      const result = await packageChannel("out/channel.squashfs", root);
      const zip = await JSZip.loadAsync(await readFile(result.path));

      expect(result.path).toBe(resolve(root, "out/channel.squashfs"));
      expect(await zip.file("manifest")?.async("string")).toBe("title=Example\n");
      expect(await zip.file("source/Main.brs")?.async("string")).toBe("sub Main()\nend sub\n");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("requires manifest on the native public package path", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-package-"));

    try {
      await mkdir(join(root, "source"), { recursive: true });
      await writeFile(join(root, "source/Main.brs"), "sub Main()\nend sub\n");

      await expect(packageChannel("out/channel", root)).rejects.toThrow("manifest");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("reports malformed Roku deploy config as a typed package error", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-package-"));
    const previousCwd = process.cwd();

    try {
      await mkdir(join(root, "source"), { recursive: true });
      await writeFile(join(root, "manifest"), "title=Example\n");
      await writeFile(join(root, "source/Main.brs"), "sub Main()\nend sub\n");
      await writeFile(join(root, "rokudeploy.json"), "{");

      process.chdir(root);
      await expect(resolveSafePackageOutputPath("out/channel", root)).rejects.toThrow(
        "failed to read Roku package options",
      );
      await expect(packageChannel("out/channel", root)).rejects.toThrow(
        "failed to read Roku package options",
      );
    } finally {
      process.chdir(previousCwd);
      await rm(root, { force: true, recursive: true });
    }
  });

  it("keeps the public package helper output outside packaged source roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-package-"));
    const outside = await mkdtemp(join(tmpdir(), "rokit-package-outside-"));
    const previousCwd = process.cwd();

    try {
      await mkdir(join(root, "source"), { recursive: true });
      await writeFile(join(root, "manifest"), "title=Example\n");
      await writeFile(join(root, "source/Main.brs"), "sub Main()\nend sub\n");

      await expect(packageChannel("source/channel", root)).rejects.toThrow(
        "outside packaged roots",
      );
      await mkdir(join(outside, "dist"), { recursive: true });
      await symlink(join(outside, "dist"), join(root, "dist"));
      await expect(packageChannel("dist/channel", root)).rejects.toThrow(
        "must stay within the app root",
      );
      await rm(join(root, "dist"), { force: true });
      await expect(packageChannel(join(outside, "channel"), root)).rejects.toThrow(
        "must stay within the app root",
      );
      await symlink(join(root, "source"), join(root, "dist"));
      await expect(packageChannel("dist/channel", root)).rejects.toThrow("outside packaged roots");
      await symlink(join(root, "source"), join(outside, "linked-source"));
      await expect(packageChannel(join(outside, "linked-source/channel"), root)).rejects.toThrow(
        "outside packaged roots",
      );
      await mkdir(join(root, "dist-file-link"), { recursive: true });
      await symlink(join(root, "source/Main.brs"), join(root, "dist-file-link/channel.zip"));
      await expect(packageChannel("dist-file-link/channel", root)).rejects.toThrow(
        "must not be a symlink",
      );
      await symlink(join(root, "source/missing.zip"), join(root, "dist-file-link/broken.zip"));
      await expect(packageChannel("dist-file-link/broken", root)).rejects.toThrow(
        "must not be a symlink",
      );
      await mkdir(join(root, "out/channel.zip"), { recursive: true });
      await writeFile(join(root, "out/channel.zip/keep.txt"), "do not delete\n");
      await expect(packageChannel("out/channel", root)).rejects.toThrow(
        "already exists and is not a file",
      );
      expect(await readFile(join(root, "out/channel.zip/keep.txt"), "utf8")).toBe(
        "do not delete\n",
      );
      await rm(join(root, "out"), { force: true, recursive: true });
      await writeFile(join(root, "rokudeploy.json"), JSON.stringify({ files: ["**/*"] }));
      process.chdir(root);
      await expect(packageChannel("out/channel", root)).rejects.toThrow("outside packaged roots");
      await writeFile(
        join(root, "rokudeploy.json"),
        JSON.stringify({ files: [{ dest: "", src: ["**/*"] }] }),
      );
      await expect(packageChannel("out/channel", root)).rejects.toThrow("outside packaged roots");
      await writeFile(
        join(root, "rokudeploy.json"),
        JSON.stringify({ files: ["{source,components}/**/*", "manifest"] }),
      );
      await expect(packageChannel("out/channel", root)).resolves.toMatchObject({
        path: resolve(root, "out/channel.zip"),
      });
      await expect(packageChannel("source/channel", root)).rejects.toThrow(
        "outside packaged roots",
      );
      await writeFile(
        join(root, "rokudeploy.json"),
        JSON.stringify({ files: ["source/**/*.{brs,xml,zip}", "manifest"] }),
      );
      await expect(packageChannel("source/channel", root)).rejects.toThrow(
        "outside packaged roots",
      );
      await writeFile(
        join(root, "rokudeploy.json"),
        JSON.stringify({ files: ["source/**/*.+(brs|xml|zip)", "manifest"] }),
      );
      await expect(packageChannel("source/channel", root)).rejects.toThrow(
        "outside packaged roots",
      );
    } finally {
      process.chdir(previousCwd);
      await rm(root, { force: true, recursive: true });
      await rm(outside, { force: true, recursive: true });
    }
  });

  it("allows package output roots that are explicitly excluded from roku-deploy files", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-package-"));
    const previousCwd = process.cwd();

    try {
      await mkdir(join(root, "source"), { recursive: true });
      await writeFile(join(root, "manifest"), "title=Example\n");
      await writeFile(join(root, "source/Main.brs"), "sub Main()\nend sub\n");
      await writeFile(
        join(root, "rokudeploy.json"),
        JSON.stringify({ files: ["source/**/*", "manifest", "!dist/**/*"] }),
      );

      process.chdir(root);
      await expect(packageChannel("dist/channel", root)).resolves.toMatchObject({
        path: resolve(root, "dist/channel.zip"),
      });
      await rm(join(root, "dist"), { force: true, recursive: true });
      await writeFile(
        join(root, "rokudeploy.json"),
        JSON.stringify({ files: ["**/*", "!dist/**/*"] }),
      );
      await expect(packageChannel("dist/channel", root)).resolves.toMatchObject({
        path: resolve(root, "dist/channel.zip"),
      });
      await rm(join(root, "dist"), { force: true, recursive: true });
      await writeFile(
        join(root, "rokudeploy.json"),
        JSON.stringify({ files: ["**/*", "!dist/keep.zip"] }),
      );
      await expect(packageChannel("dist/channel", root)).rejects.toThrow("outside packaged roots");
      await writeFile(
        join(root, "rokudeploy.json"),
        JSON.stringify({ files: ["**/*", "!dist/**/*.brs"] }),
      );
      await expect(packageChannel("dist/channel", root)).rejects.toThrow("outside packaged roots");
      await writeFile(
        join(root, "rokudeploy.json"),
        JSON.stringify({ files: ["**/*", "!dist/**/*", "dist/**/*"] }),
      );
      await expect(packageChannel("dist/channel", root)).rejects.toThrow("outside packaged roots");
      await writeFile(
        join(root, "rokudeploy.json"),
        JSON.stringify({ files: ["!dist/**/*", "**/*"] }),
      );
      await expect(packageChannel("dist/channel", root)).rejects.toThrow("outside packaged roots");
      await writeFile(join(root, "rokudeploy.json"), JSON.stringify({ files: ["!(dist)/**/*"] }));
      await expect(packageChannel("source/channel", root)).rejects.toThrow(
        "outside packaged roots",
      );
      await writeFile(
        join(root, "rokudeploy.json"),
        JSON.stringify({ files: ["!dist/**/*", "!(source)/**/*"] }),
      );
      await expect(packageChannel("dist/channel", root)).rejects.toThrow("outside packaged roots");
      await writeFile(
        join(root, "rokudeploy.json"),
        JSON.stringify({ files: ["source/file{1..3}.zip"] }),
      );
      await expect(packageChannel("source/file1", root)).rejects.toThrow("outside packaged roots");
    } finally {
      process.chdir(previousCwd);
      await rm(root, { force: true, recursive: true });
    }
  });

  it("keeps the public package helper backed by Roku deploy config", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-package-"));
    const previousCwd = process.cwd();

    try {
      await mkdir(join(root, "extra"), { recursive: true });
      await mkdir(join(root, "source"), { recursive: true });
      await writeFile(join(root, "manifest"), "title=Configured\n");
      await writeFile(join(root, "source/Main.brs"), "sub Main()\nend sub\n");
      await writeFile(join(root, "extra/config.json"), "{}\n");
      await writeFile(
        join(root, "rokudeploy.json"),
        JSON.stringify({ files: ["manifest", "extra/**/*"] }),
      );

      process.chdir(root);
      const result = await packageChannel("out/channel", root);
      const zip = await JSZip.loadAsync(await readFile(result.path));

      expect(await zip.file("manifest")?.async("string")).toBe("title=Configured\n");
      expect(await zip.file("extra/config.json")?.async("string")).toBe("{}\n");
      expect(zip.file("source/Main.brs")).toBeNull();
    } finally {
      process.chdir(previousCwd);
      await rm(root, { force: true, recursive: true });
    }
  });

  it("keeps manifest mutation configs on the Roku deploy compatibility path", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-package-"));
    const previousCwd = process.cwd();

    try {
      await mkdir(join(root, "source"), { recursive: true });
      await writeFile(join(root, "manifest"), "title=Configured\nbuild_version=1\n");
      await writeFile(join(root, "source/Main.brs"), "sub Main()\nend sub\n");
      await writeFile(
        join(root, "rokudeploy.json"),
        JSON.stringify({ files: ["manifest", "source/**/*"], incrementBuildNumber: true }),
      );

      process.chdir(root);
      const result = await packageChannel("out/channel", root);
      const zip = await JSZip.loadAsync(await readFile(result.path));
      const manifest = await zip.file("manifest")?.async("string");

      expect(manifest).toContain("title=Configured");
      expect(manifest).not.toContain("build_version=1");
      expect(manifest).toMatch(/build_version=\d{10}/);
    } finally {
      process.chdir(previousCwd);
      await rm(root, { force: true, recursive: true });
    }
  });

  it("detects Roku deploy configs before applying configured rootDir", async () => {
    const root = await mkdtemp(join(tmpdir(), "rokit-package-"));
    const previousCwd = process.cwd();

    try {
      await mkdir(join(root, "app/source"), { recursive: true });
      await writeFile(join(root, "app/manifest"), "title=Configured\nbuild_version=1\n");
      await writeFile(join(root, "app/source/Main.brs"), "sub Main()\nend sub\n");
      await writeFile(
        join(root, "rokudeploy.json"),
        JSON.stringify({
          files: ["manifest", "source/**/*"],
          incrementBuildNumber: true,
          rootDir: "app",
        }),
      );

      process.chdir(root);
      const result = await packageChannel("out/channel");
      const zip = await JSZip.loadAsync(await readFile(result.path));
      const manifest = await zip.file("manifest")?.async("string");

      expect(manifest).toContain("title=Configured");
      expect(manifest).not.toContain("build_version=1");
      expect(manifest).toMatch(/build_version=\d{10}/);
    } finally {
      process.chdir(previousCwd);
      await rm(root, { force: true, recursive: true });
    }
  });
});
