'use client';

/* eslint-disable react-hooks/set-state-in-effect, react-hooks/purity */
import { Suspense } from 'react';
import { useState, useRef, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { ScanEye, Upload, FileText, User, DollarSign, Hash, Loader2, CheckCircle, XCircle, AlertCircle, ExternalLink, Clock, Image as ImageIcon, Eye } from 'lucide-react';
import OtpModal from '@/components/OtpModal';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

interface ExtractedQuotation {
  quotation_number?: string;
  client_name?: string;
  sales_agent?: string;
  total_amount?: number;
  order_date?: string;
  items?: { product_name?: string; quantity?: number }[];
}

interface VisionResult {
  ok: boolean;
  type: 'quotation' | 'payment' | 'inventory' | 'unknown';
  quotation?: ExtractedQuotation;
  payment?: {
    amount?: number;
    type?: 'deposit' | 'balance' | 'unknown';
    reference_number?: string;
    paid_by?: string;
    payment_date?: string;
  };
  inventory?: { product_name?: string; quantity?: number }[];
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
  type: 'quotation' | 'payment' | 'inventory' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  raw_text: string;
}

function normalizeExtractedItems(rawItems: unknown): { product_name: string; quantity: number }[] {
  if (!Array.isArray(rawItems)) return [];
  return rawItems
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const productName =
        typeof record.product_name === 'string' ? record.product_name :
        typeof record.name === 'string' ? record.name :
        typeof record.item === 'string' ? record.item :
        typeof record.description === 'string' ? record.description :
        '';
      const quantityValue = record.quantity ?? record.qty;
      const quantity =
        typeof quantityValue === 'number' ? quantityValue :
        typeof quantityValue === 'string' ? Number.parseInt(quantityValue, 10) :
        1;
      return {
        product_name: productName.trim(),
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      };
    })
    .filter((item): item is { product_name: string; quantity: number } => Boolean(item?.product_name));
}

function getStringField(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === 'string' ? record[key] : '';
}

function getNumberStringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string') return value;
  return '';
}

function normalizePaymentType(value: unknown): 'deposit' | 'balance' | 'unknown' {
  return value === 'deposit' || value === 'balance' ? value : 'unknown';
}

interface UploadSummary {
  token: string;
  file_name: string;
  type: 'quotation' | 'payment' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  created_at: number;
}

