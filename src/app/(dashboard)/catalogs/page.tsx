'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { StorefrontIcon } from '@/components/ui/brand-icons';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useCan } from '@/hooks/use-can';
import { Loader2, RefreshCcw } from 'lucide-react';
import type { Catalog, CatalogItem } from '@/types';

interface CatalogResponse {
  catalog: Catalog | null;
  items: CatalogItem[];
}

interface SyncResponse {
  success: boolean;
  error?: string;
}

function formatPrice(price: string | null, currency: string | null): string {
  if (!price) return '—';
  const amount = Number(price);
  if (Number.isNaN(amount)) return price;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency ?? 'USD',
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${price} ${currency ?? ''}`.trim();
  }
}

export default function CatalogsPage() {
  const t = useTranslations('Catalogs.page');
  const canSync = useCan('edit-settings');

  const [items, setItems] = useState<CatalogItem[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchItems() {
    try {
      const res = await fetch('/api/whatsapp/catalog/items');
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? t('errorLoad'));
      }
      const data: CatalogResponse = await res.json();
      setItems(data.items);
      setCatalog(data.catalog);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorLoad'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchItems();
  }, []);

  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch('/api/whatsapp/catalog/sync', { method: 'POST' });
      const body: SyncResponse = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body?.error ?? t('errorSync'));
      }
      await fetchItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorSync'));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {catalog?.last_synced_at
              ? t('lastSynced', {
                  time: new Date(catalog.last_synced_at).toLocaleString(),
                })
              : t('neverSynced')}
          </p>
        </div>
        <Button
          onClick={handleSync}
          disabled={syncing || !canSync}
          title={canSync ? undefined : t('syncAdminOnly')}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {syncing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="h-4 w-4" />
          )}
          {syncing ? t('syncing') : t('sync')}
        </Button>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
          <p className="text-sm text-red-300">{error}</p>
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
            {t('retry')}
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-border bg-card">
          <StorefrontIcon className="mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">{t('noProducts')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('noProductsDesc')}</p>
          {canSync && (
            <Button
              onClick={handleSync}
              disabled={syncing}
              className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <RefreshCcw className="h-4 w-4" />
              {t('sync')}
            </Button>
          )}
        </div>
      ) : (
        <>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('productCount', { count: items.length })}
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((item) => (
              <div
                key={item.id}
                className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card"
              >
                <div className="relative flex h-44 items-center justify-center overflow-hidden bg-muted/40">
                  {item.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.image_url}
                      alt={item.name}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      loading="lazy"
                    />
                  ) : (
                    <StorefrontIcon className="h-8 w-8 text-muted-foreground/50" />
                  )}
                  {item.availability && (
                    <Badge
                      variant={item.availability === 'IN_STOCK' ? 'default' : 'secondary'}
                      className="absolute left-2 top-2"
                    >
                      {item.availability === 'IN_STOCK' ? t('inStock') : t('outOfStock')}
                    </Badge>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-1 p-3">
                  <p className="line-clamp-2 text-sm font-medium text-foreground">
                    {item.name}
                  </p>
                  {item.description && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {item.description}
                    </p>
                  )}
                  <div className="mt-auto flex items-center justify-between pt-2">
                    <span className="text-sm font-semibold text-foreground">
                      {formatPrice(item.price, item.currency)}
                    </span>
                    {item.status && (
                      <Badge
                        variant={
                          item.status === 'APPROVED'
                            ? 'outline'
                            : item.status === 'PENDING'
                              ? 'secondary'
                              : 'destructive'
                        }
                      >
                        {item.status === 'APPROVED'
                          ? t('approved')
                          : item.status === 'PENDING'
                            ? t('pending')
                            : t('rejected')}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}