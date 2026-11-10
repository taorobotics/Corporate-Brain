import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { SKINS, getSkin, contrast, skinTokens } from "./skins";
import { normalizeLocalState } from "./workspaces";

test("legacy, missing and invalid skin preferences migrate to Cloud without losing records or dark mode", () => {
  for (const skin of [
    undefined,
    "unknown",
    "__proto__",
    "url(https://untrusted.invalid)",
  ]) {
    const state = normalizeLocalState({
      settings: {
        skin,
        theme: "dark",
        model: "employee-model",
        mode: "creative",
      },
    });
    assert.equal(state.settings.skin, "cloud");
    assert.equal(state.settings.theme, "dark");
    assert.equal(state.settings.model, "employee-model");
    assert.equal(state.settings.mode, "creative");
  }
  assert.equal(normalizeLocalState(undefined).settings.skin, "cloud");
  assert.equal(normalizeLocalState(undefined).settings.theme, "default");
  assert.equal(
    normalizeLocalState({
      settings: { skin: "mint", theme: "light", model: "", mode: "standard" },
    }).settings.skin,
    "mint",
  );
});

test("all 63 catalog choices have readable palettes, local assets and unique safe ids", () => {
  assert.equal(SKINS.length, 63);
  assert.equal(new Set(SKINS.map((s) => s.id)).size, SKINS.length);
  for (const skin of SKINS) {
    assert.match(skin.id, /^[a-z0-9-]+$/);
    for (const mode of ["light", "dark"] as const) {
      const t = skinTokens(skin, mode);
      for (const foreground of ["--ink", "--muted"])
        for (const background of ["--bg", "--panel", "--side"]) {
          assert.ok(
            contrast(t[foreground], t[background]) >= 4.5,
            `${skin.id}/${mode}: ${foreground} on ${background}`,
          );
        }
      assert.ok(
        contrast(t["--accent-ink"], t["--accent"]) >= 4.5,
        `${skin.id}/${mode}: primary button`,
      );
      if (skin.background) {
        assert.match(
          skin.background[mode],
          /^\/skins\/[a-z0-9-]+\/assets\/[a-z0-9.-]+$/,
        );
        assert.ok(existsSync(`public${skin.background[mode]}`));
      }
    }
  }
  assert.equal(skinTokens(getSkin("claude"), "light")["--bg"], "#faf9f5");
  assert.equal(skinTokens(getSkin("claude"), "dark")["--bg"], "#181715");
});

test("the default UI migration preserves histories, other skins and later manual Claude choices", () => {
  const old = {
    conversations: [
      {
        id: "conversation",
        title: "Preserved",
        createdAt: "2026-11-10T00:00:00Z",
        workspaceId: "default-workspace",
        messages: [],
      },
    ],
    settings: {
      skin: "claude",
      theme: "dark",
      model: "private-model",
      mode: "standard" as const,
    },
  };
  const upgraded = normalizeLocalState(old);
  assert.equal(upgraded.settings.skin, "cloud");
  assert.equal(upgraded.settings.appearanceVersion, 1);
  assert.equal(upgraded.settings.model, old.settings.model);
  assert.equal(upgraded.settings.theme, old.settings.theme);
  assert.equal(upgraded.conversations[0].id, old.conversations[0].id);
  const chosenClaude = normalizeLocalState({
    ...upgraded,
    settings: { ...upgraded.settings, skin: "claude" },
  });
  assert.equal(chosenClaude.settings.skin, "claude");
  assert.deepEqual(normalizeLocalState(chosenClaude), chosenClaude);
  assert.equal(
    normalizeLocalState({ ...old, settings: { ...old.settings, skin: "mint" } })
      .settings.skin,
    "mint",
  );
});
