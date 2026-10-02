import * as fs from "fs";
import * as path from "path";

/** What the logger remembers between runs. */
export interface LoggerState {
  topicId?: string;
  /** Consensus timestamp ("seconds.nanos") of the last log fully processed. */
  lastTimestamp: string;
  /** Keys (txHash:logIndex) already posted, most recent last. Capped at MAX_KEYS. */
  posted: string[];
}

export const MAX_KEYS = 5_000;

export interface StateStore {
  load(): LoggerState;
  save(state: LoggerState): void;
}

export const emptyState = (): LoggerState => ({ lastTimestamp: "0", posted: [] });

/** JSON file store. Writes to a temp file then renames, so a crash never leaves half a file. */
export class FileStateStore implements StateStore {
  constructor(private readonly file: string) {}

  load(): LoggerState {
    if (!fs.existsSync(this.file)) return emptyState();
    const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as Partial<LoggerState>;
    return { topicId: raw.topicId, lastTimestamp: raw.lastTimestamp ?? "0", posted: raw.posted ?? [] };
  }

  save(state: LoggerState): void {
    const trimmed = { ...state, posted: state.posted.slice(-MAX_KEYS) };
    fs.mkdirSync(path.dirname(path.resolve(this.file)), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(trimmed, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

export class MemoryStateStore implements StateStore {
  constructor(private state: LoggerState = emptyState()) {}

  load(): LoggerState {
    return structuredClone(this.state);
  }

  save(state: LoggerState): void {
    this.state = structuredClone({ ...state, posted: state.posted.slice(-MAX_KEYS) });
  }
}
