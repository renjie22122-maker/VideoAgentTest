import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Durable execution ledger.
 *
 * The creative state stays in projects.json (atomic file replacement); this
 * ledger makes EXECUTION state durable across process restarts: agent runs,
 * agent tasks, generation job submission boundaries and usage records.
 * Primary backend is node:sqlite (Node ≥ 23.4); on older runtimes it degrades
 * to an append-only JSONL log with the same query semantics. Both backends
 * expose identical row shapes so callers never branch.
 */
export type LedgerBackend = 'sqlite' | 'jsonl';

export type AgentRunRow = {
  runId: string;
  projectId: string;
  status: string;
  steps: number;
  maxSteps: number;
  instruction: string;
  summary: string;
  updatedAt: number;
};

export type AgentTaskRow = {
  taskId: string;
  runId: string;
  projectId: string;
  kind: string;
  status: string;
  ownerRoleId: string;
  capability: string;
  dependsOn: string;
  inputRevision: number;
  outcome: string;
  reason: string;
  verificationAuthor: string;
  updatedAt: number;
};

export type GenerationJobRow = {
  jobId: string;
  projectId: string;
  shotId: string;
  kind: string;
  status: string;
  /** unsent | submitted | unknown — the durable submission boundary. */
  submission: string;
  providerJobId: string;
  leaseExpiresAt: number;
  attempt: number;
  createdAt: number;
  updatedAt: number;
};

export type UsageRow = {
  id: string;
  projectId: string;
  category: 'llm' | 'image' | 'video';
  provider: string;
  model: string;
  estimatedCost: number;
  jobId: string;
  createdAt: number;
};

export interface Ledger {
  backend: LedgerBackend;
  upsertAgentRun(row: AgentRunRow): void;
  upsertAgentTask(row: AgentTaskRow): void;
  upsertGenerationJob(row: GenerationJobRow): void;
  recordUsage(row: UsageRow): void;
  generationJob(jobId: string): GenerationJobRow | undefined;
  generationJobs(projectId: string): GenerationJobRow[];
  agentTasks(runId: string): AgentTaskRow[];
  usage(projectId: string): UsageRow[];
  close(): void;
}

type JsonlRow = { type: 'run' | 'task' | 'job' | 'usage' } & Record<string, unknown>;

