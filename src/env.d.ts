interface ImportMetaEnv {
  /** Dev-only: '1' mounts the Agentation visual review toolbar + panel. */
  readonly VITE_VISUAL_REVIEW?: string
  /** Dev-only: agentation-mcp HTTP server, e.g. http://localhost:4748 */
  readonly VITE_AGENTATION_ENDPOINT: string
  /** Dev-only: limit the toolbar to one pathname; empty = every page. */
  readonly VITE_VISUAL_REVIEW_PATH?: string
}
