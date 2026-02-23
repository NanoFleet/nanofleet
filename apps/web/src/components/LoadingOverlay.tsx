import { createContext, useCallback, useContext, useState } from 'react';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface LoadingOverlayContextValue {
  show: (label?: string) => void;
  hide: () => void;
}

const LoadingOverlayContext = createContext<LoadingOverlayContextValue>({
  show: () => {},
  hide: () => {},
});

export function useLoadingOverlay() {
  return useContext(LoadingOverlayContext);
}

// ---------------------------------------------------------------------------
// Provider + overlay
// ---------------------------------------------------------------------------

export function LoadingOverlayProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ visible: boolean; label: string }>({
    visible: false,
    label: '',
  });

  const show = useCallback((label = '') => setState({ visible: true, label }), []);
  const hide = useCallback(() => setState({ visible: false, label: '' }), []);

  return (
    <LoadingOverlayContext.Provider value={{ show, hide }}>
      {children}
      {state.visible && (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/40 backdrop-blur-[1px]">
          <div className="flex flex-col items-center gap-4 bg-white rounded-xl shadow-2xl px-8 py-6">
            <div className="w-8 h-8 border-[3px] border-neutral-200 border-t-neutral-900 rounded-full animate-spin" />
            {state.label && <p className="text-sm font-medium text-neutral-700">{state.label}</p>}
          </div>
        </div>
      )}
    </LoadingOverlayContext.Provider>
  );
}