let sqliteModule: typeof import('node:sqlite') | undefined;
try {
  sqliteModule = await import('node:sqlite');
} catch {
  sqliteModule = undefined;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_runs(
  run_id TEXT PRIMARY KEY, project_id TEXT, status TEXT, steps INTEGER,
  max_steps INTEGER, instruction TEXT, summary TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS agent_tasks(
  task_id TEXT PRIMARY KEY, run_id TEXT, project_id TEXT, kind TEXT, status TEXT,
  owner_role_id TEXT, capability TEXT, depends_on TEXT, input_revision INTEGER,
  outcome TEXT, reason TEXT, verification_author TEXT, updated_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_tasks_run ON agent_tasks(run_id);
CREATE TABLE IF NOT EXISTS generation_jobs(
  job_id TEXT PRIMARY KEY, project_id TEXT, shot_id TEXT, kind TEXT, status TEXT,
  submission TEXT, provider_job_id TEXT, lease_expires_at INTEGER, attempt INTEGER,
  created_at INTEGER, updated_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_jobs_project ON generation_jobs(project_id);
CREATE TABLE IF NOT EXISTS usage_records(
  id TEXT PRIMARY KEY, project_id TEXT, category TEXT, provider TEXT, model TEXT,
  estimated_cost REAL, job_id TEXT, created_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_usage_project ON usage_records(project_id);
`;

function sqliteLedger(dbPath: string): Ledger {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new sqliteModule!.DatabaseSync(dbPath);
  db.exec(SCHEMA);
  // Column migration for DBs created before the reason/verification columns.
  const columns = db.prepare('PRAGMA table_info(agent_tasks)').all() as { name: string }[];
  if (!columns.some((c) => c.name === 'reason'))
    db.exec("ALTER TABLE agent_tasks ADD COLUMN reason TEXT DEFAULT ''");
  if (!columns.some((c) => c.name === 'verification_author'))
    db.exec("ALTER TABLE agent_tasks ADD COLUMN verification_author TEXT DEFAULT ''");
  return {
    backend: 'sqlite',
    upsertAgentRun(row) {
      db.prepare(
        `INSERT INTO agent_runs(run_id,project_id,status,steps,max_steps,instruction,summary,updated_at)
         VALUES(?,?,?,?,?,?,?,?)
         ON CONFLICT(run_id) DO UPDATE SET status=excluded.status, steps=excluded.steps,
           summary=excluded.summary, updated_at=excluded.updated_at`,
      ).run(
        row.runId, row.projectId, row.status, row.steps, row.maxSteps,
        row.instruction.slice(0, 4000), row.summary.slice(0, 4000), row.updatedAt,
      );
    },
    upsertAgentTask(row) {
      db.prepare(
        `INSERT INTO agent_tasks(task_id,run_id,project_id,kind,status,owner_role_id,capability,depends_on,input_revision,outcome,reason,verification_author,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(task_id) DO UPDATE SET status=excluded.status, outcome=excluded.outcome,
           updated_at=excluded.updated_at`,
      ).run(
        row.taskId, row.runId, row.projectId, row.kind, row.status, row.ownerRoleId,
        row.capability, row.dependsOn.slice(0, 2000), row.inputRevision,
        row.outcome.slice(0, 200), row.reason.slice(0, 1500), row.verificationAuthor.slice(0, 100),
        row.updatedAt,
      );
    },
    upsertGenerationJob(row) {
      // A confirmed submission must never be downgraded by an unknown/empty
      // state arriving later (e.g. an expired lease path rewriting the row).
      const existing = db
        .prepare(`SELECT * FROM generation_jobs WHERE job_id = ?`)
        .get(row.jobId) as Record<string, unknown> | undefined;
      let submission = row.submission;
      let providerJobId = row.providerJobId;
      if (existing) {
        const storedSubmission = str(existing.submission, 'unsent');
        const storedProvider = str(existing.provider_job_id ?? existing.providerJobId);
        if (storedSubmission === 'submitted') {
          if (submission !== 'submitted') submission = storedSubmission;
          if (!providerJobId && storedProvider) providerJobId = storedProvider;
        }
      }
      db.prepare(
        `INSERT INTO generation_jobs(job_id,project_id,shot_id,kind,status,submission,provider_job_id,lease_expires_at,attempt,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(job_id) DO UPDATE SET status=excluded.status, submission=excluded.submission,
           provider_job_id=excluded.provider_job_id, lease_expires_at=excluded.lease_expires_at,
           attempt=excluded.attempt, updated_at=excluded.updated_at`,
      ).run(
        row.jobId, row.projectId, row.shotId, row.kind, row.status, submission,
        providerJobId, row.leaseExpiresAt, row.attempt, row.createdAt, row.updatedAt,
      );
    },
    recordUsage(row) {
      db.prepare(
        `INSERT INTO usage_records(id,project_id,category,provider,model,estimated_cost,job_id,created_at)
         VALUES(?,?,?,?,?,?,?,?)`,
      ).run(
        row.id, row.projectId, row.category, row.provider.slice(0, 100), row.model.slice(0, 200),
        row.estimatedCost, row.jobId, row.createdAt,
      );
    },
    generationJob(jobId) {
      const row = db.prepare(`SELECT * FROM generation_jobs WHERE job_id = ?`).get(jobId) as
        | Record<string, unknown>
        | undefined;
      return row ? toJobRow(row) : undefined;
    },
    generationJobs(projectId) {
      return (db.prepare(`SELECT * FROM generation_jobs WHERE project_id = ? ORDER BY created_at`).all(projectId) as Record<string, unknown>[]).map(toJobRow);
    },
    agentTasks(runId) {
      return (db.prepare(`SELECT * FROM agent_tasks WHERE run_id = ? ORDER BY updated_at`).all(runId) as Record<string, unknown>[]).map(toTaskRow);
    },
    usage(projectId) {
      return (db.prepare(`SELECT * FROM usage_records WHERE project_id = ? ORDER BY created_at`).all(projectId) as Record<string, unknown>[]).map(toUsageRow);
    },
    close() {
      db.close();
    },
  };
}

function jsonlLedger(dbPath: string): Ledger {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const file = dbPath.replace(/\.db$/, '.jsonl');
  const rows: JsonlRow[] = existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as JsonlRow)
    : [];
  const append = (type: JsonlRow['type'], row: Record<string, unknown>) => {
    rows.push({ type, ...row });
    try {
      appendFileSync(file, JSON.stringify({ type, ...row }) + '\n', 'utf8');
    } catch {
      // The in-memory view still serves this process; durability is best effort here.
    }
  };
  const latestOf = <T extends JsonlRow>(type: T['type'], key: string, value: unknown): T | undefined => {
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i] as T;
      if (row.type === type && row[key] === value) return row;
    }
    return undefined;
  };
  return {
    backend: 'jsonl',
    upsertAgentRun(row) {
      const previous = latestOf<JsonlRow & { seq: number }>('run', 'runId', row.runId);
      append('run', { ...row, seq: (previous?.seq ?? 0) + 1 });
    },
    upsertAgentTask(row) {
      const previous = latestOf<JsonlRow & { seq: number }>('task', 'taskId', row.taskId);
      append('task', { ...row, seq: (previous?.seq ?? 0) + 1 });
    },
    upsertGenerationJob(row) {
      const previous = latestOf<JsonlRow & { seq: number }>('job', 'jobId', row.jobId);
      let submission = row.submission;
      let providerJobId = row.providerJobId;
      if (previous && previous.submission === 'submitted') {
        if (submission !== 'submitted') submission = String(previous.submission);
        if (!providerJobId && typeof previous.providerJobId === 'string' && previous.providerJobId)
          providerJobId = previous.providerJobId;
      }
      append('job', {
        ...row,
        submission,
        providerJobId,
        seq: (previous?.seq ?? 0) + 1,
      });
    },
    recordUsage(row) {
      append('usage', row);
    },
    generationJob(jobId) {
      return latestOf('job', 'jobId', jobId) as GenerationJobRow | undefined;
    },
    generationJobs(projectId) {
      return rows.filter((r) => r.type === 'job' && r.projectId === projectId) as unknown as GenerationJobRow[];
    },
    agentTasks(runId) {
      return rows.filter((r) => r.type === 'task' && r.runId === runId) as unknown as AgentTaskRow[];
    },
    usage(projectId) {
      return rows.filter((r) => r.type === 'usage' && r.projectId === projectId) as unknown as UsageRow[];
    },
    close() {},
  };
}

const str = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
};
const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value ?? 0) || 0);

function toJobRow(row: Record<string, unknown>): GenerationJobRow {
  return {
    jobId: str(row.job_id ?? row.jobId),
    projectId: str(row.project_id ?? row.projectId),
    shotId: str(row.shot_id ?? row.shotId),
    kind: str(row.kind),
    status: str(row.status),
    submission: str(row.submission, 'unsent'),
    providerJobId: str(row.provider_job_id ?? row.providerJobId),
    leaseExpiresAt: num(row.lease_expires_at ?? row.leaseExpiresAt),
    attempt: num(row.attempt),
    createdAt: num(row.created_at ?? row.createdAt),
    updatedAt: num(row.updated_at ?? row.updatedAt),
  };
}
function toTaskRow(row: Record<string, unknown>): AgentTaskRow {
  return {
    taskId: str(row.task_id ?? row.taskId),
    runId: str(row.run_id ?? row.runId),
    projectId: str(row.project_id ?? row.projectId),
    kind: str(row.kind),
    status: str(row.status),
    ownerRoleId: str(row.owner_role_id ?? row.ownerRoleId),
    capability: str(row.capability),
    dependsOn: str(row.depends_on ?? row.dependsOn),
    inputRevision: num(row.input_revision ?? row.inputRevision),
    outcome: str(row.outcome),
    reason: str(row.reason),
    verificationAuthor: str(row.verification_author ?? row.verificationAuthor),
    updatedAt: num(row.updated_at ?? row.updatedAt),
  };
}
function toUsageRow(row: Record<string, unknown>): UsageRow {
  return {
    id: str(row.id),
    projectId: str(row.project_id ?? row.projectId),
    category: (row.category ?? 'llm') as UsageRow['category'],
    provider: str(row.provider),
    model: str(row.model),
    estimatedCost: num(row.estimated_cost ?? row.estimatedCost),
    jobId: str(row.job_id ?? row.jobId),
    createdAt: num(row.created_at ?? row.createdAt),
  };
}

let shared: Ledger | undefined;
let sharedPath = '';

/** Opens (or returns) the process-wide ledger for the current STUDIO_DATA_DIR. */
export function openLedger(): Ledger {
  const dbPath = path.resolve(process.env.STUDIO_DATA_DIR || '.studio', 'runtime.db');
  if (shared && sharedPath === dbPath) return shared;
  shared?.close();
  shared = sqliteModule ? sqliteLedger(dbPath) : jsonlLedger(dbPath);
  sharedPath = dbPath;
  return shared;
}

/** Run a ledger write without ever failing the caller: durability must not break commands. */
export function safely<T>(fn: (ledger: Ledger) => T): T | undefined {
  try {
    return fn(openLedger());
  } catch {
    return undefined;
  }
}

export function closeLedger(): void {
  shared?.close();
  shared = undefined;
}
