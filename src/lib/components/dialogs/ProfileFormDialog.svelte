<!--
  "Edit Profile in Form" as a dialog (Phase 4 plan §6.10 rule 7; P4.40): the frame around
  `ProfileForm.svelte` for the palette command. Rendered through `modals.open`, so ModalHost
  supplies the backdrop; Esc, a press outside it and Cancel ask first when something typed would
  be lost (`mayClose` in `contrib/profileForm.ts`). The Profiles page shows the same form inline,
  because a modal cannot open over the Settings dialog.
-->
<script lang="ts">
  import Modal from '$lib/components/common/Modal.svelte';
  import ProfileForm from '$lib/components/dialogs/ProfileForm.svelte';
  import type { ProfileFormModel } from '$lib/app/profileForm';
  import { t } from '$lib/i18n';

  interface Props {
    /** Supplied by ModalHost. */
    close: (value?: unknown) => void;
    model: ProfileFormModel;
    /** "Duplicate as a user profile" (a built-in profile); the dialog closes and the opener makes the file. */
    onduplicate?: () => void;
    /** "Open as JSON": the dialog closes and the opener opens the file's tab. */
    onopenjson?: () => void;
  }

  let { close, model, onduplicate, onopenjson }: Props = $props();

  // The model is made by the opener and does not change while the dialog is open.
  // svelte-ignore state_referenced_locally
  const ms = model.state;

  async function cancel(): Promise<void> {
    if (await model.leave()) close();
  }

  async function save(): Promise<void> {
    if (await model.save()) close();
  }
</script>

<Modal id="profile-form" title={t($ms.readOnly ? 'profileForm.titleReadOnly' : 'profileForm.title', { name: $ms.id })} hideOk cancelLabel={t('profileForm.cancel')} onCancel={() => void cancel()}>
  <ProfileForm
    {model}
    buttons={false}
    onduplicate={onduplicate === undefined ? undefined : () => { onduplicate(); close(); }}
    onopenjson={onopenjson === undefined ? undefined : () => { onopenjson(); close(); }}
  />
  {#snippet footer()}
    <button
      type="button"
      class="primary"
      data-testid="profile-form-save"
      disabled={!$ms.open || $ms.readOnly || !$ms.canSave || !$ms.dirty || $ms.busy}
      onclick={() => void save()}>{t('profileForm.save')}</button
    >
  {/snippet}
</Modal>

<style>
  button {
    padding: 5px 14px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-ribbon);
    color: var(--text-main);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  button:disabled {
    color: var(--text-disabled);
    cursor: default;
  }

  button.primary:not(:disabled) {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--text-on-accent);
  }
</style>
