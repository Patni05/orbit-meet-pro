'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui/primitives';

interface Props {
  children: ReactNode;
  /** Rendered instead of the default panel; used to keep a meeting alive when a side panel fails. */
  fallback?: (reset: () => void) => ReactNode;
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * Error boundary.
 *
 * Scoped deliberately: the whole app has one, and the risky parts of the
 * meeting UI (side panels, the video grid) have their own, so a failure in the
 * chat panel does not drop the call.
 *
 * The user is shown a plain message — never the stack, which goes to the
 * console for developers.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error(`[orbit] ${this.props.label ?? 'UI'} error:`, error, info.componentStack);
  }

  private reset = (): void => this.setState({ error: null });

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.reset);

    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 p-8 text-center">
        <div>
          <h2 className="text-lg font-semibold">Something went wrong here</h2>
          <p className="mt-1 max-w-sm text-sm text-ink-500 dark:text-ink-400">
            This part of the page could not be displayed. The rest of the app is still working.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={this.reset}>
            Try again
          </Button>
          <Button onClick={() => window.location.reload()}>Reload page</Button>
        </div>
      </div>
    );
  }
}
