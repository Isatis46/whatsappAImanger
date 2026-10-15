CREATE TABLE user_mfa (user_id uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE, ciphertext text NOT NULL, enabled boolean NOT NULL DEFAULT false, last_step bigint NOT NULL DEFAULT -1, recovery_hashes text[] NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE fact_messages ADD COLUMN projected_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX agent_runs_reporting ON agent_runs(account_id,started_at);
CREATE INDEX session_expiration ON sessions(expires_at);
