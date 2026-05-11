// Shared JobRunner abstraction — Inngest-ready interface.
// Today: backed by Postgres claim_next_jobs + edge function dispatch.
// Tomorrow: swap `claim` + `complete` to call Inngest steps without touching handlers.

export type JobType =
  | "generate_content"
  | "generate_voice"
  | "render_video"
  | "publish_post";

export type JobStatus =
  | "pending"
  | "processing"
  | "retrying"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface JobRow {
  id: string;
  user_id: string;
  type: JobType;
  status: JobStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  attempts: number;
  max_attempts: number;
  scheduled_for: string;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  parent_job_id: string | null;
  root_job_id: string | null;
  scheduled_post_id: string | null;
  city: string | null;
  platform: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobContext {
  job: JobRow;
  supabase: any;
  log: (message: string, ctx?: Record<string, unknown>) => Promise<void>;
}

export interface JobStepResult {
  // Optional payload to merge into the next chained job
  output?: Record<string, unknown>;
  // If set, automatically enqueue this next step
  next?: {
    type: JobType;
    payload?: Record<string, unknown>;
    delaySeconds?: number;
  };
  // If true, the chain is complete (e.g. publish_post finished)
  done?: boolean;
}

export type JobHandler = (ctx: JobContext) => Promise<JobStepResult>;

// Smart Retry backoff per spec:
//   1st retry (after attempt 1 failed) -> 2 minutes
//   2nd retry (after attempt 2 failed) -> 5 minutes
// Anything beyond is capped at 5 minutes.
export function computeBackoffSeconds(attempts: number): number {
  if (attempts <= 1) return 120;
  return 300;
}

export interface RunnerOptions {
  workerId: string;
  batchSize?: number;
  handlers: Record<JobType, JobHandler>;
}

export async function runOnce(supabase: any, opts: RunnerOptions) {
  const startedAt = Date.now();
  const summary = { claimed: 0, succeeded: 0, failed: 0, retried: 0, recovered: 0 };

  // 1. Recover stuck jobs (atomic in DB)
  const { data: recovered } = await supabase.rpc("recover_stuck_jobs");
  summary.recovered = typeof recovered === "number" ? recovered : 0;

  // 2. Claim a batch
  const { data: claimed, error: claimErr } = await supabase.rpc("claim_next_jobs", {
    p_worker_id: opts.workerId,
    p_limit: opts.batchSize ?? 5,
  });
  if (claimErr) {
    console.error("[run-jobs] claim error", claimErr);
    return { ok: false, error: claimErr.message, summary };
  }

  const jobs: JobRow[] = claimed ?? [];
  summary.claimed = jobs.length;

  // 3. Dispatch sequentially (keep edge function cold-start surface small)
  for (const job of jobs) {
    const handler = opts.handlers[job.type];
    const log = async (message: string, ctx: Record<string, unknown> = {}) => {
      await supabase.from("system_logs").insert({
        user_id: job.user_id,
        type: `job_${job.type}`,
        message,
        platform: job.platform,
        context: { job_id: job.id, root_job_id: job.root_job_id, ...ctx },
      });
    };

    if (!handler) {
      await failJob(supabase, job, `No handler registered for type ${job.type}`);
      summary.failed += 1;
      continue;
    }

    try {
      const result = await handler({ job, supabase, log });
      await succeedJob(supabase, job, result);
      summary.succeeded += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[run-jobs] job ${job.id} (${job.type}) failed:`, msg);
      const willRetry = job.attempts < job.max_attempts;
      if (willRetry) {
        const delay = computeBackoffSeconds(job.attempts);
        await supabase
          .from("jobs")
          .update({
            status: "retrying",
            locked_at: null,
            locked_by: null,
            scheduled_for: new Date(Date.now() + delay * 1000).toISOString(),
            last_error: msg.slice(0, 2000),
          })
          .eq("id", job.id);
        summary.retried += 1;
        await log(`Job will retry in ${delay}s`, { error: msg, attempt: job.attempts });
      } else {
        await failJob(supabase, job, msg);
        summary.failed += 1;
        // Surface to user
        await supabase.from("notifications").insert({
          user_id: job.user_id,
          title: `❌ Pipeline step failed: ${job.type}`,
          message: msg.slice(0, 500),
          type: "error",
        });
      }
    }
  }

  return { ok: true, summary, durationMs: Date.now() - startedAt };
}

async function succeedJob(supabase: any, job: JobRow, result: JobStepResult) {
  const completedAt = new Date().toISOString();
  await supabase
    .from("jobs")
    .update({
      status: "succeeded",
      result: result.output ?? {},
      locked_at: null,
      locked_by: null,
      completed_at: completedAt,
      last_error: null,
    })
    .eq("id", job.id);

  if (result.next && !result.done) {
    const nextPayload = {
      ...job.payload,
      ...(result.output ?? {}),
      ...(result.next.payload ?? {}),
    };
    const scheduledFor = new Date(
      Date.now() + (result.next.delaySeconds ?? 0) * 1000,
    ).toISOString();
    await supabase.rpc("enqueue_job", {
      p_user_id: job.user_id,
      p_type: result.next.type,
      p_payload: nextPayload,
      p_parent_job_id: job.id,
      p_root_job_id: job.root_job_id ?? job.id,
      p_scheduled_post_id: job.scheduled_post_id,
      p_city: job.city,
      p_platform: job.platform,
      p_scheduled_for: scheduledFor,
    });
  }
}

async function failJob(supabase: any, job: JobRow, message: string) {
  await supabase
    .from("jobs")
    .update({
      status: "failed",
      locked_at: null,
      locked_by: null,
      completed_at: new Date().toISOString(),
      last_error: message.slice(0, 2000),
    })
    .eq("id", job.id);
  await supabase.from("system_logs").insert({
    user_id: job.user_id,
    type: `job_${job.type}_failed`,
    message: `Job failed permanently: ${message.slice(0, 500)}`,
    platform: job.platform,
    context: { job_id: job.id, root_job_id: job.root_job_id, attempts: job.attempts },
  });
}
