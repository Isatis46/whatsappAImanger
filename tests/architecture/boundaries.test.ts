import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { it, expect } from "vitest";
async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
      ),
    )
  ).flat();
}
it("domain and application have no framework, database, queue or adapter imports", async () => {
  const sources = (await files("packages/modules")).filter(
    (p) => /\/(domain|application)\//.test(p) && p.endsWith(".ts"),
  );
  expect(sources.length).toBeGreaterThan(3);
  for (const file of sources) {
    const text = await readFile(file, "utf8");
    const imports = [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
      (m) => m[1]!,
    );
    for (const imported of imports)
      expect(imported, `${file}: ${imported}`).not.toMatch(
        /@nestjs|baileys|drizzle|bullmq|\bnext\b|adapters|persistence|\.repository/,
      );
  }
});
it("package import graph has no cycles", async () => {
  const sources = (await files("packages")).filter((p) => p.endsWith(".ts"));
  const paths = new Set(sources.map((p) => resolve(p)));
  const graph = new Map<string, string[]>();
  for (const file of sources) {
    const text = await readFile(file, "utf8");
    graph.set(
      resolve(file),
      [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)]
        .map((m) => resolve(file, "..", m[1]!.replace(/\.js$/, ".ts")))
        .filter((p) => paths.has(p)),
    );
  }
  const done = new Set<string>(),
    visiting = new Set<string>();
  function visit(p: string) {
    if (done.has(p)) return;
    expect(visiting.has(p), `circular dependency: ${p}`).toBe(false);
    visiting.add(p);
    for (const dep of graph.get(p) ?? []) visit(dep);
    visiting.delete(p);
    done.add(p);
  }
  for (const file of paths) visit(file);
});
