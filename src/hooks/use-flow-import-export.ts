'use client';

// ============================================================
// useFlowImportExportEnabled — whether the caller's OWN account has
// the Flows import/export feature enabled.
//
// Reads GET /api/flows/import-export on mount, which resolves the
// caller's account via getCurrentAccount() and returns that account's
// flag (set per account by a platform admin from /platform/accounts).
// Fails closed — any network or authorisation error hides the
// buttons, which is the safe default for a gated feature.

import { useEffect, useState } from 'react';

export function useFlowImportExportEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/flows/import-export', {
      cache: 'no-store',
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { enabled?: unknown };
        if (!cancelled && typeof data.enabled === 'boolean') {
          setEnabled(data.enabled);
        }
      })
      .catch(() => {
        // Fails closed — a transient error means "feature off".
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return enabled;
}