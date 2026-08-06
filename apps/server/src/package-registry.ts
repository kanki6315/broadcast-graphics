import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { GraphicPackageManifest } from "@racecontrol/protocol";

export class PackageRegistry {
  constructor(private readonly root: string) {}

  async list(): Promise<GraphicPackageManifest[]> {
    const entries = await readdir(this.root, { withFileTypes: true });
    const manifests = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const raw = await readFile(join(this.root, entry.name, "manifest.json"), "utf8");
      return JSON.parse(raw) as GraphicPackageManifest;
    }));
    return manifests.sort((a, b) => a.name.localeCompare(b.name));
  }
}
