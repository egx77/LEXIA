'use client';

import { useEffect } from 'react';
import { useFormStatus } from 'react-dom';

/** Registers the static-shell service worker (FR-020). It never caches /app or /api responses. */
export function SwRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);
  return null;
}

export function Submit({ children, className = 'btn primary', pendingText = 'Working…', name, value, formAction }: {
  children: React.ReactNode; className?: string; pendingText?: string; name?: string; value?: string; formAction?: (fd: FormData) => void | Promise<void>;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-disabled={pending} name={name} value={value} formAction={formAction}>
      {pending ? pendingText : children}
      {pending && <span className="sr-only" role="status">{pendingText}</span>}
    </button>
  );
}

/** Warn before leaving with unsaved edits in the draft editor (autosave is not assumed — FD 03 §7). */
export function UnsavedGuard({ formId }: { formId: string }) {
  useEffect(() => {
    const form = document.getElementById(formId);
    if (!form) return;
    let dirty = false;
    const mark = () => { dirty = true; };
    const clear = () => { dirty = false; };
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); } };
    form.addEventListener('input', mark);
    form.addEventListener('submit', clear);
    window.addEventListener('beforeunload', warn);
    return () => { form.removeEventListener('input', mark); form.removeEventListener('submit', clear); window.removeEventListener('beforeunload', warn); };
  }, [formId]);
  return null;
}

export function OnlineStatus() {
  useEffect(() => {
    const el = document.getElementById('net-status');
    const upd = () => { if (el) el.hidden = navigator.onLine; };
    upd();
    window.addEventListener('online', upd);
    window.addEventListener('offline', upd);
    return () => { window.removeEventListener('online', upd); window.removeEventListener('offline', upd); };
  }, []);
  return (
    <div id="net-status" className="notice" role="status" hidden>
      You are offline. Confidential matter data requires an online connection; nothing private is stored on this device.
    </div>
  );
}
