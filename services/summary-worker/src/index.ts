import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { Pool } from "pg";
import {
  HOSTED_ENV_KEYS,
  HOSTED_SUMMARY_DEFAULT_MODEL_ID,
  type HostedActionItemRecord,
  type HostedSessionRecord,
  type HostedSessionSummaryRecord,
  type HostedTranscriptSegmentRecord
} from "@voice/shared/hosted";

type SummaryJobType = "final-summary";

type TranscriptRow = HostedTranscriptSegmentRecord;

type SummaryRow = HostedSessionSummaryRecord & {
  modelRunMetadata: Record<string, unknown>;
};

type ActionItemDraft = {
  text: string;
  status: HostedActionItemRecord["status"];
};

function normalizeActionItemStatus(value: unknown): ActionItemDraft["status"] {
  return value === "done" || value === "blocked" ? value : "open";
}

type ClaimedSummaryJob = {
  modelRunId: string;
  session: HostedSessionRecord;
  jobType: SummaryJobType;
  transcriptSegments: readonly TranscriptRow[];
  latestSummary: SummaryRow | null;
  latestSummarySequence: number;
};

type SummaryPayload = {
  overview: string;
  keyPoints: string[];
  followUps: string[];
  actionItems: ActionItemDraft[];
};

type WorkerConfig = {
  postgresUrl: string;
  workerId: string;
  pollIntervalMs: number;
  claimTimeoutMs: number;
  modelId: string;
  llmServerUrl: string | null;
  maxTranscriptChars: number;
};

const stopRequested = {
  value: false
};

function env(name: string, defaultValue?: string) {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    return defaultValue ?? null;
  }
  return value;
}

function requireEnv(name: string) {
  const value = env(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseIntEnv(name: string, defaultValue: number) {
  const raw = env(name);
  if (!raw) {
    return defaultValue;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer.`);
  }

  return parsed;
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  return `${prefix}-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function shortenText(text: string, maxLength = 140) {
  const normalized = normalizeText(text);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function uniqueStrings(values: readonly string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function extractJsonObject<T>(value: string): T | null {
  const direct = safeJsonParse<T>(value);
  if (direct !== null) {
    return direct;
  }

  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return safeJsonParse<T>(value.slice(start, end + 1));
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? normalizeText(entry) : ""))
    .filter(Boolean);
}

function buildWorkerConfig(): WorkerConfig {
  return {
    postgresUrl: requireEnv(HOSTED_ENV_KEYS.postgresUrl),
    workerId: env("HOSTED_WORKER_ID", `summary-worker-${randomUUID().slice(0, 8)}`) ?? "summary-worker",
    pollIntervalMs: parseIntEnv(HOSTED_ENV_KEYS.summaryPollIntervalMs, 4000),
    claimTimeoutMs: Math.max(60000, parseIntEnv(HOSTED_ENV_KEYS.summaryClaimTimeoutMs, 120000)),
    modelId: env(HOSTED_ENV_KEYS.summaryModelId, HOSTED_SUMMARY_DEFAULT_MODEL_ID) ?? HOSTED_SUMMARY_DEFAULT_MODEL_ID,
    llmServerUrl: env(HOSTED_ENV_KEYS.llmServerUrl),
    maxTranscriptChars: Math.max(1200, parseIntEnv(HOSTED_ENV_KEYS.summaryMaxTranscriptChars, 12000))
  };
}

function mapSession(row: Record<string, unknown>): HostedSessionRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    sourceType: String(row.source_type) as HostedSessionRecord["sourceType"],
    status: String(row.status) as HostedSessionRecord["status"],
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    startedAt: row.started_at ? new Date(String(row.started_at)).toISOString() : null,
    endedAt: row.ended_at ? new Date(String(row.ended_at)).toISOString() : null,
    metadata: ((row.metadata ?? {}) as Record<string, string | number | boolean | null>) ?? {}
  };
}

function mapTranscript(row: Record<string, unknown>): TranscriptRow {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    audioChunkId: row.audio_chunk_id ? String(row.audio_chunk_id) : null,
    modelRunId: row.model_run_id ? String(row.model_run_id) : null,
    sequenceNumber: Number(row.sequence_number),
    speakerLabel: row.speaker_label ? String(row.speaker_label) : null,
    text: String(row.text),
    startMs: Number(row.start_ms),
    endMs: Number(row.end_ms),
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    createdAt: new Date(String(row.created_at)).toISOString()
  };
}

function mapSummary(row: Record<string, unknown>): SummaryRow {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    modelRunId: row.model_run_id ? String(row.model_run_id) : null,
    overview: String(row.overview),
    keyPoints: Array.isArray(row.key_points) ? (row.key_points as string[]) : [],
    followUps: Array.isArray(row.follow_ups) ? (row.follow_ups as string[]) : [],
    createdAt: new Date(String(row.created_at)).toISOString(),
    modelRunMetadata: ((row.model_run_metadata ?? {}) as Record<string, unknown>) ?? {}
  };
}

