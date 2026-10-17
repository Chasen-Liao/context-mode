// Unit tests for src/core/hooks/throttle.ts (impl/09 §2, A20, A24; DECISIONS-r9 E5; impl/08 §6.1 step 8).
// shouldHint(db, sessionId, onceKey, everyN?): boolean. Marker lives in meta under
// "hint:" + sessionId + ":" + onceKey. Keyed by session id only: no ppid, no "latest session" guess.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb, closeDb, withWrite, metaGet } from "../../../src/core/store/db.ts";
import { MCP_HINT_EVERY } from "../../../src/core/contracts/constants.ts";
import { shouldHint } from "../../../src/core/hooks/throttle.ts";

function fakeProject(root, projectKey) {
  return {
    projectKey,
    projectDir: join(root, "projects", projectKey),
    dbPath: join(root, "projects", projectKey, "context.db"),
    worktree: root,
    containmentRoot: root,
    agent: "claude-code",
    source: "env:CLAUDE_PROJECT_DIR",
  };
}

async function withDb(fn) {
  const root = mkdtempSync(join(tmpdir(), "cm-throttle-"));
  const db = await openDb(fakeProject(root, "a".repeat(16)));
  try {
    await fn(db, root);
  } finally {
    closeDb(db);
    rmSync(root, { recursive: true, force: true });
  }
}

test("once key: fires on the first call only, then never again in the same session", async () => {
  await withDb(async (db) => {
    assert.equal(shouldHint(db, "s1", "grep:s1"), true);
    assert.equal(shouldHint(db, "s1", "grep:s1"), false);
    assert.equal(shouldHint(db, "s1", "grep:s1"), false);
    assert.equal(metaGet(db, "hint:s1:grep:s1"), "1");
  });
});

test("GP3/hint-once-per-session (throttle slice): same session id, 3 Reads -> one hint, no tmp dirs made", async () => {
  await withDb(async (db, root) => {
    const fired = [1, 2, 3].map(() => shouldHint(db, "sess-read", "read:sess-read"));
    assert.deepEqual(fired, [true, false, false]);
    // The marker is a meta row, not a file or dir: the project dir holds only the DB files.
    assert.deepEqual(
      readdirSync(join(root, "projects", "a".repeat(16))).filter((f) => !f.startsWith("context.db")),
      [],
    );
  });
});

test("different session ids get their own marker", async () => {
  await withDb(async (db) => {
    assert.equal(shouldHint(db, "s1", "bash"), true);
    assert.equal(shouldHint(db, "s2", "bash"), true);
    assert.equal(shouldHint(db, "s1", "bash"), false);
    assert.equal(shouldHint(db, "s2", "bash"), false);
  });
});

test("different once keys in one session are independent", async () => {
  await withDb(async (db) => {
    assert.equal(shouldHint(db, "s1", "read:s1"), true);
    assert.equal(shouldHint(db, "s1", "grep:s1"), true);
    assert.equal(shouldHint(db, "s1", "read:s1"), false);
  });
});

test("E5: same session id from two processes (two ppids) shares one marker -> one hint", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-throttle-"));
  const project = fakeProject(root, "b".repeat(16));
  const a = await openDb(project);
  const b = await openDb(project);
  try {
    assert.equal(shouldHint(a, "shared", "bash"), true);
    assert.equal(shouldHint(b, "shared", "bash"), false);
  } finally {
    closeDb(a);
    closeDb(b);
    rmSync(root, { recursive: true, force: true });
  }
});

test("E5: empty session id -> zero hints and no marker written", async () => {
  await withDb(async (db) => {
    assert.equal(shouldHint(db, "", "bash"), false);
    assert.equal(shouldHint(db, "", "bash"), false);
    assert.equal(shouldHint(db, "", "mcp", 3), false);
    const n = db.raw.prepare("SELECT COUNT(*) AS n FROM meta").get().n;
    assert.equal(n, 0);
  });
});

test("everyN: fires on calls 1, 1+N, 1+2N (N=3)", async () => {
  await withDb(async (db) => {
    const fired = [];
    for (let i = 1; i <= 8; i++) fired.push(shouldHint(db, "s1", "mcp:s1", 3));
    assert.deepEqual(fired, [true, false, false, true, false, false, true, false]);
    assert.equal(metaGet(db, "hint:s1:mcp:s1"), "8");
  });
});

test("everyN = MCP_HINT_EVERY: fires on the 1st and (1+MCP_HINT_EVERY)th call", async () => {
  await withDb(async (db) => {
    const fired = [];
    for (let i = 1; i <= MCP_HINT_EVERY + 1; i++) fired.push(shouldHint(db, "s1", "mcp:s1", MCP_HINT_EVERY));
    assert.equal(fired[0], true);
    assert.equal(fired.slice(1, MCP_HINT_EVERY).every((f) => f === false), true);
    assert.equal(fired[MCP_HINT_EVERY], true);
  });
});

test("everyN = 1 fires on every call", async () => {
  await withDb(async (db) => {
    assert.deepEqual([1, 2, 3].map(() => shouldHint(db, "s1", "mcp", 1)), [true, true, true]);
  });
});

test("joins the caller's open write transaction (§2.2 step 4): rollback undoes the marker", async () => {
  await withDb(async (db) => {
    assert.throws(() =>
      withWrite(db, (h) => {
        assert.equal(shouldHint(h, "s1", "bash"), true);
        throw new Error("crash after decide");
      }),
    );
    assert.equal(metaGet(db, "hint:s1:bash"), null);
    // After the rollback the hint is still owed exactly once.
    assert.equal(shouldHint(db, "s1", "bash"), true);
    assert.equal(shouldHint(db, "s1", "bash"), false);
  });
});

test("inside a caller transaction the marker commits with the journal row", async () => {
  await withDb(async (db) => {
    withWrite(db, (h) => {
      h.raw.prepare(
        "INSERT INTO events(session_id, worktree, agent, kind, tool, key, path, ok, exit_code, bytes, body, turn," +
          " sandbox_bytes, returned_bytes, created_at, accessed_at) VALUES ('s1','/w','claude-code','cmd','Bash',NULL,NULL,1,0,1,'x',0,0,0,0,0)",
      ).run();
      assert.equal(shouldHint(h, "s1", "bash"), true);
    });
    assert.equal(metaGet(db, "hint:s1:bash"), "1");
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM events").get().n, 1);
  });
});
