import { useState, useMemo, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useCategories } from '@/hooks/useCategories';
import { useMenu } from '@/hooks/useMenu';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { formatCurrency } from '@/lib/format';
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  UtensilsCrossed,
  Tag,
  Loader2,
  AlertCircle,
  Eye,
  EyeOff,
  Check,
  X,
} from 'lucide-react';
import type { Category, MenuItem } from '@/types';

type CategoryModal = { mode: 'create' } | { mode: 'edit'; category: Category } | null;
type ItemModal =
  | { mode: 'create'; categoryId?: string }
  | { mode: 'edit'; item: MenuItem }
  | null;

export function MenuManagement() {
  const {
    categories,
    loading: catLoading,
    createCategory,
    updateCategory,
    deleteCategory,
  } = useCategories();
  const { items, loading: itemLoading, refetch: refetchMenu } = useMenu(true);

  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [catModal, setCatModal] = useState<CategoryModal>(null);
  const [itemModal, setItemModal] = useState<ItemModal>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Category modal form state
  const [catName, setCatName] = useState('');
  const [catSort, setCatSort] = useState(0);

  // Item modal form state
  const [itemName, setItemName] = useState('');
  const [itemDesc, setItemDesc] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [itemCategory, setItemCategory] = useState('');
  const [itemImageUrl, setItemImageUrl] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [itemAvailable, setItemAvailable] = useState(true);

  // Reset category modal fields when opening
  useEffect(() => {
    if (catModal?.mode === 'create') {
      setCatName('');
      setCatSort(0);
    } else if (catModal?.mode === 'edit') {
      setCatName(catModal.category.name);
      setCatSort(catModal.category.sort_order);
    }
  }, [catModal]);

  // Reset item modal fields when opening
  useEffect(() => {
    setUploadError(null);
    if (itemModal?.mode === 'create') {
      setItemName('');
      setItemDesc('');
      setItemPrice('');
      setItemCategory(itemModal.categoryId ?? categories[0]?.id ?? '');
      setItemImageUrl('');
      setItemAvailable(true);
    } else if (itemModal?.mode === 'edit') {
      setItemName(itemModal.item.name);
      setItemDesc(itemModal.item.description ?? '');
      setItemPrice(String(itemModal.item.price));
      setItemCategory(itemModal.item.category_id ?? '');
      setItemImageUrl(itemModal.item.image_url ?? '');
      setItemAvailable(itemModal.item.available);
    }
  }, [itemModal, categories]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesCategory =
        activeCategory === 'all' || item.category_id === activeCategory;
      const matchesSearch =
        search.trim() === '' ||
        item.name.toLowerCase().includes(search.trim().toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [items, activeCategory, search]);

  async function handleSaveCategory() {
    setError(null);
    setSaving(true);
    try {
      if (catModal?.mode === 'create') {
        await createCategory(catName.trim(), catSort);
      } else if (catModal?.mode === 'edit') {
        await updateCategory(catModal.category.id, catName.trim(), catSort);
      }
      setCatModal(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteCategory(cat: Category) {
    const itemCount = items.filter((i) => i.category_id === cat.id).length;
    const confirm = window.confirm(
      `Delete category "${cat.name}"?${
        itemCount > 0
          ? `\n\n${itemCount} menu item(s) will lose their category link but won't be deleted.`
          : ''
      }`
    );
    if (!confirm) return;
    setError(null);
    try {
      await deleteCategory(cat.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleSaveItem() {
    setError(null);
    setSaving(true);
    try {
      const price = parseFloat(itemPrice);
      if (!itemName.trim() || isNaN(price) || price < 0) {
        setError('Name and valid price are required.');
        setSaving(false);
        return;
      }

      const cat = categories.find((c) => c.id === itemCategory);
      const payload = {
        name: itemName.trim(),
        description: itemDesc.trim() || null,
        price,
        category: cat?.name ?? 'Uncategorized',
        category_id: itemCategory || null,
        image_url: itemImageUrl.trim() || null,
        available: itemAvailable,
      };

      if (itemModal?.mode === 'create') {
        const { error: insertError } = await supabase
          .from('menu_items')
          .insert(payload);
        if (insertError) throw insertError;
      } else if (itemModal?.mode === 'edit') {
        const { error: updateError } = await supabase
          .from('menu_items')
          .update(payload)
          .eq('id', itemModal.item.id);
        if (updateError) throw updateError;
      }
      refetchMenu();
      setItemModal(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleImageUpload(file: File) {
    setUploadError(null);
    if (!file.type.startsWith('image/')) {
      setUploadError('Please choose an image file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError('Image must be under 5MB.');
      return;
    }
    setUploadingImage(true);
    try {
      const ext = file.name.split('.').pop() ?? 'jpg';
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('menu-images')
        .upload(path, file, { cacheControl: '3600', upsert: false });
      if (uploadErr) throw uploadErr;

      const { data } = supabase.storage.from('menu-images').getPublicUrl(path);
      setItemImageUrl(data.publicUrl);
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleDeleteItem(item: MenuItem) {
    const confirm = window.confirm(
      `Delete "${item.name}"? This cannot be undone.`
    );
    if (!confirm) return;
    setError(null);
    try {
      const { error: delError } = await supabase
        .from('menu_items')
        .delete()
        .eq('id', item.id);
      if (delError) throw delError;
      refetchMenu();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function toggleAvailability(item: MenuItem) {
    try {
      const { error } = await supabase
        .from('menu_items')
        .update({ available: !item.available })
        .eq('id', item.id);
      if (error) throw error;
      refetchMenu();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const loading = catLoading || itemLoading;

  return (
    <DashboardLayout>
      <div className="animate-fade-in-up space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-ink-900">Menu Management</h1>
            <p className="mt-1 text-sm text-ink-500">
              Manage categories, menu items, and availability
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setCatModal({ mode: 'create' })}>
              <Tag className="h-4 w-4" />
              New Category
            </Button>
            <Button onClick={() => setItemModal({ mode: 'create' })}>
              <Plus className="h-4 w-4" />
              New Item
            </Button>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-error-50 border border-error-500/20 px-4 py-3">
            <AlertCircle className="h-5 w-5 text-error-600 flex-shrink-0 mt-0.5" />
            <span className="text-sm text-error-700">{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-error-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Categories bar */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setActiveCategory('all')}
            className={`whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${
              activeCategory === 'all'
                ? 'bg-primary-600 text-ink-950 shadow-sm'
                : 'bg-surface text-ink-600 border border-ink-200 hover:bg-ink-50'
            }`}
          >
            All Items ({items.length})
          </button>
          {categories.map((cat) => {
            const count = items.filter((i) => i.category_id === cat.id).length;
            return (
              <div key={cat.id} className="flex items-center group relative">
                <button
                  onClick={() => setActiveCategory(cat.id)}
                  className={`whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${
                    activeCategory === cat.id
                      ? 'bg-primary-600 text-ink-950 shadow-sm'
                      : 'bg-surface text-ink-600 border border-ink-200 hover:bg-ink-50'
                  }`}
                >
                  {cat.name} ({count})
                </button>
                <div className="flex gap-0.5 ml-1 opacity-0 group-hover:opacity-100 transition">
                  <button
                    onClick={() => setCatModal({ mode: 'edit', category: cat })}
                    className="text-ink-400 hover:text-primary-600"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteCategory(cat)}
                    className="text-ink-400 hover:text-error-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-ink-400" />
          <input
            type="text"
            placeholder="Search menu items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-ink-300 bg-surface pl-11 pr-4 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition"
          />
        </div>

        {/* Items table */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <UtensilsCrossed className="h-12 w-12 text-ink-300 mb-3" />
            <p className="text-sm font-medium text-ink-600">No menu items found</p>
            <p className="text-xs text-ink-400 mt-1">Create a new item to get started</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl bg-surface shadow-sm ring-1 ring-ink-200/60">
            <table className="w-full">
              <thead>
                <tr className="border-b border-ink-200 bg-ink-50/50">
                  <th className="text-left text-xs font-semibold text-ink-600 uppercase tracking-wider px-5 py-3">
                    Item
                  </th>
                  <th className="text-left text-xs font-semibold text-ink-600 uppercase tracking-wider px-5 py-3">
                    Category
                  </th>
                  <th className="text-right text-xs font-semibold text-ink-600 uppercase tracking-wider px-5 py-3">
                    Price
                  </th>
                  <th className="text-center text-xs font-semibold text-ink-600 uppercase tracking-wider px-5 py-3">
                    Available
                  </th>
                  <th className="text-right text-xs font-semibold text-ink-600 uppercase tracking-wider px-5 py-3">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {filteredItems.map((item) => {
                  const cat = categories.find((c) => c.id === item.category_id);
                  return (
                    <tr key={item.id} className="hover:bg-ink-50/50 transition">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          {item.image_url ? (
                            <img
                              src={item.image_url}
                              alt=""
                              className="h-10 w-10 rounded-md object-cover flex-shrink-0 ring-1 ring-ink-200/60"
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <div className="h-10 w-10 rounded-md bg-ink-100 flex items-center justify-center flex-shrink-0">
                              <UtensilsCrossed className="h-4 w-4 text-ink-400" />
                            </div>
                          )}
                          <div>
                            <div className="font-semibold text-ink-900 text-sm">{item.name}</div>
                            {item.description && (
                              <div className="text-xs text-ink-500 mt-0.5 line-clamp-1">
                                {item.description}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        {cat ? (
                          <span className="rounded-md bg-primary-50 text-primary-700 px-2 py-0.5 text-xs font-semibold">
                            {cat.name}
                          </span>
                        ) : (
                          <span className="text-xs text-ink-400">Uncategorized</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right font-bold text-ink-900 tabular-nums text-sm">
                        {formatCurrency(item.price)}
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        <button
                          onClick={() => toggleAvailability(item)}
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                            item.available
                              ? 'bg-success-50 text-success-700 hover:bg-success-100'
                              : 'bg-ink-100 text-ink-500 hover:bg-ink-200'
                          }`}
                        >
                          {item.available ? (
                            <>
                              <Eye className="h-3.5 w-3.5" />
                              Available
                            </>
                          ) : (
                            <>
                              <EyeOff className="h-3.5 w-3.5" />
                              Hidden
                            </>
                          )}
                        </button>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setItemModal({ mode: 'edit', item })}
                            className="p-1.5 text-ink-400 hover:text-primary-600 hover:bg-primary-50 rounded-md transition"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteItem(item)}
                            className="p-1.5 text-ink-400 hover:text-error-600 hover:bg-error-50 rounded-md transition"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Category Modal */}
      <Modal
        open={catModal !== null}
        onClose={() => setCatModal(null)}
        title={catModal?.mode === 'edit' ? 'Edit Category' : 'New Category'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCatModal(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveCategory} disabled={saving || !catName.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {catModal?.mode === 'edit' ? 'Save' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-ink-700 mb-1.5">
              Category Name
            </label>
            <input
              type="text"
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              placeholder="e.g. Appetizers"
              className="w-full rounded-lg border border-ink-300 bg-surface px-4 py-2.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-ink-700 mb-1.5">
              Sort Order
            </label>
            <input
              type="number"
              value={catSort}
              onChange={(e) => setCatSort(parseInt(e.target.value) || 0)}
              className="w-full rounded-lg border border-ink-300 bg-surface px-4 py-2.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition"
            />
          </div>
        </div>
      </Modal>

      {/* Item Modal */}
      <Modal
        open={itemModal !== null}
        onClose={() => setItemModal(null)}
        title={itemModal?.mode === 'edit' ? 'Edit Menu Item' : 'New Menu Item'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setItemModal(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveItem} disabled={saving || !itemName.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {itemModal?.mode === 'edit' ? 'Save' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-ink-700 mb-1.5">
              Item Name
            </label>
            <input
              type="text"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="e.g. Grilled Salmon"
              className="w-full rounded-lg border border-ink-300 bg-surface px-4 py-2.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-ink-700 mb-1.5">
              Description
            </label>
            <textarea
              value={itemDesc}
              onChange={(e) => setItemDesc(e.target.value)}
              placeholder="Short description shown on POS cards"
              rows={2}
              className="w-full rounded-lg border border-ink-300 bg-surface px-4 py-2.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-ink-700 mb-1.5">
                Price ($)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={itemPrice}
                onChange={(e) => setItemPrice(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-ink-300 bg-surface px-4 py-2.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-ink-700 mb-1.5">
                Category
              </label>
              <select
                value={itemCategory}
                onChange={(e) => setItemCategory(e.target.value)}
                className="w-full rounded-lg border border-ink-300 bg-surface px-4 py-2.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition"
              >
                <option value="">Uncategorized</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-ink-700 mb-1.5">
              Image
            </label>
            <div className="flex items-center gap-3">
              {itemImageUrl.trim() ? (
                <img
                  src={itemImageUrl.trim()}
                  alt=""
                  className="h-12 w-12 rounded-lg object-cover flex-shrink-0 ring-1 ring-ink-200/60"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                  }}
                />
              ) : (
                <div className="h-12 w-12 rounded-lg bg-ink-100 flex items-center justify-center flex-shrink-0">
                  <UtensilsCrossed className="h-5 w-5 text-ink-400" />
                </div>
              )}
              <input
                type="url"
                value={itemImageUrl}
                onChange={(e) => setItemImageUrl(e.target.value)}
                placeholder="https://example.com/photo.jpg"
                className="flex-1 rounded-lg border border-ink-300 bg-surface px-4 py-2.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition"
              />
              <label className="flex-shrink-0 cursor-pointer rounded-lg border border-ink-300 bg-surface px-3 py-2.5 text-xs font-semibold text-ink-600 hover:bg-ink-50 transition">
                {uploadingImage ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Upload'
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploadingImage}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImageUpload(file);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            {uploadError && <p className="mt-1.5 text-xs text-error-600">{uploadError}</p>}
            <p className="mt-1.5 text-xs text-ink-400">
              Paste a photo URL, or upload one directly (JPG/PNG, up to 5MB).
            </p>
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <button
              type="button"
              onClick={() => setItemAvailable((v) => !v)}
              className={`relative h-6 w-11 rounded-full transition ${
                itemAvailable ? 'bg-success-500' : 'bg-ink-300'
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  itemAvailable ? 'left-[1.375rem]' : 'left-0.5'
                }`}
              />
            </button>
            <span className="text-sm font-semibold text-ink-700">
              {itemAvailable ? 'Available on POS' : 'Hidden from POS'}
            </span>
          </label>
        </div>
      </Modal>
    </DashboardLayout>
  );
}
