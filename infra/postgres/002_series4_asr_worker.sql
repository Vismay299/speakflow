CREATE INDEX IF NOT EXISTS audio_chunks_status_created_at_idx
  ON audio_chunks (status, created_at);

CREATE INDEX IF NOT EXISTS audio_chunks_session_status_chunk_idx
  ON audio_chunks (session_id, status, chunk_index);

CREATE INDEX IF NOT EXISTS audio_chunks_processing_started_at_idx
  ON audio_chunks (((metadata->>'processingStartedAt')::timestamptz))
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS model_runs_session_kind_created_at_idx
  ON model_runs (session_id, kind, created_at DESC);

CREATE INDEX IF NOT EXISTS transcript_segments_session_chunk_idx
  ON transcript_segments (session_id, audio_chunk_id, sequence_number);

CREATE INDEX IF NOT EXISTS sessions_status_ended_at_idx
  ON sessions (status, ended_at, created_at);

CREATE INDEX IF NOT EXISTS sessions_final_asr_started_at_idx
  ON sessions (((metadata->>'finalAsrStartedAt')::timestamptz))
  WHERE status = 'complete';
