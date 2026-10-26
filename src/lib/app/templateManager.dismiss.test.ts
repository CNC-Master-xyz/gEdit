// v1.2.0 T153: a press outside the template manager (or Esc with the focus outside it) asks before
// unsaved changes go. The chain, end to end without a window: the manager is opened through the
// real `modals.open` with the options the Insert tab's command uses (`managerModalOptions`), the
// host's own dismissal is the real `dismissModal` (what `ModalHost` calls for a press outside the
// panel, pinned in `ModalHost.test.ts`), and the question is the real model's `leave`.

import { get } from 'svelte/store';
import { afterEach, describe, expect, it } from 'vitest';
import type { Component } from 'svelte';
import { closeModalForTest, currentModal, dismissModal, modals } from './modals';
import { createTemplateManager, managerModalOptions, type TemplateManager } from './templateManager';
import type { TemplateDef } from '$lib/core/templates';

const BASE: TemplateDef[] = [{ id: 'program-start', label: 'Program start', group: 'Program', body: '%\nO1000' }];

function rig(): { model: TemplateManager; asked: string[]; answer: { value: boolean } } {
  const asked: string[] = [];
  const answer = { value: false };
  const model = createTemplateManager({
    dialects: () => ['fanuc'],
    baseTemplates: () => structuredClone(BASE),
    variants: () => [],
    userFiles: { list: async () => [], path: async (name) => `/cfg/codes/${name}`, create: async (name) => name },
    reloadUserFiles: async () => {},
    docs: { find: () => undefined, open: async () => null, text: () => '', replace: () => {}, refusal: () => null, markClean: () => {}, save: async () => false, activeId: () => null, activate: () => {} },
    confirm: async (o) => {
      asked.push(o.title);
      return answer.value;
    },
    favorites: { get: () => [], set: () => {} },
    env: () => null,
  });
  return { model, asked, answer };
}

const Dialog = {} as Component<{ model: TemplateManager; close: (r?: unknown) => void }>;

afterEach(() => {
  closeModalForTest();
});

describe('T153: the press outside the template manager', () => {
  it('closes at once while nothing is changed', async () => {
    const r = rig();
    await r.model.load('fanuc');
    const opened = modals.open(Dialog, { model: r.model }, managerModalOptions(r.model));
    expect(get(currentModal)?.kind).toBe('component');
    expect(await dismissModal()).toBe(true);
    await expect(opened).resolves.toBeUndefined();
    expect(r.asked).toEqual([]);
  });

  it('asks with unsaved changes; No keeps the manager and the changes, Yes closes it', async () => {
    const r = rig();
    await r.model.load('fanuc');
    let closed = false;
    const opened = modals.open(Dialog, { model: r.model }, managerModalOptions(r.model)).then(() => (closed = true));
    r.model.add();
    expect(get(r.model.state).dirty).toBe(true);

    r.answer.value = false;
    expect(await dismissModal()).toBe(false);
    expect(r.asked).toHaveLength(1);
    expect(get(currentModal)).not.toBeNull();
    expect(closed).toBe(false);
    expect(get(r.model.state).dirty).toBe(true);

    r.answer.value = true;
    expect(await dismissModal()).toBe(true);
    await opened;
    expect(closed).toBe(true);
    expect(r.asked).toHaveLength(2);
  });

  it('asks for a half-made draft from a selection too', async () => {
    const r = rig();
    await r.model.load('fanuc');
    r.model.startDraft({ body: '{{N}}G0 X1.', candidates: [] }, {});
    r.model.setDraft('label', 'My move');
    void modals.open(Dialog, { model: r.model }, managerModalOptions(r.model));
    expect(await dismissModal()).toBe(false);
    expect(r.asked).toHaveLength(1);
  });
});
