import { useRef, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { usePromotions, type NewPromotionMediaInput } from '@/hooks/usePromotions';
import { guessMediaTypeFromUrl } from '@/lib/promoMedia';
import {
  Plus,
  Trash2,
  Loader2,
  AlertCircle,
  Megaphone,
  ExternalLink,
  Upload,
  Link as LinkIcon,
  ImageIcon,
  Video,
  X,
} from 'lucide-react';
import type { Promotion } from '@/types';

interface MediaEntry {
  localId: string;
  kind: 'file' | 'url';
  file?: File;
  url?: string;
  previewUrl?: string;
}

export function PromotionManagement() {
  const { promotions, loading, error, addPromotion, togglePromotion, deletePromotion } =
    usePromotions();

  const [addOpen, setAddOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [mediaEntries, setMediaEntries] = useState<MediaEntry[]>([]);
  const [urlDraft, setUrlDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Promotion | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetForm() {
    mediaEntries.forEach((entry) => {
      if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    });
    setTitle('');
    setMediaEntries([]);
    setUrlDraft('');
    setFormError(null);
  }

  function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    const next: MediaEntry[] = Array.from(files).map((file) => ({
      localId: crypto.randomUUID(),
      kind: 'file',
      file,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
    }));
    setMediaEntries((prev) => [...prev, ...next]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleAddUrl() {
    const trimmed = urlDraft.trim();
    if (!trimmed) return;
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    setMediaEntries((prev) => [
      ...prev,
      { localId: crypto.randomUUID(), kind: 'url', url: normalized },
    ]);
    setUrlDraft('');
  }

  function removeEntry(localId: string) {
    setMediaEntries((prev) => {
      const target = prev.find((e) => e.localId === localId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((e) => e.localId !== localId);
    });
  }

  async function handleAdd() {
    if (!title.trim()) {
      setFormError('Enter a title');
      return;
    }
    if (mediaEntries.length === 0) {
      setFormError('Add at least one image or video — upload a file or add a URL');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const inputs: NewPromotionMediaInput[] = mediaEntries.map((entry) =>
        entry.kind === 'file' ? { kind: 'file', file: entry.file! } : { kind: 'url', url: entry.url! }
      );
      await addPromotion(title.trim(), inputs);
      setAddOpen(false);
      resetForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to add promotion');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(promo: Promotion) {
    setBusyId(promo.id);
    setToggleError(null);
    try {
      await togglePromotion(promo.id, !promo.is_active);
    } catch (err) {
      setToggleError(
        err instanceof Error ? err.message : `Couldn't update "${promo.title}" — try again.`
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setBusyId(confirmDelete.id);
    try {
      await deletePromotion(confirmDelete.id);
      setConfirmDelete(null);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <DashboardLayout>
      <div className="animate-fade-in-up space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-ink-900">Promotions</h1>
            <p className="mt-1 text-sm text-ink-500">
              Active promotions appear as a banner on the customer QR ordering page.
            </p>
          </div>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-5 w-5" />
            Add Promotion
          </Button>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-error-50 border border-error-500/20 px-4 py-3">
            <AlertCircle className="h-5 w-5 text-error-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-error-700">{error}</p>
          </div>
        )}

        {toggleError && (
          <div className="flex items-start gap-2 rounded-lg bg-error-50 border border-error-500/20 px-4 py-3">
            <AlertCircle className="h-5 w-5 text-error-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-error-700">{toggleError}</p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
          </div>
        ) : promotions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center rounded-xl bg-surface shadow-sm ring-1 ring-ink-200/60">
            <Megaphone className="h-10 w-10 text-ink-300 mb-3" />
            <p className="text-sm font-medium text-ink-600">No promotions yet</p>
            <p className="text-xs text-ink-400 mt-1">
              Add one to show it on the customer ordering page.
            </p>
          </div>
        ) : (
          <div className="rounded-xl bg-surface shadow-sm ring-1 ring-ink-200/60 divide-y divide-ink-100">
            {promotions.map((promo) => {
              const mediaCount = promo.media?.length ?? (promo.url ? 1 : 0);
              return (
                <div
                  key={promo.id}
                  className="flex items-center justify-between gap-4 px-5 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-ink-900 truncate">{promo.title}</span>
                      <span
                        className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          promo.is_active
                            ? 'bg-success-50 text-success-700 ring-1 ring-success-500/20'
                            : 'bg-ink-100 text-ink-500'
                        }`}
                      >
                        {promo.is_active ? 'Active' : 'Inactive'}
                      </span>
                      {mediaCount > 1 && (
                        <span className="flex-shrink-0 rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-bold text-primary-600">
                          {mediaCount} items
                        </span>
                      )}
                    </div>
                    <a
                      href={promo.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-0.5 inline-flex items-center gap-1 text-xs text-ink-400 hover:text-primary-600 transition truncate"
                    >
                      <ExternalLink className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">{promo.url}</span>
                    </a>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleToggle(promo)}
                      disabled={busyId === promo.id}
                      role="switch"
                      aria-checked={promo.is_active}
                      aria-label={`Toggle ${promo.title}`}
                      className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors duration-200 ease-in-out disabled:opacity-60 ${
                        promo.is_active ? 'bg-primary-600' : 'bg-ink-300'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-200 ease-in-out ${
                          promo.is_active ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <button
                      onClick={() => setConfirmDelete(promo)}
                      disabled={busyId === promo.id}
                      className="text-ink-400 hover:text-error-600 transition disabled:opacity-60"
                      aria-label={`Delete ${promo.title}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add promotion modal */}
      <Modal
        open={addOpen}
        onClose={() => {
          setAddOpen(false);
          resetForm();
        }}
        title="Add Promotion"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setAddOpen(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {saving ? 'Adding…' : 'Add Promotion'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="flex items-start gap-2 rounded-lg bg-error-50 border border-error-500/20 px-3 py-2">
              <AlertCircle className="h-4 w-4 text-error-600 flex-shrink-0 mt-0.5" />
              <span className="text-xs text-error-700">{formError}</span>
            </div>
          )}
          <div>
            <label className="block text-sm font-semibold text-ink-700 mb-1.5">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Follow us for 10% off"
              className="w-full rounded-lg border border-ink-300 bg-surface px-3 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-ink-700 mb-1.5">
              Images &amp; Videos
            </label>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-dashed border-ink-300 bg-surface px-3 py-2.5 text-sm font-semibold text-ink-600 hover:border-primary-500 hover:text-primary-600 transition"
              >
                <Upload className="h-4 w-4" />
                Upload from PC
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={(e) => handleFilesSelected(e.target.files)}
              />
            </div>
            <p className="mt-1 text-xs text-ink-400">
              Select multiple images/videos at once, or add more below. Images up to 8MB, videos
              up to 60MB each.
            </p>

            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddUrl();
                  }
                }}
                placeholder="Or paste an image/video/YouTube URL"
                className="flex-1 rounded-lg border border-ink-300 bg-surface px-3 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition"
              />
              <Button type="button" variant="secondary" onClick={handleAddUrl}>
                <LinkIcon className="h-4 w-4" />
                Add
              </Button>
            </div>

            {mediaEntries.length > 0 && (
              <ul className="mt-3 space-y-2 max-h-56 overflow-y-auto pr-1">
                {mediaEntries.map((entry, index) => (
                  <li
                    key={entry.localId}
                    className="flex items-center gap-3 rounded-lg border border-ink-200 bg-surface px-3 py-2"
                  >
                    {entry.previewUrl ? (
                      <img
                        src={entry.previewUrl}
                        alt=""
                        className="h-10 w-10 flex-shrink-0 rounded-md object-cover"
                      />
                    ) : (
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-600">
                        {entry.kind === 'file' ? (
                          <Video className="h-5 w-5" />
                        ) : guessMediaTypeFromUrl(entry.url!) === 'video' ? (
                          <Video className="h-5 w-5" />
                        ) : (
                          <ImageIcon className="h-5 w-5" />
                        )}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-ink-500">#{index + 1}</p>
                      <p className="truncate text-sm text-ink-800">
                        {entry.kind === 'file' ? entry.file!.name : entry.url}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeEntry(entry.localId)}
                      className="flex-shrink-0 text-ink-400 hover:text-error-600 transition"
                      aria-label="Remove"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Modal>

      {/* Delete confirmation */}
      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Delete Promotion"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={busyId === confirmDelete?.id}>
              {busyId === confirmDelete?.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-600">
          Delete <span className="font-semibold text-ink-900">{confirmDelete?.title}</span>? This
          removes it — and all its images/videos — from the customer ordering page immediately.
        </p>
      </Modal>
    </DashboardLayout>
  );
}
