
-- Corridas del pipeline (scrape → generate → validate → load → build_views).
-- La tabla es también la cola: el worker toma la corrida con FOR UPDATE SKIP LOCKED.
CREATE TABLE "etl_runs" (
  "id"           UUID        NOT NULL DEFAULT gen_random_uuid(),
  "status"       TEXT        NOT NULL DEFAULT 'queued',
  "attempts"     INTEGER     NOT NULL DEFAULT 0,
  "max_attempts" INTEGER     NOT NULL DEFAULT 3,
  "run_after"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "locked_by"    TEXT,
  "locked_until" TIMESTAMPTZ(6),
  "error"        TEXT,
  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "started_at"   TIMESTAMPTZ(6),
  "finished_at"  TIMESTAMPTZ(6),
  CONSTRAINT "etl_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "etl_runs_status_check"
    CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed')),
  CONSTRAINT "etl_runs_attempts_check" CHECK ("attempts" >= 0 AND "max_attempts" >= 1)
);

-- Una sola corrida activa (en cola o corriendo) a la vez.
CREATE UNIQUE INDEX "etl_runs_single_active" ON "etl_runs" ((1))
  WHERE "status" IN ('queued', 'running');
CREATE INDEX "etl_runs_created_at_idx" ON "etl_runs" ("created_at");

CREATE TABLE "etl_run_steps" (
  "run_id"      UUID        NOT NULL,
  "step"        TEXT        NOT NULL,
  "position"    SMALLINT    NOT NULL,
  "status"      TEXT        NOT NULL DEFAULT 'pending',
  "attempts"    INTEGER     NOT NULL DEFAULT 0,
  "started_at"  TIMESTAMPTZ(6),
  "finished_at" TIMESTAMPTZ(6),
  "error"       TEXT,
  "output"      JSONB,
  CONSTRAINT "etl_run_steps_pkey" PRIMARY KEY ("run_id", "step"),
  CONSTRAINT "etl_run_steps_run_id_fkey" FOREIGN KEY ("run_id")
    REFERENCES "etl_runs" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "etl_run_steps_step_check"
    CHECK ("step" IN ('scrape', 'generate', 'validate', 'load', 'build_views')),
  CONSTRAINT "etl_run_steps_status_check"
    CHECK ("status" IN ('pending', 'running', 'succeeded', 'failed'))
);
CREATE UNIQUE INDEX "etl_run_steps_run_id_position_key" ON "etl_run_steps" ("run_id", "position");

-- Avisa al worker (LISTEN etl_runs) cuando hay una corrida en cola. Es solo una
-- señal para intentar tomar: el worker igual consulta cada POLL_SECONDS.
CREATE FUNCTION "etl_runs_notify"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('etl_runs', NEW."id"::text);
  RETURN NULL;
END
$$;

CREATE TRIGGER "etl_runs_notify"
  AFTER INSERT OR UPDATE OF "status", "run_after" ON "etl_runs"
  FOR EACH ROW WHEN (NEW."status" = 'queued')
  EXECUTE FUNCTION "etl_runs_notify"();
