import { Component, type ReactNode } from "react";

/**
 * If one page breaks, say so (and offer a reload) instead of leaving a blank
 * screen. The rest of the dashboard (top bar, other tabs) keeps working.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page-error" role="alert">
        <h2>This page hit a problem</h2>
        <p className="muted">
          The rest of the dashboard still works. If you just updated it, restart it: in its Terminal window press Ctrl-C, then run <code>npm start</code> (or
          double-click start.command).
        </p>
        <p className="faint mono-small">{this.state.error.message}</p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
