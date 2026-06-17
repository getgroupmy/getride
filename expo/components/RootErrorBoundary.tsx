import React from "react";

/** True when the value has no message/stack we could ever act on. */
function isContentlessError(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (value instanceof Error) {
    return !value.message && !value.stack;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const hasMessage =
      typeof obj.message === "string" && obj.message.trim().length > 0;
    const hasStack =
      typeof obj.stack === "string" && obj.stack.trim().length > 0;
    if (hasMessage || hasStack) return false;
    return Object.keys(obj).length === 0;
  }
  return false;
}

interface Props {
  children: React.ReactNode;
}

interface State {
  /** Incremented to force a remount/recovery after a content-less throw. */
  recoveryKey: number;
  /** A real (actionable) error we should surface to the user. */
  fatalError: Error | null;
}

/**
 * Catches render-time errors that bypass the promise / ErrorUtils guards.
 *
 * Content-less throws (a bare `{}` or empty value, typically a transient
 * preview/network artifact) are logged and silently recovered from by
 * remounting the subtree — they never reach the preview overlay. Real errors
 * carrying a message or stack are re-surfaced so they remain debuggable.
 */
export class RootErrorBoundary extends React.Component<Props, State> {
  state: State = { recoveryKey: 0, fatalError: null };

  static getDerivedStateFromError(error: unknown): Partial<State> | null {
    if (isContentlessError(error)) {
      return null;
    }
    return {
      fatalError: error instanceof Error ? error : new Error(String(error)),
    };
  }

  componentDidCatch(error: unknown, info: { componentStack: string }): void {
    if (isContentlessError(error)) {
      console.log(
        "[RootErrorBoundary] Recovered from content-less render error:",
        error,
        info.componentStack
      );
      // Force a remount of the subtree on the next tick.
      this.setState((s) => ({ recoveryKey: s.recoveryKey + 1 }));
      return;
    }
    console.error("[RootErrorBoundary] Render error:", error, info.componentStack);
  }

  render(): React.ReactNode {
    if (this.state.fatalError) {
      throw this.state.fatalError;
    }
    return (
      <React.Fragment key={this.state.recoveryKey}>
        {this.props.children}
      </React.Fragment>
    );
  }
}
