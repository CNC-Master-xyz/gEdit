// The Monaco proof of Phase 4 plan §6.9 rule 6: on Monaco 0.55.1 a gEdit action added with
// `addAction` and a user key wins over a built-in rule on the same key, so the bridge needs no
// removal rule for it.
//
// This runs Monaco's own `KeybindingResolver` (the class `StandaloneKeybindingService` builds from
// `[defaults, dynamic keybindings]`, where `addAction` puts the action's keys among the dynamic
// ones) over a built-in rule and over the keybinding the real bridge hands `addAction` for the
// command the registry reports with the user's key. It needs no DOM. If a Monaco upgrade changes
// the order of the two lists, this test fails and the bridge has to add `-<command>` rules.

import { describe, expect, it } from 'vitest';
import { commands, resetCommandsForTest } from '$lib/app/registry/commands';
import { createBridge, type ActionDescriptor, type ActionTarget, type MonacoBridgeApi } from './monacoBridge';

const root = 'monaco-editor/esm/vs';
/* The deep modules ship without types; they are loaded by a computed path on purpose. */
const load = (path: string): Promise<any> => import(/* @vite-ignore */ `${root}/${path}`); // eslint-disable-line @typescript-eslint/no-explicit-any

const { KeyMod } = await load('editor/common/services/editorBaseApi.js');
const { KeyCode } = await load('editor/common/standalone/standaloneEnums.js');
const keybindings = await load('base/common/keybindings.js');
const platform = await load('base/common/platform.js');
const { KeybindingResolver } = await load('platform/keybinding/common/keybindingResolver.js');
const { ResolvedKeybindingItem } = await load('platform/keybinding/common/resolvedKeybindingItem.js');
const { USLayoutResolvedKeybinding } = await load('platform/keybinding/common/usLayoutResolvedKeybinding.js');
const { ContextKeyExpr } = await load('platform/contextkey/common/contextkey.js');

const OS = platform.OS as number;
const isMac = OS === 2;

/** What `StandaloneKeybindingService._toNormalizedKeybindingItems` makes of one rule. */
function item(keybinding: number, command: string, isDefault: boolean, when?: string) {
  const resolved = USLayoutResolvedKeybinding.resolveKeybinding(keybindings.decodeKeybinding(keybinding, OS), OS);
  return new ResolvedKeybindingItem(resolved[0], command, undefined, when ? ContextKeyExpr.deserialize(when) : undefined, isDefault, null, false);
}

function pressed(keybinding: number): string {
  const resolved = USLayoutResolvedKeybinding.resolveKeybinding(keybindings.decodeKeybinding(keybinding, OS), OS);
  return resolved[0].getDispatchChords()[0] as string;
}

const context = { getValue: (key: string) => (key === 'editorTextFocus' ? true : undefined) };

/** The command Monaco would run for `keybinding`, given its built-in rules and the dynamic ones. */
function resolve(defaults: unknown[], dynamic: unknown[], keybinding: number): string | null {
  const resolver = new KeybindingResolver(defaults, dynamic, () => {});
  const result = resolver.resolve(context, [], pressed(keybinding));
  return result.kind === 2 /* ResultKind.KbFound */ ? (result.commandId as string) : null;
}

/** An editor that keeps the dynamic keybindings its actions add, the way Monaco's standalone editor does. */
function recordingApi(dynamic: unknown[]): MonacoBridgeApi {
  const target: ActionTarget = {
    addAction(d: ActionDescriptor) {
      for (const kb of d.keybindings ?? []) dynamic.push(item(kb, d.id, false));
      return { dispose() {} };
    },
  };
  return {
    editors: () => [target],
    onDidCreateEditor: () => ({ dispose() {} }),
    addKeybindingRules: () => ({ dispose() {} }),
    KeyMod,
    KeyCode,
  };
}

describe('a user key against a built-in Monaco rule (Monaco 0.55.1)', () => {
  const ctrlCmdK = KeyMod.CtrlCmd | KeyCode.KeyK;

  it('Monaco runs the built-in rule when no user key is set (the setup is real)', () => {
    const defaults = [item(ctrlCmdK, 'editor.action.builtIn', true, 'editorTextFocus')];
    expect(resolve(defaults, [], ctrlCmdK)).toBe('editor.action.builtIn');
  });

  it('the action the bridge adds for the user’s key wins over the built-in rule, with and without a when clause', () => {
    resetCommandsForTest();
    commands.register({ id: 'misc.mine', title: 'Mine', run: () => {} });
    commands.setKeyOverrides({ 'misc.mine': 'Mod+K' });
    const dynamic: unknown[] = [];
    const off = createBridge({
      api: recordingApi(dynamic),
      list: () => commands.list(),
      removals: () => [],
      run: () => {},
      label: (def) => def.title,
      onChanged: () => () => {},
      isMac,
    });
    expect(dynamic).toHaveLength(1);
    for (const when of [undefined, 'editorTextFocus', 'editorTextFocus && !editorReadonly']) {
      const defaults = [item(ctrlCmdK, 'editor.action.builtIn', true, when)];
      expect(resolve(defaults, dynamic, ctrlCmdK), String(when)).toBe('gedit.misc.mine');
    }
    off();
    resetCommandsForTest();
  });

  it('a built-in rule on another key is untouched', () => {
    const other = KeyMod.CtrlCmd | KeyCode.KeyJ;
    const defaults = [item(other, 'editor.action.other', true)];
    const dynamic = [item(ctrlCmdK, 'gedit.misc.mine', false)];
    expect(resolve(defaults, dynamic, other)).toBe('editor.action.other');
  });
});
