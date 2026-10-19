<script lang="ts">
  // The one bundled font (Space Grotesk, OFL-1.1): the files are copied into the build and
  // served from the app itself, so nothing is ever fetched from the web and `font-src 'self'`
  // in the CSP is enough. It is used for headings only (`--font-display` in `app.css`).
  import '@fontsource-variable/space-grotesk/wght.css';
  import '../app.css';
  let { children } = $props();
</script>

{@render children()}
