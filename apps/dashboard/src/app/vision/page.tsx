'use client';

import { Suspense } from 'react';
import { useState, useRef, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { ScanEye, Upload, FileText, User, DollarSign, Hash, Loader2, CheckCircle, XCircle, AlertCircle, ExternalLink, Clock, Image as ImageIcon, Eye } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

interface ExtractedQuotation {
  quotation_number?: string;
  client_name?: string;
  sales_agent?: string;
  total_amount?: number;
}

interface VisionResult {
  ok: boolean;
  type: 'quotation' | 'payment' | 'unknown';
  quotation?: ExtractedQuotation;
  raw_text: string;
  confidence: 'high' | 'medium' | 'low';
  error?: string;
}

interface CreatedOrder {
  id: string;
  quotation_number: string | null;
  client_name: string | null;
  total_amount: number | null;
}

interface ShareData {
  image_base64: string;
  mime_type: string;
  file_name: string;
  extracted: Record<string, unknown>;
  type: 'quotation' | 'payment' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  raw_text: string;
}

interface UploadSummary {
  token: string;
  file_name: string;
  type: 'quotation' | 'payment' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  created_at: number;
}

type Step = 'idle' | 'extracting' | 'review' | 'creating' | 'done' | 'error';

function VisionPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('idle');
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [result, setResult] = useState<VisionResult | null>(null);
  const [error, setError] = useState<string>('');
  const [createdOrder, setCreatedOrder] = useState<CreatedOrder | null>(null);
  const [loadingShare, setLoadingShare] = useState(false);
  const [recentUploads, setRecentUploads] = useState<UploadSummary[]>([]);
  const [loadingUploads, setLoadingUploads] = useState(false);

  // Editable fields after extraction
  const [quotationNumber, setQuotationNumber] = useState('');
  const [clientName, setClientName] = useState('');
  const [salesAgent, setSalesAgent] = useState('');
  const [totalAmount, setTotalAmount] = useState('');

  // Load shared data from Telegram bot via ?token=xxx
  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) return;

    queueMicrotask(() => {
      setLoadingShare(true);
      fetch(`${API_BASE}/vision/share/${token}`)
        .then((res) => {
          if (!res.ok) throw new Error('Share link expired or invalid');
          return res.json();
        })
        .then((data: { ok: boolean } & ShareData) => {
          if (!data.ok) throw new Error('Share data not found');

          // Set preview from base64
          const dataUrl = `data:${data.mime_type};base64,${data.image_base64}`;
          setPreview(dataUrl);
          setFileName(data.file_name);

          // Set extracted fields
          const ext = data.extracted as ExtractedQuotation;
          if (data.type === 'quotation' && ext) {
            setQuotationNumber(ext.quotation_number ?? '');
            setClientName(ext.client_name ?? '');
            setSalesAgent(ext.sales_agent ?? '');
            setTotalAmount(ext.total_amount ? String(ext.total_amount) : '');
          }

          setResult({
            ok: true,
            type: data.type,
            quotation: data.type === 'quotation' ? ext : undefined,
            raw_text: data.raw_text,
            confidence: data.confidence,
          });

          setStep('review');
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'Share link failed');
          setStep('error');
        })
        .finally(() => setLoadingShare(false));
    });
  }, [searchParams]);

  // Load recent uploads when no token is present
  useEffect(() => {
    const token = searchParams.get('token');
    if (token) return; // Don't load list when viewing a specific share

    setLoadingUploads(true);
    fetch(`${API_BASE}/vision/uploads`)
      .then((res) => res.json())
      .then((data: { ok: boolean; uploads: UploadSummary[] }) => {
        if (data.ok) {
          setRecentUploads(data.uploads);
        }
      })
      .catch(() => {
        // Silently fail — the upload area is still usable
      })
      .finally(() => setLoadingUploads(false));
  }, [searchParams]);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setError('');
    setResult(null);
    setCreatedOrder(null);
    setStep('idle');

    // Show preview
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPreview(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  }

  async function handleExtract() {
    if (!preview) return;

    setStep('extracting');
    setError('');

    try {
      // Extract base64 from data URL
      const base64 = preview.split(',')[1];
      const mimeType = preview.split(';')[0].split(':')[1];

      const res = await fetch(`${API_BASE}/vision/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: base64,
          mime_type: mimeType,
          mode: 'auto',
        }),
      });

      const data: VisionResult = await res.json();

      if (!data.ok) {
        throw new Error(data.error || 'Extraction failed');
      }

      setResult(data);

      if (data.type === 'quotation' && data.quotation) {
        setQuotationNumber(data.quotation.quotation_number ?? '');
        setClientName(data.quotation.client_name ?? '');
        setSalesAgent(data.quotation.sales_agent ?? '');
        setTotalAmount(data.quotation.total_amount ? String(data.quotation.total_amount) : '');
        setStep('review');
      } else if (data.type === 'payment') {
        setStep('done');
      } else {
        setStep('review');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Extraction failed');
      setStep('error');
    }
  }

  async function handleCreateOrder() {
    if (!quotationNumber && !clientName) {
      setError('At least a quotation number or client name is required.');
      return;
    }

    setStep('creating');
    setError('');

    try {
      const res = await fetch(`${API_BASE}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quotation_number: quotationNumber || null,
          client_name: clientName || null,
          sales_agent: salesAgent || null,
          total_amount: totalAmount ? Number(totalAmount) : null,
        }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: 'Order creation failed' }))) as { error?: string };
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const order = (await res.json()) as CreatedOrder;
      setCreatedOrder(order);

      // Also upload the image to Drive linked to this order
      if (preview) {
        const base64 = preview.split(',')[1];
        const mimeType = preview.split(';')[0].split(':')[1];

        await fetch(`${API_BASE}/drive/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file_type: mimeType,
            original_filename: fileName,
            mime_type: mimeType,
            file_data: base64,
            quotation_number: order.quotation_number,
          }),
        });
      }

      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Order creation failed');
      setStep('error');
    }
  }

  function handleReset() {
    setStep('idle');
    setPreview(null);
    setFileName('');
    setResult(null);
    setError('');
    setCreatedOrder(null);
    setQuotationNumber('');
    setClientName('');
    setSalesAgent('');
    setTotalAmount('');
    // Clear token from URL without reload
    const url = new URL(window.location.href);
    url.searchParams.delete('token');
    window.history.replaceState({}, '', url.toString());
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleViewUpload(token: string) {
    router.push(`/vision?token=${token}`);
  }

  function getConfidenceColor(confidence: string) {
    switch (confidence) {
      case 'high': return 'text-green-600 bg-green-50 border-green-200';
      case 'medium': return 'text-amber-600 bg-amber-50 border-amber-200';
      case 'low': return 'text-red-600 bg-red-50 border-red-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  }

  function formatTime(ts: number) {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 48) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  const hasToken = !!searchParams.get('token');

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 text-white">
          <ScanEye className="h-5 w-5" /></div>
        <div>
          <h1 className="text-lg font-semibold text-gray-900">AI Vision Upload</h1>
          <p className="text-xs text-gray-500">
            {hasToken
              ? 'Review data extracted from Telegram — edit and create the order'
              : 'Upload a screenshot — AI extracts the details and creates the order'}
          </p>
        </div>
      </div>

      {/* Loading shared data */}
      {loadingShare && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-gray-200 bg-white py-12">
          <Loader2 className="mb-3 h-8 w-8 animate-spin text-[#2490ef]" />
          <p className="text-sm font-medium text-gray-700">Loading extracted data from Telegram...</p>
        </div>
      )}

      {/* Recent Uploads List (shown when no token) */}
      {!hasToken && !loadingShare && (
        <>
          {/* Upload Area */}
          {step === 'idle' && (
            <div className="space-y-4">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-white px-6 py-16 transition-colors hover:border-[#2490ef] hover:bg-blue-50/50"
              >
                <Upload className="mb-4 h-10 w-10 text-gray-400" />
                <p className="text-sm font-medium text-gray-700">Click to upload a screenshot</p>
                <p className="mt-1 text-xs text-gray-400">PNG, JPG, WEBP — quotation screenshots, order confirmations</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>
              {preview && (
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={preview} alt="Uploaded preview" className="max-h-80 w-full rounded-lg bg-gray-50 object-contain" />
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="truncate text-xs text-gray-500">{fileName}</span>
                    <button
                      type="button"
                      onClick={handleExtract}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#2490ef] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a7ad9]"
                    >
                      <ScanEye className="h-4 w-4" />
                      Analyze image
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Recent Uploads Section */}
          {loadingUploads ? (
            <div className="flex items-center justify-center rounded-xl border border-gray-200 bg-white py-8">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : recentUploads.length > 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white">
              <div className="border-b border-gray-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-gray-800">Recent Uploads from Telegram</h2>
                <p className="text-xs text-gray-400">Data persists for 48 hours — click to review and create orders</p>
              </div>
              <div className="divide-y divide-gray-100">
                {recentUploads.map((upload) => (
                  <button
                    key={upload.token}
                    onClick={() => handleViewUpload(upload.token)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-50">
                      <ImageIcon className="h-4 w-4 text-purple-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-800">{upload.file_name}</p>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-400">
                        <Clock className="h-3 w-3" />
                        <span>{formatTime(upload.created_at)}</span>
                        <span className="text-gray-300">·</span>
                        <span className="capitalize">{upload.type}</span>
                        <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                          upload.confidence === 'high' ? 'bg-green-50 text-green-600' :
                          upload.confidence === 'medium' ? 'bg-amber-50 text-amber-600' :
                          'bg-red-50 text-red-600'
                        }`}>
                          {upload.confidence}
                        </span>
                      </div>
                    </div>
                    <Eye className="h-4 w-4 shrink-0 text-gray-300" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}

      {/* Preview */}
      {preview && step !== 'idle' && !loadingShare && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Uploaded preview" className="max-h-80 w-full bg-gray-50 object-contain" />
            <button
              onClick={handleReset}
              className="absolute right-2 top-2 rounded-lg bg-white/90 px-2 py-1 text-xs font-medium text-gray-600 shadow-sm hover:bg-white"
            >
              Change
            </button>
          </div>
          <div className="border-t border-gray-200 px-4 py-2 text-xs text-gray-500">{fileName}</div>
        </div>
      )}

      {/* Extracting Spinner */}
      {step === 'extracting' && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-gray-200 bg-white py-12">
          <Loader2 className="mb-3 h-8 w-8 animate-spin text-[#2490ef]" />
          <p className="text-sm font-medium text-gray-700">AI is analyzing the image...</p>
          <p className="mt-1 text-xs text-gray-400">Extracting quotation details with Gemini Vision</p>
        </div>
      )}

      {/* Review Extracted Data */}
      {step === 'review' && result && (
        <div className="space-y-4">
          {/* Confidence Badge */}
          <div className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${getConfidenceColor(result.confidence)}`}>
            {result.confidence === 'high' ? <CheckCircle className="h-3.5 w-3.5" /> :
             result.confidence === 'medium' ? <AlertCircle className="h-3.5 w-3.5" /> :
             <XCircle className="h-3.5 w-3.5" />}
            Confidence: {result.confidence}
          </div>

          {/* Editable Fields */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="mb-4 text-sm font-semibold text-gray-800">Extracted Information</h3>
            <div className="space-y-4">
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1">
                  <Hash className="h-3.5 w-3.5" /> Quotation Number
                </label>
                <input
                  type="text"
                  value={quotationNumber}
                  onChange={(e) => setQuotationNumber(e.target.value)}
                  placeholder="e.g. QTN-2026-0001"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef]"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1">
                  <User className="h-3.5 w-3.5" /> Client Name
                </label>
                <input
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="e.g. Juan Dela Cruz"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef]"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1">
                  <FileText className="h-3.5 w-3.5" /> Sales Agent
                </label>
                <input
                  type="text"
                  value={salesAgent}
                  onChange={(e) => setSalesAgent(e.target.value)}
                  placeholder="e.g. Maria Santos"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef]"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1">
                  <DollarSign className="h-3.5 w-3.5" /> Total Amount (PHP)
                </label>
                <input
                  type="number"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                  placeholder="e.g. 15000"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef]"
                />
              </div>
            </div>
          </div>

          {/* Raw text */}
          {result.raw_text && result.confidence === 'low' && (
            <details className="rounded-xl border border-gray-200 bg-white">
              <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-gray-500">Raw AI output</summary>
              <pre className="max-h-40 overflow-auto border-t border-gray-200 px-4 py-3 text-xs text-gray-600 whitespace-pre-wrap">{result.raw_text}</pre>
            </details>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleCreateOrder}
              disabled={!quotationNumber && !clientName}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#2490ef] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#1a7ad9] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle className="h-4 w-4" />
              Create Order
            </button>
            <button
              onClick={handleReset}
              className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Creating Spinner */}
      {step === 'creating' && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-gray-200 bg-white py-12">
          <Loader2 className="mb-3 h-8 w-8 animate-spin text-[#2490ef]" />
          <p className="text-sm font-medium text-gray-700">Creating order and uploading to Drive...</p>
        </div>
      )}

      {/* Success */}
      {step === 'done' && createdOrder && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
            <CheckCircle className="h-6 w-6 text-green-600" />
          </div>
          <h3 className="text-base font-semibold text-green-800">Order Created Successfully!</h3>
          <div className="mt-3 space-y-1 text-sm text-green-700">
            <p><span className="font-medium">Quotation:</span> {createdOrder.quotation_number || '—'}</p>
            <p><span className="font-medium">Client:</span> {createdOrder.client_name || '—'}</p>
            <p><span className="font-medium">Amount:</span> {createdOrder.total_amount ? `₱${Number(createdOrder.total_amount).toLocaleString()}` : '—'}</p>
          </div>
          <div className="mt-4 flex justify-center gap-3">
            <a
              href={`/orders/${createdOrder.quotation_number ?? createdOrder.id}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700"
            >
              <ExternalLink className="h-4 w-4" />
              View Order
            </a>
            <button
              onClick={handleReset}
              className="rounded-lg border border-green-300 bg-white px-4 py-2 text-sm font-medium text-green-700 transition-colors hover:bg-green-100"
            >
              Upload Another
            </button>
          </div>
        </div>
      )}

      {/* Payment extracted (no order creation) */}
      {step === 'done' && result?.type === 'payment' && !createdOrder && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
          <AlertCircle className="mx-auto mb-3 h-8 w-8 text-amber-500" />
          <h3 className="text-sm font-semibold text-amber-800">Payment Info Extracted</h3>
          <p className="mt-1 text-xs text-amber-700">
            This appears to be a payment receipt. To record the payment, go to the order detail page.
          </p>
          <button onClick={handleReset} className="mt-4 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-700">
            Upload Another
          </button>
        </div>
      )}

      {/* Error */}
      {step === 'error' && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <XCircle className="mx-auto mb-3 h-8 w-8 text-red-500" />
          <h3 className="text-sm font-semibold text-red-800">Extraction Failed</h3>
          <p className="mt-1 text-xs text-red-600">{error}</p>
          <button onClick={handleReset} className="mt-4 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700">
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}

export default function VisionPage() {
  return (
    <Suspense fallback={
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 text-white">
            <ScanEye className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">AI Vision Upload</h1>
            <p className="text-xs text-gray-500">Loading...</p>
          </div>
        </div>
      </div>
    }>
      <VisionPageContent />
    </Suspense>
  );
}
