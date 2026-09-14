// ============================================================
// POST /api/platform/accounts/[id]/flows-import-export
//
// Platform-admin-only. Sets the per-account Flows import/export
// flag (accounts.flow_import_export_enabled, migration 048).
//
//   { "enabled": true }  → enable Import/Export for THIS account
//   { "enabled": false } → disable it (the default for every account)
//
// The flows editor reads its own account's flag via
// GET /api/flows/import-export, so enabling it here makes the
// Import/Export buttons appear for that account's users only.
// ============================================================

import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { requirePlatformAdmin } from '@/lib/auth/platform-admin';
import { platformAdminClient } from '@/lib/supabase/platform-admin-client';

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface Body {
  enabled?: unknown;
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    await requirePlatformAdmin();
    const supabase = platformAdminClient();

    if (!id) {
      return NextResponse.json(
        { error: 'Missing account id' },
        { status: 400 }
      );
    }

    let body: Body;
    try {
      body = (await request.json()) as Body;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json(
        { error: "'enabled' must be a boolean" },
        { status: 400 }
      );
    }

    const { data: account, error: loadErr } = await supabase
      .from('accounts')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    if (loadErr) {
      console.error(
        '[platform accounts flows-import-export] load error:',
        loadErr
      );
      return NextResponse.json(
        { error: 'Failed to load account' },
        { status: 500 }
      );
    }
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const { error } = await supabase
      .from('accounts')
      .update({ flow_import_export_enabled: body.enabled })
      .eq('id', id);

    if (error) {
      console.error(
        '[platform accounts flows-import-export] update error:',
        error
      );
      return NextResponse.json(
        { error: 'Failed to update flow import/export setting' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      id,
      flow_import_export_enabled: body.enabled,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}