import React from "react";

type ErrorBoundaryState = {
  error: Error | null;
};

const SENTINEL_STORAGE_KEYS = [
  "sentinel-lifeops:activeTasks",
  "sentinel-lifeops:extractedTasks",
  "sentinel-lifeops:sentinelFeed",
  "sentinel-lifeops:slipAutopsies",
  "sentinel-lifeops:schemaVersion",
];

export default class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Sentinel LifeOps render failure", error, info);
  }

  private reload = () => {
    window.location.reload();
  };

  private clearLocalStateAndReload = () => {
    try {
      for (const key of SENTINEL_STORAGE_KEYS) {
        window.localStorage.removeItem(key);
      }
    } finally {
      window.location.reload();
    }
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0f1419] px-4 text-slate-100">
        <section className="w-full max-w-lg rounded-xl border border-rose-400/30 bg-slate-900 p-6 shadow-2xl">
          <p className="text-sm font-bold text-rose-200">Sentinel LifeOps stopped rendering</p>
          <h1 className="mt-2 text-2xl font-black text-white">The cockpit caught a bad local state.</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">
            Try reloading first. If it comes back to this screen, clear the local cockpit cache and reopen it.
          </p>
          <pre className="mt-4 max-h-32 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
            {this.state.error.message}
          </pre>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button onClick={this.reload} className="rounded-lg bg-cyan-400 px-4 py-3 text-sm font-black text-slate-950 hover:bg-cyan-300">
              Reload
            </button>
            <button onClick={this.clearLocalStateAndReload} className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-sm font-bold text-white hover:bg-slate-700">
              Clear local cache
            </button>
          </div>
        </section>
      </main>
    );
  }
}
