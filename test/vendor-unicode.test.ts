import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const repositoryRoot = new URL("../", import.meta.url);

const unicodeFiles = [
  {
    file: "CaseFolding.txt",
    bytes: 84_870,
    displayBytes: "84,870",
    sha256: "4e55acfdc32825a22e87670e9056a3bf94ad7c5400065778e9e10f8314372bcf",
    header: "# CaseFolding-15.1.0.txt\n",
    upstream: "https://www.unicode.org/Public/15.1.0/ucd/CaseFolding.txt",
  },
  {
    file: "DerivedAge.txt",
    bytes: 131_154,
    displayBytes: "131,154",
    sha256: "04e16379344bdb9973cdb6f6bf0a5dd66f7cd41b014cd9f79d848768ae757256",
    header: "# DerivedAge-15.1.0.txt\n",
    upstream: "https://www.unicode.org/Public/15.1.0/ucd/DerivedAge.txt",
  },
] as const;

function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

describe("vendored Unicode portability data", () => {
  it.each(unicodeFiles)(
    "pins $file byte-for-byte",
    async ({ file, bytes, sha256: digest, header }) => {
      const content = await readFile(new URL(`vendor/unicode/15.1.0/${file}`, repositoryRoot));

      expect(content.byteLength).toBe(bytes);
      expect(sha256(content)).toBe(digest);
      expect(content.toString("utf8").startsWith(header)).toBe(true);
    },
  );

  it("carries the exact official Unicode License V3 text", async () => {
    const license = await readFile(new URL("LICENSES/Unicode-3.0.txt", repositoryRoot));

    expect(license.byteLength).toBe(1_995);
    expect(sha256(license)).toBe(
      "e7a93b009565cfce55919a381437ac4db883e9da2126fa28b91d12732bc53d96",
    );
    expect(license.toString("utf8")).toMatch(/^UNICODE LICENSE V3\n/u);
  });

  it("records sources, integrity values, and the complete license", async () => {
    const notice = await readFile(new URL("THIRD_PARTY_NOTICES.md", repositoryRoot), "utf8");
    const readme = await readFile(
      new URL("vendor/unicode/15.1.0/README.md", repositoryRoot),
      "utf8",
    );

    for (const entry of unicodeFiles) {
      expect(notice).toContain(`- <${entry.upstream}>`);
      expect(readme).toContain(
        `| \`${entry.file}\` | <${entry.upstream}> | ${entry.displayBytes} | \`${entry.sha256}\` |`,
      );
    }
    expect(notice).toContain("[`LICENSES/Unicode-3.0.txt`](LICENSES/Unicode-3.0.txt)");
    expect(readme).toContain("[`LICENSES/Unicode-3.0.txt`](../../../LICENSES/Unicode-3.0.txt)");
    expect(notice).toContain("SPDX license identifier: `Unicode-3.0`");
    expect(readme).toContain("Source retrieval date: 2026-08-19");
  });

  it("ships notices and licenses while excluding generation inputs", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("package.json", repositoryRoot), "utf8"),
    ) as { readonly files: readonly string[] };

    expect(manifest.files).toEqual([
      "dist/",
      "schemas/",
      "LICENSES/",
      "LICENSE",
      "README.md",
      "THIRD_PARTY_NOTICES.md",
    ]);
  });
});
