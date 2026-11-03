import type { DesktopRelease, UpdateAsset } from "./updates";
import type { Readable } from "node:stream";
declare const mirror: {
  targets: string[];
  versionPattern: RegExp;
  installerName(version: string, target: string): string;
  compare(a: string, b: string): number;
  validateRelease(value: unknown, channelTarget?: string): DesktopRelease;
  readManifest(file: string, channelTarget?: string): Promise<DesktopRelease>;
  verifyAsset(file: string, asset: UpdateAsset): Promise<void>;
  importBundle(
    input: Readable,
    directory: string,
    channelTarget?: string,
  ): Promise<DesktopRelease>;
};
export = mirror;
