import { NextResponse } from 'next/server'
import {
  ForbiddenError,
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'

/**
 * Sync the WhatsApp product catalog → local catalogs + catalog_items tables.
 *
 * A WABA has exactly one connected catalog. Sync is a two-step fetch:
 *   1. GET /{waba_id}/product_catalogs  → the connected catalog id + name
 *   2. GET /{catalog_id}/products        → every product in the catalog
 *
 * Products are stored keyed by (account_id, meta_product_id) so a re-sync
 * updates rather than duplicates. Locally-created rows never exist for
 * catalogs (there is no local create path), so sync is a full refresh —
 * products removed from Meta are deleted here to keep the grid truthful.
 */

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

const PRODUCT_FIELDS = [
  'id',
  'name',
  'description',
  'price',
  'currency',
  'retailer_id',
  'url',
  'availability',
  'status',
  'media',
].join(',')

interface MetaProductCatalog {
  id: string
  name?: string
}

interface MetaProductMedia {
  images?: { id?: string; url?: string; original_image_url?: string }[]
}

interface MetaProduct {
  id: string
  name?: string
  description?: string
  price?: string
  currency?: string
  retailer_id?: string
  url?: string
  availability?: string
  status?: string
  media?: MetaProductMedia
}

async function metaFetch(
  url: string,
  accessToken: string,
): Promise<{ error?: string; body?: unknown }> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    let message = `Meta API error: ${res.status}`
    try {
      const body = await res.json()
      if (body?.error?.message) message = body.error.message
    } catch {
      // response wasn't JSON — keep the fallback
    }
    return { error: message }
  }
  return { body: await res.json() }
}

