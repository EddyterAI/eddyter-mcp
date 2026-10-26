/**
 * Tiny JSON-file persistence for the OAuth provider's state.
 *
 * Without it, every restart wipes registered clients and tokens: MCP clients
 * (Claude, the OpenAI plugin portal) keep using the client_id they registered
 * and get "Invalid client_id" until they re-register, and every user has to
 * reconnect. A single file is enough for the single-instance deployment; swap
 * this for Redis if the server ever runs as more than one process.
 *
 * Writes go to a temp file first and are renamed into place, so a crash
 * mid-write never leaves a truncated file behind.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export class JsonFileState<T extends object> {
  constructor(private readonly path: string | undefined) {}

  load(): Partial<T> {
    if (!this.path || !existsSync(this.path)) return {};
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as Partial<T>;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[eddyter-mcp:oauth] could not read ${this.path}, starting empty:`, (e as Error).message);
      return {};
    }
  }

  save(data: T): void {
    if (!this.path) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
      renameSync(tmp, this.path);
    } catch (e) {
      // Persistence is best-effort: keep serving from memory if the disk fails.
      // eslint-disable-next-line no-console
      console.error(`[eddyter-mcp:oauth] could not write ${this.path}:`, (e as Error).message);
    }
  }
}
