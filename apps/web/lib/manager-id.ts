/**
 * Stable UUID used as the "virtual project id" for the Manager's chat. Picked
 * so that all manager-related state on disk lives under a single, predictable
 * key without polluting the user-facing project list.
 *
 * Lives in its own file (not `server-only`) so client components can import it
 * without dragging the rest of `runtime.ts` into the browser bundle.
 */
export const MANAGER_PROJECT_ID = "00000000-0000-0000-0000-000000000001";
