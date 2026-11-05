import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  scryptSync,
  scrypt,
  timingSafeEqual,
  createHash,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function passwordHashAsync(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (error, value) =>
      error ? reject(error) : resolve(`${salt}:${value.toString("hex")}`),
    );
  });
}
export function passwordMatches(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function createStore(file: string) {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS departments(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL COLLATE NOCASE, name TEXT NOT NULL, department_id TEXT NOT NULL REFERENCES departments(id), role TEXT NOT NULL, password_hash TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, must_change INTEGER NOT NULL DEFAULT 1, auth_version INTEGER NOT NULL DEFAULT 1, distributed INTEGER NOT NULL DEFAULT 0, initial_expires_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), auth_version INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS skills(id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, version TEXT NOT NULL, instructions TEXT NOT NULL, examples TEXT NOT NULL, test_summary TEXT NOT NULL, required_tools TEXT NOT NULL, author_id TEXT NOT NULL REFERENCES users(id), owner_department_id TEXT NOT NULL REFERENCES departments(id), audience TEXT NOT NULL, targets TEXT NOT NULL, status TEXT NOT NULL, review_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, previous_id TEXT REFERENCES skills(id));
    CREATE TABLE IF NOT EXISTS connections(id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL, model TEXT NOT NULL, kind TEXT NOT NULL, departments TEXT NOT NULL, secret TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT, action TEXT NOT NULL, resource_id TEXT NOT NULL, at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS managed_credentials(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, secret TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS account_batches(id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), configuration TEXT NOT NULL, user_ids TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS feedback(
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), user_name TEXT NOT NULL, username TEXT NOT NULL,
      department_name TEXT NOT NULL, conversation_id TEXT NOT NULL, message_id TEXT NOT NULL, model_name TEXT NOT NULL,
      rating TEXT NOT NULL CHECK(rating IN ('helpful','unhelpful','issue')), category TEXT NOT NULL, description TEXT NOT NULL,
      context_json TEXT, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','resolved','dismissed')),
      admin_note TEXT NOT NULL DEFAULT '', handled_by TEXT NOT NULL DEFAULT '', handled_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(user_id,conversation_id,message_id)
    );
    CREATE INDEX IF NOT EXISTS feedback_status_created ON feedback(status,created_at DESC);
    CREATE INDEX IF NOT EXISTS feedback_created ON feedback(created_at DESC);
  `);
  if (
    !(db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).some(
      (column) => column.name === "initial_expires_at",
    )
  )
    db.exec(
      "ALTER TABLE users ADD COLUMN initial_expires_at INTEGER NOT NULL DEFAULT 0",
    );
  // No automatic chat history storage; feedback contains only explicitly submitted excerpts.
  if (
    !(db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).some(
      (column) => column.name === "avatar",
    )
  )
    db.exec("ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT ''");
  if (
    !(db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).some(
      (column) => column.name === "account_note",
    )
  )
    db.exec(
      "ALTER TABLE users ADD COLUMN account_note TEXT NOT NULL DEFAULT ''",
    );
  if (
    !(db.prepare("PRAGMA table_info(skills)").all() as { name: string }[]).some(
      (column) => column.name === "import_source",
    )
  )
    db.exec("ALTER TABLE skills ADD COLUMN import_source TEXT");
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS skill_import_identity ON skills(owner_department_id,json_extract(import_source,'$.digest'),json_extract(import_source,'$.entry')) WHERE import_source IS NOT NULL",
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS model_services(id TEXT PRIMARY KEY,provider TEXT NOT NULL,name TEXT NOT NULL,base_url TEXT NOT NULL,departments TEXT NOT NULL,secret TEXT NOT NULL)",
  );
  if (
    !(
      db.prepare("PRAGMA table_info(connections)").all() as { name: string }[]
    ).some((c) => c.name === "service_id")
  )
    db.exec(
      "ALTER TABLE connections ADD COLUMN service_id TEXT REFERENCES model_services(id)",
    );
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS connection_service_model ON connections(service_id,model,kind) WHERE service_id IS NOT NULL",
  );
  const keyFile =
    file === ":memory:" ? undefined : join(dirname(file), "secrets.key");
  const key =
    keyFile && existsSync(keyFile) ? readFileSync(keyFile) : randomBytes(32);
  if (keyFile && !existsSync(keyFile))
    writeFileSync(keyFile, key, { mode: 0o600 });
  return {
    db,
    encrypt(value: string) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const data = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
      ]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
    },
    decrypt(value: string) {
      const bytes = Buffer.from(value, "base64");
      const cipher = createDecipheriv(
        "aes-256-gcm",
        key,
        bytes.subarray(0, 12),
      );
      cipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([
        cipher.update(bytes.subarray(28)),
        cipher.final(),
      ]).toString("utf8");
    },
    audit(actor: string | null, action: string, resource: string) {
      db.prepare(
        "INSERT INTO audit(actor_id,action,resource_id,at) VALUES(?,?,?,?)",
      ).run(actor, action, resource, new Date().toISOString());
    },
    close() {
      db.close();
    },
  };
}
export type Store = ReturnType<typeof createStore>;
