// ============================================================
// GET /api/flows/import-export
//
// Returns the CALLER'S OWN account's Flows import/export flag
// (accounts.flow_import_export_enabled, migration 048):
//
//   { "enabled": boolean }
//
// The flow editor reads this on mount to decide whether to render
// the Import/Export buttons. Scoping is automatic: getCurrentAccount()
// resolves the caller's account and the RLS-scoped SSR client can only
// read rows the caller belongs to, so a user can never see another
// account's flag. Platform admins enable/disable this per account from
// /platform/accounts (POST /api/platform/accounts/[id]/flows-import-export).
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const { data, error } = await supabase
      .from('accounts')
      .select('flow_import_export_enabled')
      .eq('id', accountId)
      .maybeSingle();

    if (error) {
      console.error('[flows import-export] read error:', error);
      return NextResponse.json(
        { error: 'Failed to load feature flag' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      enabled: data?.flow_import_export_enabled === true,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}