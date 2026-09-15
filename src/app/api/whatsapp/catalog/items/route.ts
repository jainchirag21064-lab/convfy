import { NextResponse } from 'next/server'
import { getCurrentAccount } from '@/lib/auth/account'
import { toErrorResponse } from '@/lib/auth/account'

/**
 * GET /api/whatsapp/catalog/items
 *
 * Returns the synced catalog + its products for the current account.
 * Any account member can read (matches the product grid's visibility —
 * non-admins browse the catalog, only admins trigger a sync).
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const [{ data: catalog }, { data: items }] = await Promise.all([
      supabase.from('catalogs').select('*').eq('account_id', accountId),
      supabase
        .from('catalog_items')
        .select('*')
        .eq('account_id', accountId)
        .order('name', { ascending: true }),
    ])

    const currentCatalog = catalog?.[0] ?? null

    return NextResponse.json({
      catalog: currentCatalog,
      items: items ?? [],
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}