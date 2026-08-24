-- 0042: Widen render_jobs.seed to bigint to allow full 32-bit seeds safely.
alter table if exists render_jobs
  alter column seed type bigint;
