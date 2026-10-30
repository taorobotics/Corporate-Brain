import type { LocalState } from "../shared/types";
declare global {
  interface Window {
    brainDesktop?: {
      allowBootstrap?: boolean;
      canChangeServer?: boolean;
      updates?: import("../shared/updates").UpdateBridge;
      edit(action: string): void;
      readState(id: string): Promise<LocalState | null>;
      writeState(id: string, data: LocalState): Promise<void>;
      selectFiles(): Promise<
        { name: string; content: string; image?: string }[]
      >;
      selectDirectory(): Promise<string | null>;
      inspectWorkspace(folder: string): Promise<{
        root: string;
        files: { name: string; size: number; content: string; image?: string }[];
        skipped: number;
        truncated: boolean;
      }>;
      changeServer(): Promise<void>;
      saveFile(
        name: string,
        content: string,
        base64?: boolean,
      ): Promise<boolean>;
      windowAction(action: "minimize" | "maximize" | "close"): void;
      onMenu(callback: (action: string) => void): () => void;
    };
  }
}
export {};
