// In-memory progress + cancellation registry.
//
// This mirrors the FastAPI backend's module-level `active_downloads` /
// `cancel_flags` dicts. It only works on a single, long-running Node server
// process (`next start` / Docker) — NOT on a serverless platform where each
// request may hit a different instance. The original Python version had the
// exact same constraint.

export type ProgressStatus =
  | "starting"
  | "downloading"
  | "processing"
  | "complete"
  | "error"
  | "cancelled";

export interface ProgressState {
  status: ProgressStatus;
  percent: number;
  total_size: string;
  downloaded: string;
  speed: string;
  eta: string;
}

declare global {
  // Persist across hot-reloads in dev (Next re-evaluates modules).
  // eslint-disable-next-line no-var
  var __rillixProgress:
    | {
        active: Map<string, ProgressState>;
        cancels: Map<string, () => void>;
      }
    | undefined;
}

const g = (globalThis.__rillixProgress ??= {
  active: new Map<string, ProgressState>(),
  cancels: new Map<string, () => void>(),
});

const TERMINAL: ProgressStatus[] = ["complete", "error", "cancelled"];

export function setProgress(clientId: string, state: ProgressState): void {
  g.active.set(clientId, state);
}

export function getProgress(clientId: string): ProgressState | undefined {
  return g.active.get(clientId);
}

export function isTerminal(status: ProgressStatus | undefined): boolean {
  return !!status && TERMINAL.includes(status);
}

/** Register a function used to abort an in-flight download (kills yt-dlp). */
export function registerCancel(clientId: string, fn: () => void): void {
  g.cancels.set(clientId, fn);
}

export function clearCancel(clientId: string): void {
  g.cancels.delete(clientId);
}

export function isCancelled(clientId: string): boolean {
  return g.active.get(clientId)?.status === "cancelled";
}

/** Mark a download cancelled and fire its abort handler if present. */
export function cancel(clientId: string): void {
  const fn = g.cancels.get(clientId);
  if (fn) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
  setProgress(clientId, {
    status: "cancelled",
    percent: 0,
    total_size: "Cancelled",
    downloaded: "",
    speed: "",
    eta: "",
  });
}