function determineLatestSummarySequence(summary: SummaryRow | null) {
  const rawValue = summary?.modelRunMetadata.lastSequenceNumber;
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    return rawValue;
  }
  if (typeof rawValue === "string") {
    const parsed = Number(rawValue);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return -1;
}

function buildTranscriptExcerpt(segments: readonly TranscriptRow[], maxChars: number) {
  const lines: string[] = [];
  let currentLength = 0;

  for (const segment of segments) {
    const line = `#${segment.sequenceNumber} ${segment.speakerLabel ?? "Speaker"} (${Math.floor(segment.startMs / 1000)}s-${Math.floor(segment.endMs / 1000)}s): ${normalizeText(segment.text)}`;
    if (!line.trim()) {
      continue;
    }
    const nextLength = currentLength + line.length + 1;
    if (lines.length > 0 && nextLength > maxChars) {
      break;
    }
    lines.push(line);
    currentLength = nextLength;
  }

  return lines.join("\n");
}

function extractHeuristicFollowUps(segments: readonly TranscriptRow[]) {
  const triggerPattern = /\b(next step|follow up|follow-up|send|share|schedule|confirm|review|prepare|deliver|email|call back|circle back|action item)\b/i;
  return uniqueStrings(
    segments
      .map((segment) => normalizeText(segment.text))
      .filter((text) => triggerPattern.test(text))
      .map((text) => shortenText(text, 140))
  ).slice(0, 5);
}

function buildFallbackSummary(segments: readonly TranscriptRow[]): SummaryPayload {
  const transcriptPoints = uniqueStrings(segments.map((segment) => shortenText(segment.text, 140)));
  const keyPoints = transcriptPoints.slice(0, 5);
  const followUps = extractHeuristicFollowUps(segments);
  const overviewSeed = keyPoints.slice(0, 2);
  const overview =
    overviewSeed.length === 0
      ? "The session completed, but the transcript did not contain enough detail for a useful summary."
      : overviewSeed.length === 1
        ? `The conversation mainly covered ${overviewSeed[0]}.`
        : `The conversation mainly covered ${overviewSeed[0]} and ${overviewSeed[1]}.`;

  const actionItems = followUps.map((text) => ({
    text,
    status: "open" as const
  }));

  return {
    overview,
    keyPoints,
    followUps,
    actionItems
  };
}

