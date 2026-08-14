/**
 * What a home-screen service tile does when it is tapped.
 *
 * The five tiles under the home bottom sheet are admin-configurable (label,
 * icon, image, linked service entry) but had no destination at all: every one
 * called `console.log` and nothing else, so a rider tapped a card that looked
 * live and got no response. This resolves the tap the same way the side-menu
 * items already do — an admin-set route, or the coming-soon notice.
 *
 * A tile with nowhere to go is "coming soon", never a dead tap: the notice is
 * an honest answer, silence is not.
 */

export type ServiceBoxAction =
  | { kind: "navigate"; route: string }
  | { kind: "coming-soon" };

export type ServiceBoxRouting = {
  /** Admin-entered in-app path, e.g. "/ride-confirm". */
  route?: string;
  /** Admin marked this tile as not launched yet. */
  comingSoon?: boolean;
};

/**
 * Admin-entered routes are pushed straight into the router, so only in-app
 * paths are accepted. A bare name, an external scheme, or anything with
 * whitespace in it is not a route this app can open — treat it as unset rather
 * than handing it to `router.push`.
 */
export function normalizeServiceBoxRoute(raw: string | undefined | null): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith("/")) return undefined;
  if (/\s/.test(trimmed)) return undefined;
  // "//host" is protocol-relative and leaves the app.
  if (trimmed.startsWith("//")) return undefined;
  return trimmed;
}

/**
 * `serviceEnabled` is the existing global switch the pickup bar and search
 * button already honour; when the operator has the service turned off, no tile
 * navigates regardless of its own configuration.
 */
export function resolveServiceBoxAction(
  box: ServiceBoxRouting | undefined,
  opts: { serviceEnabled: boolean }
): ServiceBoxAction {
  if (!opts.serviceEnabled) return { kind: "coming-soon" };
  if (box?.comingSoon) return { kind: "coming-soon" };
  const route = normalizeServiceBoxRoute(box?.route);
  if (!route) return { kind: "coming-soon" };
  return { kind: "navigate", route };
}

/**
 * The badge drawn on the tile. A tile that will only ever raise the coming-soon
 * notice says so before it is tapped rather than only after — the state has to
 * be visible, not just discoverable.
 */
export function serviceBoxBadge(
  box: ServiceBoxRouting | undefined,
  opts: { serviceEnabled: boolean; newBadge?: boolean }
): string | undefined {
  if (resolveServiceBoxAction(box, opts).kind === "coming-soon") return "SOON";
  return opts.newBadge ? "NEW" : undefined;
}