type Step = 'idle' | 'extracting' | 'review' | 'creating' | 'done' | 'error';
type OtpAction = 'createOrder' | 'recordPayment';

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
  const [showOtp, setShowOtp] = useState(false);
  const [otpAction, setOtpAction] = useState<OtpAction>('createOrder');

  // Editable fields after extraction
  const [quotationNumber, setQuotationNumber] = useState('');
  const [clientName, setClientName] = useState('');
  const [salesAgent, setSalesAgent] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [orderDate, setOrderDate] = useState('');
  const [items, setItems] = useState<{ product_name: string; quantity: number }[]>([]);
  const [paymentQuotationNumber, setPaymentQuotationNumber] = useState('');
  const [paymentType, setPaymentType] = useState<'deposit' | 'balance' | 'unknown'>('unknown');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentPaidBy, setPaymentPaidBy] = useState('');

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

          // Set extracted fields — handle all types (quotation, payment, inventory, unknown)
          const ext = data.extracted as Record<string, unknown>;
          if (ext) {
            setQuotationNumber(typeof ext.quotation_number === 'string' ? ext.quotation_number : '');
            setClientName(typeof ext.client_name === 'string' ? ext.client_name : '');
            setSalesAgent(typeof ext.sales_agent === 'string' ? ext.sales_agent : '');
            setTotalAmount(typeof ext.total_amount === 'number' ? String(ext.total_amount) : '');
            setOrderDate(typeof ext.order_date === 'string' ? ext.order_date : '');
            setPaymentQuotationNumber(getStringField(ext, 'quotation_number'));
            setPaymentType(normalizePaymentType(ext.type));
            setPaymentAmount(getNumberStringField(ext, 'amount'));
            setPaymentDate(getStringField(ext, 'payment_date'));
            setPaymentReference(getStringField(ext, 'reference_number'));
            setPaymentPaidBy(getStringField(ext, 'paid_by'));
            // Items may be in ext.items (from inventory type) or ext.items (from quotation type)
            const rawItems = ext.items;
            setItems(normalizeExtractedItems(rawItems));
          }

          setResult({
            ok: true,
            type: data.type,
            quotation: data.type === 'quotation' ? (ext as ExtractedQuotation) : undefined,
            payment: data.type === 'payment' ? {
              amount: typeof ext.amount === 'number' ? ext.amount : undefined,
              type: normalizePaymentType(ext.type),
              reference_number: getStringField(ext, 'reference_number') || undefined,
              paid_by: getStringField(ext, 'paid_by') || undefined,
              payment_date: getStringField(ext, 'payment_date') || undefined,
            } : undefined,
            inventory: data.type === 'inventory' ? normalizeExtractedItems(ext.items) : undefined,
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

  // Load file from order file viewer for AI extraction fallback via ?file_id=&order_id=&file_type=
  useEffect(() => {
    const fileId = searchParams.get('file_id');
    const orderId = searchParams.get('order_id');
    const fileType = searchParams.get('file_type');
    if (!fileId || !orderId) return;

    setStep('extracting');
    setError('');

    const downloadUrl = `${API_BASE}/orders/${encodeURIComponent(orderId)}/files/${encodeURIComponent(fileId)}/download`;

    fetch(downloadUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to download file (HTTP ${res.status})`);
        const contentType = res.headers.get('content-type') ?? 'image/jpeg';
        return res.arrayBuffer().then((buf) => ({ buf, contentType }));
      })
      .then(({ buf, contentType }) => {
        const base64 = btoa(
          new Uint8Array(buf).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );
        const dataUrl = `data:${contentType};base64,${base64}`;
        setPreview(dataUrl);
        setFileName(`file_${fileId.slice(0, 8)}.${contentType.includes('pdf') ? 'pdf' : 'jpg'}`);

        // Determine extraction mode based on file_type
        const mode = fileType === 'deposit' || fileType === 'balance_proof' ? 'payment' : 'auto';

        return fetch(`${API_BASE}/vision/extract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_base64: base64, mime_type: contentType, mode }),
        });
      })
      .then((res) => res.json())
      .then((data: VisionResult) => {
        if (!data.ok) throw new Error(data.error || 'Extraction failed');
        setResult(data);

        if (data.type === 'quotation' && data.quotation) {
          setQuotationNumber(data.quotation.quotation_number ?? '');
          setClientName(data.quotation.client_name ?? '');
          setSalesAgent(data.quotation.sales_agent ?? '');
          setTotalAmount(data.quotation.total_amount ? String(data.quotation.total_amount) : '');
          setOrderDate(data.quotation.order_date ?? '');
          setItems(normalizeExtractedItems(data.quotation.items));
        } else if (data.type === 'payment') {
          setPaymentQuotationNumber(data.quotation?.quotation_number ?? '');
          setPaymentType(data.payment?.type ?? 'unknown');
          setPaymentAmount(data.payment?.amount ? String(data.payment.amount) : '');
          setPaymentDate(data.payment?.payment_date ?? '');
          setPaymentReference(data.payment?.reference_number ?? '');
          setPaymentPaidBy(data.payment?.paid_by ?? '');
        } else if (data.type === 'inventory') {
          setItems(normalizeExtractedItems(data.inventory));
        }

        setStep('review');
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to extract file');
        setStep('error');
      });
  }, [searchParams]);

  // Load recent uploads when no token or file_id is present
  useEffect(() => {
    const token = searchParams.get('token');
    const fileId = searchParams.get('file_id');
    if (token || fileId) return; // Don't load list when viewing a specific share or file extraction

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
        setOrderDate(data.quotation.order_date ?? '');
        setItems(normalizeExtractedItems(data.quotation.items));
        setStep('review');
      } else if (data.type === 'payment') {
        setPaymentQuotationNumber(data.quotation?.quotation_number ?? '');
        setPaymentType(data.payment?.type ?? 'unknown');
        setPaymentAmount(data.payment?.amount ? String(data.payment.amount) : '');
        setPaymentDate(data.payment?.payment_date ?? '');
        setPaymentReference(data.payment?.reference_number ?? '');
        setPaymentPaidBy(data.payment?.paid_by ?? '');
        setStep('review');
      } else if (data.type === 'inventory') {
        setItems(normalizeExtractedItems(data.inventory));
        setStep('review');
      } else {
        setStep('review');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Extraction failed');
      setStep('error');
    }
  }

  function handleCreateOrder() {
    if (!quotationNumber && !clientName) {
      setError('At least a quotation number or client name is required.');
      return;
    }
    setOtpAction('createOrder');
    setShowOtp(true);
  }

  function handleRecordPayment() {
    if (!paymentQuotationNumber.trim()) {
      setError('Quotation number is required to record this payment.');
      return;
    }
    if (!paymentAmount || Number(paymentAmount) <= 0) {
      setError('Payment amount is required.');
      return;
    }
    if (paymentType !== 'deposit' && paymentType !== 'balance') {
      setError('Choose whether this is a downpayment or balance payment.');
      return;
    }
    setOtpAction('recordPayment');
    setShowOtp(true);
  }

  async function executeRecordPayment(actionToken: string) {
    setStep('creating');
    setError('');
    setShowOtp(false);

    try {
      const endpoint = paymentType === 'deposit' ? '/deposits' : '/pay-balance';
      const body = paymentType === 'deposit'
        ? {
            quotation_number: paymentQuotationNumber.trim(),
            amount: Number(paymentAmount),
            deposit_paid_at: paymentDate || undefined,
            updated_by: 'dashboard_quick_action',
            action_token: actionToken,
          }
        : {
            quotation_number: paymentQuotationNumber.trim(),
            amount: Number(paymentAmount),
            payment_date: paymentDate || undefined,
            updated_by: 'dashboard_quick_action',
            action_token: actionToken,
          };

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: 'Payment recording failed' }))) as { error?: string };
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      if (preview) {
        const base64 = preview.split(',')[1];
        const mimeType = preview.split(';')[0].split(':')[1];
        await fetch(`${API_BASE}/files/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            quotation_number: paymentQuotationNumber.trim(),
            file_type: paymentType === 'deposit' ? 'deposit' : 'balance_proof',
            original_filename: fileName,
            mime_type: mimeType,
            file_data: base64,
          }),
        }).catch(() => {
          // Non-fatal: payment was recorded; user can re-upload proof from the order modal.
        });
      }

      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment recording failed');
      setStep('error');
    }
  }

  function handleOtpVerified(actionToken: string) {
    if (otpAction === 'recordPayment') {
      executeRecordPayment(actionToken);
      return;
    }
    executeCreateOrder(actionToken);
  }

  async function executeCreateOrder(actionToken: string) {
    setStep('creating');
    setError('');
    setShowOtp(false);

    try {
      const res = await fetch(`${API_BASE}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quotation_number: quotationNumber || null,
          client_name: clientName || null,
          sales_agent: salesAgent || null,
          total_amount: totalAmount ? Number(totalAmount) : null,
          order_confirmed_at: orderDate || null,
          items: items.length > 0 ? items.map((item) => ({
            name: item.product_name,
            quantity: item.quantity,
          })) : undefined,
          action_token: actionToken,
        }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: 'Order creation failed' }))) as { error?: string };
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const order = (await res.json()) as CreatedOrder;
      setCreatedOrder(order);

      // Also attach the original Telegram/dashboard upload to the order so it
      // appears in the order file viewer modal. The old /drive/upload route no
      // longer exists; /files/upload stores the binary and DB file record.
      if (preview) {
        const base64 = preview.split(',')[1];
        const mimeType = preview.split(';')[0].split(':')[1];

        const uploadRes = await fetch(`${API_BASE}/files/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order_id: order.id,
            file_type: 'quotation',
            original_filename: fileName,
            mime_type: mimeType,
            file_data: base64,
            quotation_number: order.quotation_number,
          }),
        });
        if (!uploadRes.ok) {
          const err = (await uploadRes.json().catch(() => ({ error: 'File upload failed' }))) as { error?: string };
          throw new Error(err.error || `Order created, but file attach failed (HTTP ${uploadRes.status})`);
        }
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
    setOrderDate('');
    setItems([]);
    setPaymentQuotationNumber('');
    setPaymentType('unknown');
    setPaymentAmount('');
    setPaymentDate('');
    setPaymentReference('');
    setPaymentPaidBy('');
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
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1">
                  <Clock className="h-3.5 w-3.5" /> Order Date
                </label>
                <input
                  type="date"
                  value={orderDate}
                  onChange={(e) => setOrderDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef]"
                />
              </div>
            </div>
          </div>

          {result.type === 'payment' && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
              <h3 className="mb-2 text-sm font-semibold text-amber-900">Editable Payment Extraction</h3>
              <p className="mb-4 text-xs text-amber-700">
                Please verify every AI-read value before recording. Blurry slips can produce wrong dates or amounts.
              </p>
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Quotation / Order Number</label>
                  <input
                    type="text"
                    value={paymentQuotationNumber}
                    onChange={(e) => setPaymentQuotationNumber(e.target.value)}
                    placeholder="e.g. qtn-julia"
                    className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef]"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Payment Type</label>
                    <select
                      value={paymentType}
                      onChange={(e) => setPaymentType(e.target.value as 'deposit' | 'balance' | 'unknown')}
                      className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef]"
                    >
                      <option value="unknown">Choose type...</option>
                      <option value="deposit">Downpayment / Deposit</option>
                      <option value="balance">Balance Payment</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Amount (PHP)</label>
                    <input
                      type="number"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      placeholder="e.g. 170000"
                      className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef]"
                    />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Payment Date</label>
                    <input
                      type="date"
                      value={paymentDate}
                      onChange={(e) => setPaymentDate(e.target.value)}
                      className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Reference Number</label>
                    <input
                      type="text"
                      value={paymentReference}
                      onChange={(e) => setPaymentReference(e.target.value)}
                      placeholder="Optional"
                      className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef]"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Paid By</label>
                  <input
                    type="text"
                    value={paymentPaidBy}
                    onChange={(e) => setPaymentPaidBy(e.target.value)}
                    placeholder="Optional"
                    className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Extracted Items */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="mb-3 text-sm font-semibold text-gray-800">
              Items / Products ({items.length})
            </h3>
            {items.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No items were extracted from the quotation.</p>
            ) : (
              <div className="space-y-2">
                {items.map((item, index) => (
                  <div key={index} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 p-2">
                    <input
                      type="text"
                      value={item.product_name}
                      onChange={(e) => {
                        const updated = [...items];
                        updated[index] = { ...updated[index], product_name: e.target.value };
                        setItems(updated);
                      }}
                      placeholder="Product name"
                      className="min-w-0 flex-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-sm outline-none focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef]"
                    />
                    <input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) => {
                        const updated = [...items];
                        updated[index] = { ...updated[index], quantity: Math.max(1, parseInt(e.target.value) || 1) };
                        setItems(updated);
                      }}
                      className="w-16 rounded-md border border-gray-200 px-2 py-1.5 text-center text-sm outline-none focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setItems(items.filter((_, i) => i !== index));
                      }}
                      className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                      title="Remove item"
                    >
                      <XCircle className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setItems([...items, { product_name: '', quantity: 1 }])}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:border-[#2490ef] hover:text-[#2490ef]"
            >
              + Add item
            </button>
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
            {result.type === 'payment' ? (
              <button
                onClick={handleRecordPayment}
                disabled={!paymentQuotationNumber || !paymentAmount || paymentType === 'unknown'}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CheckCircle className="h-4 w-4" />
                Record Edited Payment
              </button>
            ) : (
              <button
                onClick={handleCreateOrder}
                disabled={!quotationNumber && !clientName}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#2490ef] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#1a7ad9] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CheckCircle className="h-4 w-4" />
                Create Order
              </button>
            )}
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
        <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
          <CheckCircle className="mx-auto mb-3 h-8 w-8 text-green-600" />
          <h3 className="text-sm font-semibold text-green-800">Payment Recorded</h3>
          <p className="mt-1 text-xs text-green-700">
            The edited {paymentType === 'deposit' ? 'downpayment' : 'balance payment'} values were recorded for {paymentQuotationNumber}.
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

      {/* OTP Modal */}
      <OtpModal
        open={showOtp}
        title={otpAction === 'recordPayment' ? 'Record Payment' : 'Create Order'}
        description={
          otpAction === 'recordPayment'
            ? `Confirm recording the edited payment for "${paymentQuotationNumber || 'this order'}". Enter the OTP sent to your email to confirm.`
            : `Confirm creating order "${quotationNumber || clientName || '?'}". Enter the OTP sent to your email to confirm.`
        }
        onVerified={handleOtpVerified}
        onClose={() => setShowOtp(false)}
      />
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
