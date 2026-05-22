'use client';

import { useState, useRef } from 'react';
import type { Order, OrderFile } from '@/lib/api';
import { getOrderFiles, getOrderFileDownloadUrl, uploadOrderFile } from '@/lib/api';
import { X, FileText, ExternalLink, Upload, Loader2 } from 'lucide-react';

// ── File Viewer Modal ──────────────────────────────────────────────────

export function FileViewerModal({
  order,
  files,
  onClose,
  onUploadComplete,
}: {
  order: Order;
  files: OrderFile[];
  onClose: () => void;
  onUploadComplete?: () => void;
}) {
  const imageFiles = files.filter((f) => {
    const mt = f.mime_type ?? '';
    return mt.startsWith('image/');
  });
  const pdfFiles = files.filter((f) => {
    const mt = f.mime_type ?? '';
    return mt === 'application/pdf';
  });

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const isImage = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf';
    if (!isImage && !isPdf) {
      setUploadError('Only image (JPEG/PNG) and PDF files are supported.');
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // Strip the data:...;base64, prefix
          const commaIndex = result.indexOf(',');
          resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });

      await uploadOrderFile({
        order_id: order.id,
        quotation_number: order.quotation_number ?? undefined,
        file_type: 'quotation',
        original_filename: file.name,
        mime_type: file.type,
        file_data: base64,
      });

      // Refresh files list
      if (onUploadComplete) onUploadComplete();
    } catch (err: any) {
      setUploadError(err.message ?? 'Upload failed');
    } finally {
      setUploading(false);
      // Reset input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              {order.quotation_number ?? 'Order Files'}
            </h3>
            <p className="text-xs text-gray-500">
              {order.client_name ?? 'Unknown client'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-auto p-6">
          {files.length === 0 && !uploading ? (
            <div className="py-8 text-center text-sm text-gray-400">
              <FileText className="mx-auto mb-2 h-8 w-8 text-gray-300" />
              <p className="mb-4">No files uploaded for this order yet.</p>
              <p className="mb-4 text-xs text-gray-400">
                Upload a quotation or order confirmation file (JPEG/PDF).
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-2 rounded-lg bg-[#2490ef] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a7ad9] disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                Upload File
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Upload button at top when files exist */}
              <div className="flex justify-end">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {uploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  {uploading ? 'Uploading…' : 'Upload File'}
                </button>
              </div>

              {uploadError && (
                <div className="rounded-lg bg-red-50 p-3 text-xs text-red-600">
                  {uploadError}
                </div>
              )}

              {imageFiles.length > 0 && (
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Images
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    {imageFiles.map((file) => (
                      <a
                        key={file.id}
                        href={getOrderFileDownloadUrl(order.id, file.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group relative overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
                      >
                        <img
                          src={getOrderFileDownloadUrl(order.id, file.id)}
                          alt={file.original_filename ?? 'Order file'}
                          className="h-40 w-full object-contain"
                          loading="lazy"
                        />
                        <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-2 py-1 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                          {file.original_filename ?? 'View image'}
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {pdfFiles.length > 0 && (
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Documents
                  </h4>
                  <div className="space-y-2">
                    {pdfFiles.map((file) => (
                      <a
                        key={file.id}
                        href={getOrderFileDownloadUrl(order.id, file.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 hover:bg-gray-100"
                      >
                        <FileText className="h-5 w-5 text-red-500" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-800">
                            {file.original_filename ?? 'PDF Document'}
                          </p>
                          <p className="text-xs text-gray-400">Click to open</p>
                        </div>
                        <ExternalLink className="h-4 w-4 text-gray-400" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Uploading state when no files yet */}
          {uploading && files.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-[#2490ef]" />
              <p className="text-sm text-gray-500">Uploading file…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Hook for file viewer state management ──────────────────────────────

export function useOrderFileViewer() {
  const [viewingFilesOrder, setViewingFilesOrder] = useState<Order | null>(null);
  const [orderFiles, setOrderFiles] = useState<OrderFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);

  async function handleViewFiles(order: Order) {
    setViewingFilesOrder(order);
    setLoadingFiles(true);
    try {
      const result = await getOrderFiles(order.id);
      setOrderFiles(result.files ?? []);
    } catch (err: any) {
      console.error('Failed to load order files:', err);
      setOrderFiles([]);
    } finally {
      setLoadingFiles(false);
    }
  }

  async function refreshFiles() {
    if (!viewingFilesOrder) return;
    try {
      const result = await getOrderFiles(viewingFilesOrder.id);
      setOrderFiles(result.files ?? []);
    } catch (err: any) {
      console.error('Failed to refresh order files:', err);
    }
  }

  function closeViewer() {
    setViewingFilesOrder(null);
    setOrderFiles([]);
  }

  return {
    viewingFilesOrder,
    orderFiles,
    loadingFiles,
    handleViewFiles,
    refreshFiles,
    closeViewer,
  };
}

// ── Clickable Quotation Number ─────────────────────────────────────────

export function QuotationNumberCell({
  order,
  onViewFiles,
}: {
  order: Order;
  onViewFiles?: (o: Order) => void;
}) {
  if (onViewFiles) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onViewFiles(order);
        }}
        className="font-medium text-[#2490ef] hover:underline"
        title="View order files"
      >
        {order.quotation_number ?? '—'}
      </button>
    );
  }
  return (
    <p className="font-medium text-gray-900">
      {order.quotation_number ?? '—'}
    </p>
  );
}