export async function POST() {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .single()

    if (configError || !config) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Connect your WhatsApp Business account in Settings first.',
        },
        { status: 400 },
      )
    }

    if (!config.waba_id) {
      return NextResponse.json(
        {
          error:
            'WABA (WhatsApp Business Account) ID missing. Re-connect your account in Settings.',
        },
        { status: 400 },
      )
    }

    const accessToken = decrypt(config.access_token)

    // Step 1: find the connected catalog.
    const catalogResult = await metaFetch(
      `${META_API_BASE}/${config.waba_id}/product_catalogs`,
      accessToken,
    )
    if (catalogResult.error || !catalogResult.body) {
      return NextResponse.json(
        { error: catalogResult.error ?? 'Failed to fetch catalog' },
        { status: 502 },
      )
    }
    const catalogBody = catalogResult.body as {
      data?: MetaProductCatalog[]
    }
    const metaCatalog = catalogBody.data?.[0]
    if (!metaCatalog) {
      return NextResponse.json(
        {
          error:
            'No product catalog is connected to your WhatsApp Business Account. Connect one in Meta Business Suite → Commerce Manager first.',
        },
        { status: 400 },
      )
    }

    // Upsert the catalogs row.
    const { data: existingCatalog, error: catalogLookupErr } = await supabase
      .from('catalogs')
      .select('id')
      .eq('account_id', accountId)
      .eq('meta_catalog_id', metaCatalog.id)
      .maybeSingle()

    if (catalogLookupErr) {
      return NextResponse.json(
        { error: catalogLookupErr.message },
        { status: 500 },
      )
    }

    const now = new Date().toISOString()
    let catalogRowId: string

    if (existingCatalog?.id) {
      const { error: updErr } = await supabase
        .from('catalogs')
        .update({
          name: metaCatalog.name ?? null,
          last_synced_at: now,
          synced_by: userId,
          updated_at: now,
        })
        .eq('id', existingCatalog.id)
      if (updErr) {
        return NextResponse.json({ error: updErr.message }, { status: 500 })
      }
      catalogRowId = existingCatalog.id
    } else {
      const { data, error: insErr } = await supabase
        .from('catalogs')
        .insert({
          account_id: accountId,
          user_id: userId,
          meta_catalog_id: metaCatalog.id,
          name: metaCatalog.name ?? null,
          last_synced_at: now,
          synced_by: userId,
        })
        .select('id')
        .single()
      if (insErr || !data) {
        return NextResponse.json(
          { error: insErr?.message ?? 'Failed to save catalog' },
          { status: 500 },
        )
      }
      catalogRowId = data.id
    }

    // Step 2: pull every product (paginated).
    const metaProducts: MetaProduct[] = []
    let nextUrl:
      | string
      | null = `${META_API_BASE}/${metaCatalog.id}/products?limit=100&fields=${PRODUCT_FIELDS}`
    const PAGE_CAP = 20
    let pageCount = 0

    while (nextUrl && pageCount < PAGE_CAP) {
      pageCount++
      const productResult = await metaFetch(nextUrl, accessToken)
      if (productResult.error || !productResult.body) {
        return NextResponse.json(
          { error: productResult.error ?? 'Failed to fetch products' },
          { status: 502 },
        )
      }
      const productBody = productResult.body as {
        data?: MetaProduct[]
        paging?: { next?: string }
      }
      if (productBody.data) metaProducts.push(...productBody.data)
      nextUrl = productBody.paging?.next ?? null
    }

    const syncedProductIds = new Set(metaProducts.map((p) => p.id))
    const existingMetaIds: string[] = []
    let inserted = 0
    let updated = 0
    let deleted = 0
    const errors: { name: string; message: string }[] = []

    // Fetch all existing product rows for this account so we can keep
    // meta_product_id lookups cheap and delete rows removed from Meta.
    const { data: existingItems } = await supabase
      .from('catalog_items')
      .select('id, meta_product_id')
      .eq('account_id', accountId)

    for (const row of existingItems ?? []) {
      if (!syncedProductIds.has(row.meta_product_id)) {
        const { error: delErr } = await supabase
          .from('catalog_items')
          .delete()
          .eq('id', row.id)
        if (!delErr) deleted++
      } else {
        existingMetaIds.push(row.meta_product_id)
      }
    }

    for (const p of metaProducts) {
      const image = p.media?.images?.[0]
      const row = {
        account_id: accountId,
        catalog_id: catalogRowId,
        meta_product_id: p.id,
        retailer_id: p.retailer_id ?? null,
        name: p.name ?? '',
        description: p.description ?? null,
        price: p.price ?? null,
        currency: p.currency ?? null,
        url: p.url ?? null,
        availability: p.availability ?? null,
        status: p.status ?? null,
        image_url: image?.original_image_url ?? image?.url ?? null,
        images: p.media?.images?.length
          ? p.media.images.map((img) => ({
              url: img.url ?? null,
              original_image_url: img.original_image_url ?? null,
            }))
          : null,
        updated_at: now,
      }

      if (existingMetaIds.includes(p.id)) {
        const { error: updErr } = await supabase
          .from('catalog_items')
          .update(row)
          .eq('account_id', accountId)
          .eq('meta_product_id', p.id)
        if (updErr) {
          errors.push({ name: p.name ?? p.id, message: updErr.message })
        } else {
          updated++
        }
      } else {
        const { error: insErr } = await supabase
          .from('catalog_items')
          .insert(row)
        if (insErr) {
          errors.push({ name: p.name ?? p.id, message: insErr.message })
        } else {
          inserted++
        }
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      catalogName: metaCatalog.name ?? null,
      catalogId: metaCatalog.id,
      total: metaProducts.length,
      inserted,
      updated,
      deleted,
      errors,
      truncated: pageCount >= PAGE_CAP && nextUrl !== null,
    })
  } catch (error) {
    if (
      error instanceof UnauthorizedError ||
      error instanceof ForbiddenError
    ) {
      return toErrorResponse(error)
    }
    console.error('Error syncing WhatsApp catalog:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to sync catalog',
      },
      { status: 500 },
    )
  }
}