import type { DesktopRelease, UpdateAsset } from "./updates";
import type { Readable } from "node:stream";
declare const mirror: {
  targets: string[];
  versionPattern: RegExp;
  installerName(version: string, target: string): string;
  compare(a: string, b: string): number;
  validateRelease(value: unknown): DesktopRelease;
  readManifest(file: string): Promise<DesktopRelease>;
  verifyAsset(file: string, asset: UpdateAsset): Promise<void>;
  importBundle(input: Readable, directory: string): Promise<DesktopRelease>;
};
export = mirror;
