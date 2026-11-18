import fs from "node:fs";
import { parse as parseEnv } from "dotenv";
import { vi } from "vitest";

const originalStdinIsTTY = process.stdin.isTTY;
const originalStdoutIsTTY = process.stdout.isTTY;

export function clackPromptsMock(): Record<string, unknown> {
  return {
    intro: vi.fn(),
    outro: vi.fn(),
    cancel: vi.fn(),
    note: vi.fn(),
    confirm: vi.fn(),
    select: vi.fn(),
    isCancel: vi.fn(() => false),
    log: {
      error: vi.fn(),
      info: vi.fn(),
      message: vi.fn(),
      step: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
    },
  };
}

export function setTty(value: boolean) {
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value });
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value });
}

export function restoreTty() {
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: originalStdinIsTTY });
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: originalStdoutIsTTY });
}

export function readEnvEntries(envPath: string): Record<string, string> {
  return fs.existsSync(envPath) ? parseEnv(fs.readFileSync(envPath, "utf8")) : {};
}

export function loggedText(log: Record<"error" | "info" | "message" | "success" | "warn", unknown>): string {
  return (["error", "info", "message", "success", "warn"] as const)
    .flatMap((level) => vi.mocked(log[level] as (message: string) => void).mock.calls)
    .map((call) => String(call[0]))
    .join("\n");
}