async function callLlmJson<T>(
  config: WorkerConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<T | null> {
  if (!config.llmServerUrl) {
    return null;
  }

  const normalizedBaseUrl = config.llmServerUrl.replace(/\/$/, "");
  const endpoint = normalizedBaseUrl.endsWith("/v1")
    ? `${normalizedBaseUrl}/chat/completions`
    : `${normalizedBaseUrl}/v1/chat/completions`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: config.modelId,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: userPrompt
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`LLM request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
      };
    }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    return null;
  }

  return extractJsonObject<T>(content);
}

async function generateFinalSummary(
  config: WorkerConfig,
  session: HostedSessionRecord,
  segments: readonly TranscriptRow[]
): Promise<SummaryPayload> {
  const excerpt = buildTranscriptExcerpt(segments, config.maxTranscriptChars);

  try {
    const response = await callLlmJson<{
      overview?: string;
      keyPoints?: string[];
      followUps?: string[];
      actionItems?: Array<{ text?: string; status?: string }>;
    }>(
      config,
      [
        "You summarize completed conversation transcripts.",
        "Return strict JSON with keys: overview, keyPoints, followUps, actionItems.",
        "keyPoints and followUps must be arrays of concise strings.",
        "actionItems must be an array of objects with text and status.",
        "Keep status to open, done, or blocked."
      ].join(" "),
      [
        `Session ID: ${session.id}`,
        `Source: ${session.sourceType}`,
        "Summarize the conversation into an overview, key points, follow-ups, and concrete action items.",
        excerpt
      ].join("\n\n")
    );

    const overview = normalizeText(response?.overview ?? "");
    const keyPoints = uniqueStrings(asStringArray(response?.keyPoints)).slice(0, 6);
    const followUps = uniqueStrings(asStringArray(response?.followUps)).slice(0, 6);
    const actionItems = Array.isArray(response?.actionItems)
      ? response!.actionItems
          .map((item) => ({
            text: normalizeText(typeof item?.text === "string" ? item.text : ""),
            status: normalizeActionItemStatus(item?.status)
          }))
          .filter((item) => item.text.length > 0)
          .slice(0, 8)
      : [];

    if (overview && keyPoints.length > 0) {
      return {
        overview,
        keyPoints,
        followUps,
        actionItems
      };
    }
  } catch (error) {
    console.warn(`[summary-worker] LLM final-summary generation failed for ${session.id}:`, error);
  }

  return buildFallbackSummary(segments);
}

class SummaryWorker {
  private readonly pool: Pool;

  constructor(private readonly config: WorkerConfig) {
    this.pool = new Pool({
      connectionString: config.postgresUrl
    });
  }

  async close() {
    await this.pool.end();
  }

  private async requeueStaleJobs() {
    const client = await this.pool.connect();
    const failedAt = nowIso();

    try {
      await client.query("BEGIN");
      const staleJobs = await client.query<Record<string, unknown>>(
        `
          WITH stale_jobs AS (
            SELECT id, session_id
            FROM model_runs
            WHERE kind = 'summary'
              AND status = 'running'
              AND started_at <= NOW() - ($1 * INTERVAL '1 millisecond')
            FOR UPDATE SKIP LOCKED
          )
          UPDATE model_runs mr
          SET status = 'failed',
              completed_at = $2::timestamptz,
              error_message = 'Summary job lease expired and was released for retry.',
              metadata = COALESCE(mr.metadata, '{}'::jsonb)
                || jsonb_build_object(
                     'failedAt', $2::text,
                     'workerId', $3::text,
                     'requeueReason', 'claim-timeout'
                   )
          FROM stale_jobs sj
          WHERE mr.id = sj.id
          RETURNING sj.id AS model_run_id, sj.session_id
        `,
        [this.config.claimTimeoutMs, failedAt, this.config.workerId]
      );

      for (const row of staleJobs.rows) {
        await client.query(
          `
            INSERT INTO session_events (id, session_id, type, payload)
            VALUES ($1, $2, 'error', $3::jsonb)
          `,
          [
            createId("event"),
            String(row.session_id),
            JSON.stringify({
              modelRunId: String(row.model_run_id),
              message: "A stale summary job lease expired and was released for retry."
            })
          ]
        );
      }

      await client.query("COMMIT");
      return staleJobs.rowCount ?? 0;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async claimNextJob(): Promise<ClaimedSummaryJob | null> {
    const staleJobCount = await this.requeueStaleJobs();
    if (staleJobCount > 0) {
      console.warn(`[summary-worker] released ${staleJobCount} stale summary job(s) for retry`);
    }

    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const candidateSessions = await client.query<Record<string, unknown>>(
        `
          SELECT *
          FROM sessions
          WHERE status IN ('recording', 'processing', 'complete')
          ORDER BY
            CASE status
              WHEN 'complete' THEN 0
              WHEN 'processing' THEN 1
              ELSE 2
            END,
            updated_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 20
        `
      );

      for (const row of candidateSessions.rows) {
        const session = mapSession(row);
        const runningModelRun = await client.query(
          `
            SELECT id
            FROM model_runs
            WHERE session_id = $1
              AND kind = 'summary'
              AND status = 'running'
            LIMIT 1
          `,
          [session.id]
        );
        if ((runningModelRun.rowCount ?? 0) > 0) {
          continue;
        }

        const transcriptResult = await client.query<Record<string, unknown>>(
          `
            SELECT *
            FROM transcript_segments
            WHERE session_id = $1
            ORDER BY sequence_number ASC
          `,
          [session.id]
        );
        const transcriptSegments = transcriptResult.rows.map((candidate) => mapTranscript(candidate));
        if (transcriptSegments.length === 0) {
          continue;
        }

        const summaryResult = await client.query<Record<string, unknown>>(
          `
            SELECT
              ss.*,
              COALESCE(mr.metadata, '{}'::jsonb) AS model_run_metadata
            FROM session_summaries ss
            LEFT JOIN model_runs mr ON mr.id = ss.model_run_id
            WHERE ss.session_id = $1
            ORDER BY ss.created_at DESC
            LIMIT 1
          `,
          [session.id]
        );
        const latestSummary = summaryResult.rows[0] ? mapSummary(summaryResult.rows[0]) : null;
        const latestSummarySequence = determineLatestSummarySequence(latestSummary);
        const lastSequenceNumber = transcriptSegments.at(-1)?.sequenceNumber ?? -1;

        if (session.status !== "complete" || lastSequenceNumber <= latestSummarySequence) {
          continue;
        }

        const modelRunId = createId("model-run");
        const jobType: SummaryJobType = "final-summary";
        const inputSegments = transcriptSegments;
        const runStartedAt = nowIso();

        await client.query(
          `
            INSERT INTO model_runs (
              id, session_id, kind, model_id, runtime, status, input_ref, started_at, metadata
            )
            VALUES ($1, $2, 'summary', $3, 'summary-worker', 'running', $4, $5::timestamptz, $6::jsonb)
          `,
          [
            modelRunId,
            session.id,
            this.config.modelId,
            `${jobType}:${session.id}`,
            runStartedAt,
            JSON.stringify({
              jobType,
              workerId: this.config.workerId,
              segmentCount: inputSegments.length,
              lastSequenceNumber,
              sourceSegmentIds: inputSegments.map((segment) => segment.id)
            })
          ]
        );
        await client.query(
          `
            INSERT INTO session_events (id, session_id, type, payload)
            VALUES ($1, $2, 'model-run.created', $3::jsonb)
          `,
          [
            createId("event"),
            session.id,
            JSON.stringify({
              modelRunId,
              kind: "summary",
              modelId: this.config.modelId,
              runtime: "summary-worker",
              jobType
            })
          ]
        );
        await client.query("COMMIT");

        return {
          modelRunId,
          session,
          jobType,
          transcriptSegments,
          latestSummary,
          latestSummarySequence
        };
      }

      await client.query("COMMIT");
      return null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async persistFinalSummary(job: ClaimedSummaryJob, summary: SummaryPayload, latencyMs: number) {
    const client = await this.pool.connect();
    const completedAt = nowIso();

    try {
      await client.query("BEGIN");
      const summaryId = createId("summary");
      await client.query("DELETE FROM action_items WHERE session_id = $1", [job.session.id]);
      await client.query(
        `
          INSERT INTO session_summaries (
            id, session_id, model_run_id, overview, key_points, follow_ups
          )
          VALUES ($1, $2, $3, $4, $5::text[], $6::text[])
        `,
        [
          summaryId,
          job.session.id,
          job.modelRunId,
          summary.overview,
          summary.keyPoints,
          summary.followUps
        ]
      );

      for (const actionItem of summary.actionItems) {
        await client.query(
          `
            INSERT INTO action_items (
              id, session_id, source_summary_id, text, status
            )
            VALUES ($1, $2, $3, $4, $5)
          `,
          [createId("action"), job.session.id, summaryId, actionItem.text, actionItem.status]
        );
      }

      await client.query(
        `
          UPDATE model_runs
          SET status = 'complete',
              completed_at = $2::timestamptz,
              latency_ms = $3::int,
              metadata = COALESCE(metadata, '{}'::jsonb)
                || $4::jsonb
          WHERE id = $1
        `,
        [
          job.modelRunId,
          completedAt,
          latencyMs,
          JSON.stringify({
            summaryId,
            actionItemCount: summary.actionItems.length,
            overview: summary.overview
          })
        ]
      );
      await client.query(
        `
          INSERT INTO session_events (id, session_id, type, payload)
          VALUES ($1, $2, 'session.summary.created', $3::jsonb)
        `,
        [
          createId("event"),
          job.session.id,
          JSON.stringify({
            summaryId,
            modelRunId: job.modelRunId,
            actionItemCount: summary.actionItems.length
          })
        ]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async markJobFailed(job: ClaimedSummaryJob, error: unknown) {
    const client = await this.pool.connect();
    const message = error instanceof Error ? error.message : "Summary worker failed.";
    const failedAt = nowIso();

    try {
      await client.query("BEGIN");
      await client.query(
        `
          UPDATE model_runs
          SET status = 'failed',
              completed_at = $2::timestamptz,
              error_message = $3,
              metadata = COALESCE(metadata, '{}'::jsonb)
                || $4::jsonb
          WHERE id = $1
        `,
        [
          job.modelRunId,
          failedAt,
          message,
          JSON.stringify({
            failedAt,
            workerId: this.config.workerId
          })
        ]
      );
      await client.query(
        `
          INSERT INTO session_events (id, session_id, type, payload)
          VALUES ($1, $2, 'error', $3::jsonb)
        `,
        [
          createId("event"),
          job.session.id,
          JSON.stringify({
            modelRunId: job.modelRunId,
            message
          })
        ]
      );
      await client.query("COMMIT");
    } catch (persistError) {
      await client.query("ROLLBACK");
      console.error("[summary-worker] failed to persist job failure", persistError);
    } finally {
      client.release();
    }
  }

  private async processJob(job: ClaimedSummaryJob) {
    const startedAt = Date.now();

    try {
      const summary = await generateFinalSummary(this.config, job.session, job.transcriptSegments);
      await this.persistFinalSummary(job, summary, Date.now() - startedAt);
      console.log(
        `[summary-worker] stored final summary for ${job.session.id} with ${summary.actionItems.length} action item(s)`
      );
    } catch (error) {
      await this.markJobFailed(job, error);
      throw error;
    }
  }

  async tick() {
    const job = await this.claimNextJob();
    if (!job) {
      return false;
    }

    await this.processJob(job);
    return true;
  }
}

async function main() {
  const config = buildWorkerConfig();
  const worker = new SummaryWorker(config);

  console.log(`[summary-worker] ready for summary generation on ${config.workerId}`);
  console.log(`[summary-worker] model=${config.modelId} llm=${config.llmServerUrl ?? "fallback-only"}`);

  const shutdown = async (signal: string) => {
    if (stopRequested.value) {
      return;
    }

    stopRequested.value = true;
    console.log(`[summary-worker] shutting down from ${signal}`);
    await worker.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  while (!stopRequested.value) {
    try {
      const didWork = await worker.tick();
      if (!didWork) {
        await sleep(config.pollIntervalMs);
      }
    } catch (error) {
      console.error("[summary-worker] tick failed", error);
      await sleep(config.pollIntervalMs);
    }
  }
}

void main().catch((error) => {
  console.error("[summary-worker] fatal startup failure", error);
  process.exit(1);
});
