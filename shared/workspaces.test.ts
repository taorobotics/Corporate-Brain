import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DSH_MODE_OPTIONS,
  WORKSPACE_ACCESS_OPTIONS,
  defaultWorkspace,
  estimateTokens,
  normalizeLocalState,
  addLocalProject,
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
  assert.deepEqual(state.workspaces[0], { ...old, name: "默认项目" });
  assert.equal(
    normalizeLocalState({ workspaces: [{ ...old, name: "默认项目" }] })
      .workspaces[0].name,
    "默认项目",
  );
  assert.equal(state.activeWorkspaceId, old.id);
  assert.equal(
    normalizeLocalState({ workspaces: [{ ...old, name: "我的研发项目" }] })
      .workspaces[0].name,
    "我的研发项目",
  );
});

test("creating a project in a reused folder preserves the original project, histories and permissions", () => {
  const original = {
    id: "first",
    name: "campaign",
    description: "Existing project",
    folder: "D:/campaign",
    access: "view" as const,
  };
  const conversation = {
    id: "history",
    workspaceId: original.id,
    title: "Original conversation",
    createdAt: "2026-11-09",
    messages: [],
  };
  const state = normalizeLocalState({
    workspaces: [original],
    activeWorkspaceId: original.id,
    conversations: [conversation],
  });
  const next = addLocalProject(state, original.folder, "second");
  assert.equal(state.workspaces.length, 1);
  assert.equal(next.workspaces.length, 2);
  assert.deepEqual(next.workspaces[0], original);
  assert.equal(next.activeWorkspaceId, "second");
  assert.equal(next.workspaces[1].name, "campaign (2)");
  assert.equal(next.workspaces[1].access, "edit");
  assert.deepEqual(next.conversations, state.conversations);
  const third = addLocalProject(next, original.folder, "third");
  assert.equal(third.workspaces[2].name, "campaign (3)");
  assert.equal(third.conversations[0].workspaceId, original.id);
  assert.throws(
    () => addLocalProject(third, original.folder, "first"),
    /已存在/,
  );
});

test("legacy project cards migrate once and existing workspace identities remain authoritative", () => {
  const state = normalizeLocalState({
    projects: [
      { id: "legacy-a", name: "旧项目", description: "A" },
      { id: "legacy-b", name: "旧项目", description: "B" },
    ],
  });
  assert.deepEqual(
    state.workspaces.map((w) => w.id),
    ["default-workspace", "legacy-a", "legacy-b"],
  );
  assert.equal(state.workspaces[1].folder, null);
  const edited = {
    ...state,
    workspaces: state.workspaces.map((w) =>
      w.id === "legacy-a"
        ? {
            ...w,
            name: "修改后的名称",
            folder: "/local/project",
            access: "view" as const,
          }
        : w,
    ),
  };
  const restored = normalizeLocalState(edited);
  assert.equal(restored.workspaces.length, 3);
  assert.deepEqual(restored.workspaces[1], edited.workspaces[1]);
  assert.deepEqual(normalizeLocalState(restored), restored);
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

test("sidebar widths survive profile restore while invalid imported widths use safe defaults", () => {
  const settings = {
    model: "existing-model",
    theme: "dark",
    mode: "standard" as const,
  };
  const state = normalizeLocalState({
    settings: { ...settings, sidebarWidth: 320 },
  });
  assert.equal(normalizeLocalState(state).settings.sidebarWidth, 320);
  assert.equal(state.settings.model, "existing-model");
  assert.equal(state.settings.theme, "dark");
  for (const value of [undefined, null, "320", NaN, Infinity])
    assert.equal(
      normalizeLocalState({ settings: { sidebarWidth: value } } as any).settings
        .sidebarWidth,
      undefined,
    );
  assert.equal(
    normalizeLocalState({ settings: { ...settings, sidebarWidth: -100 } })
      .settings.sidebarWidth,
    170,
  );
  assert.equal(
    normalizeLocalState({ settings: { ...settings, sidebarWidth: 9999 } })
      .settings.sidebarWidth,
    420,
  );
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
