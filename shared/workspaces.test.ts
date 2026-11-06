import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DSH_MODE_OPTIONS,
  WORKSPACE_ACCESS_OPTIONS,
  defaultWorkspace,
  estimateTokens,
  normalizeLocalState,
} from "./workspaces";

test("workspace normalization creates a default workspace and migrates legacy modes", () => {
  const state = normalizeLocalState({
    settings: { theme: "light", model: "", mode: "问答" as any },
  });
  assert.equal(state.workspaces.length, 1);
  assert.equal(state.workspaces[0].id, defaultWorkspace().id);
  assert.equal(state.activeWorkspaceId, state.workspaces[0].id);
  assert.equal(state.settings.mode, "standard");
});

test("workspace normalization keeps named workspaces and falls back from unknown active ids", () => {
  const state = normalizeLocalState({
    workspaces: [
      {
        id: "safe",
        name: "safeChat",
        description: "safe files",
        folder: "C:/safe",
        access: "view",
      },
    ],
    activeWorkspaceId: "missing",
  });
  assert.equal(state.activeWorkspaceId, "safe");
  assert.equal(state.workspaces[0].access, "view");
  assert.equal(state.workspaces[0].folder, "C:/safe");
});

test("legacy default project keeps its folder and access while custom names stay intact", () => {
  const old = {
    id: "default-workspace",
    name: "默认工作区",
    description: "",
    folder: "D:/team",
    access: "view" as const,
  };
  const state = normalizeLocalState({
    workspaces: [old],
    activeWorkspaceId: old.id,
  });
  assert.deepEqual(state.workspaces[0], old);
  assert.equal(
    normalizeLocalState({ workspaces: [{ ...old, name: "默认项目" }] })
      .workspaces[0].name,
    "默认工作区",
  );
  assert.equal(state.activeWorkspaceId, old.id);
  assert.equal(
    normalizeLocalState({ workspaces: [{ ...old, name: "我的研发项目" }] })
      .workspaces[0].name,
    "我的研发项目",
  );
});

test("legacy conversations go to the default workspace and named conversations retain their workspace", () => {
  const workspaces = [
    defaultWorkspace(),
    { ...defaultWorkspace(), id: "research", name: "研发" },
  ];
  const conversation = {
    id: "old",
    title: "历史记录",
    messages: [],
    createdAt: "2026-11-06",
  };
  const state = normalizeLocalState({
    workspaces,
    activeWorkspaceId: "research",
    conversations: [
      conversation,
      { ...conversation, id: "new", workspaceId: "research" },
    ],
  });
  assert.deepEqual(
    state.conversations.map((c) => c.workspaceId),
    ["default-workspace", "research"],
  );
});

test("mode and permission catalogs expose the four DSH modes and three access levels", () => {
  assert.deepEqual(
    DSH_MODE_OPTIONS.map((option) => option.value),
    ["standard", "ptc", "minimal", "creative"],
  );
  assert.deepEqual(
    WORKSPACE_ACCESS_OPTIONS.map((option) => option.value),
    ["view", "edit", "full"],
  );
});

test("token estimate is stable for empty and short text", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("1234"), 1);
  assert.equal(estimateTokens("12345"), 2);
});

test("installed skill preferences default to automatic and restore an explicit multi-selection per profile", () => {
  assert.equal(normalizeLocalState({}).settings.skillMode, "auto");
  const state = normalizeLocalState({
    settings: {
      theme: "light",
      model: "",
      mode: "standard",
      skillMode: "manual",
      skillIds: ["a", "b", "a", 42] as any,
    },
  });
  assert.equal(state.settings.skillMode, "manual");
  assert.deepEqual(state.settings.skillIds, ["a", "b"]);
  assert.deepEqual(normalizeLocalState({}).settings.skillIds, []);
});
