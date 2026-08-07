import type { IPathAdapter } from "../types";

export const webPath: IPathAdapter = {
  async homeDir(): Promise<string> {
    return "/";
  },
  async join(...paths: string[]): Promise<string> {
    return paths.join("/").replace(/\/+/g, "/");
  },
  async appConfigDir(): Promise<string> {
    return "/.config/yamet";
  },
};
