import type { LocalState } from "../shared/types";
declare global {
  interface Window {
    brainDesktop?: {
      edit(action: string): void;
      readState(id: string): Promise<LocalState | null>;
      writeState(id: string, data: LocalState): Promise<void>;
      selectFiles(): Promise<
        { name: string; content: string; image?: string }[]
      >;
      selectDirectory(): Promise<string | null>;
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
