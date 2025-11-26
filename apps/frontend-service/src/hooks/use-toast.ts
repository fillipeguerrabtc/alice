import { useState, useCallback } from 'react';

export interface Toast {
  id: string;
  title?: string;
  description?: string;
  variant?: 'default' | 'destructive';
}

interface ToastState {
  toasts: Toast[];
}

let toastId = 0;
const listeners: Array<(state: ToastState) => void> = [];
let memoryState: ToastState = { toasts: [] };

function dispatch(action: { type: 'ADD_TOAST'; toast: Toast } | { type: 'DISMISS_TOAST'; toastId: string }) {
  if (action.type === 'ADD_TOAST') {
    memoryState = {
      ...memoryState,
      toasts: [...memoryState.toasts, action.toast],
    };
  } else if (action.type === 'DISMISS_TOAST') {
    memoryState = {
      ...memoryState,
      toasts: memoryState.toasts.filter((t) => t.id !== action.toastId),
    };
  }

  listeners.forEach((listener) => listener(memoryState));
}

export function toast(props: Omit<Toast, 'id'>) {
  const id = String(toastId++);
  dispatch({ type: 'ADD_TOAST', toast: { id, ...props } });

  setTimeout(() => {
    dispatch({ type: 'DISMISS_TOAST', toastId: id });
  }, 5000);

  return id;
}

export function useToast() {
  const [state, setState] = useState<ToastState>(memoryState);

  useState(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) listeners.splice(index, 1);
    };
  });

  const dismiss = useCallback((toastId: string) => {
    dispatch({ type: 'DISMISS_TOAST', toastId });
  }, []);

  return {
    ...state,
    toast,
    dismiss,
  };
}
