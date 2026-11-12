-- 赛博过家家 shared board: anonymous users, their unboxed goods, posts (reviews, questions, answers), likes and reports.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  nick TEXT NOT NULL,
  color TEXT NOT NULL,
  ip_hash TEXT,
  created_at INTEGER NOT NULL,
  banned INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS users_ip ON users (ip_hash, created_at);

CREATE TABLE IF NOT EXISTS orders (
  uid INTEGER NOT NULL,
  pid TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (uid, pid)
);

-- kind: r review, q question, a answer. parent (answers only): s:<pid>:<i> for a sample question, q:<id> for a user question.
-- hidden: 0 shown, 1 hidden by reports, 2 removed by the admin.
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  pid TEXT NOT NULL,
  parent TEXT,
  uid INTEGER NOT NULL,
  stars INTEGER,
  ci INTEGER,
  text TEXT NOT NULL,
  ip_hash TEXT,
  created_at INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  reports INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS posts_pid ON posts (pid, created_at);
CREATE INDEX IF NOT EXISTS posts_uid ON posts (uid, created_at);
CREATE INDEX IF NOT EXISTS posts_ip ON posts (ip_hash, created_at);

-- target: s:<pid>:<i> for a sample review, r:<id> for a user review.
CREATE TABLE IF NOT EXISTS likes (
  target TEXT NOT NULL,
  uid INTEGER NOT NULL,
  pid TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (target, uid)
);
CREATE INDEX IF NOT EXISTS likes_pid ON likes (pid);
CREATE INDEX IF NOT EXISTS likes_uid ON likes (uid, created_at);

CREATE TABLE IF NOT EXISTS reports (
  post_id INTEGER NOT NULL,
  uid INTEGER NOT NULL,
  ip_hash TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, uid)
);
CREATE INDEX IF NOT EXISTS reports_uid ON reports (uid, created_at);
