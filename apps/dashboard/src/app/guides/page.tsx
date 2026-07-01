'use client';

import { useState } from 'react';
import {
  FileText,
  Zap,
  ShoppingCart,
  Factory,
  Package,
  PackageCheck,
  Truck,
  DollarSign,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Search,
  BookOpen,
  ExternalLink,
  ArrowRight,
  Users,
  ShieldAlert,
  MessageSquare,
  HelpCircle,
  Keyboard,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Step {
  title: string;
  description: string;
  details?: string[];
  warning?: string;
  tip?: string;
  links?: { label: string; href: string }[];
}

interface Section {
  id: string;
  icon: typeof FileText;
  color: string;
  title: string;
  summary: string;
  href: string;
  steps: Step[];
  diagram?: string;
}

// ─── SVG Workflow Diagrams ───────────────────────────────────────────────────

function OrderLifecycleDiagram() {
  return (
    <svg viewBox="0 0 920 120" className="w-full max-w-3xl" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="orderGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--primary)" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      {[
        { x: 20, label: 'Created', color: 'var(--primary)' },
        { x: 140, label: 'Purchasing', color: '#f97316' },
        { x: 270, label: 'Production', color: '#6366f1' },
        { x: 400, label: 'En Route', color: '#14b8a6' },
        { x: 520, label: 'Delivery', color: '#0ea5e9' },
        { x: 650, label: 'Collection', color: '#22c55e' },
        { x: 760, label: 'Done', color: '#6b7280' },
      ].map((stage, i) => (
        <g key={i}>
          <rect x={stage.x} y={40} width={90} height={36} rx={18} fill={stage.color} opacity={0.15} />
          <rect x={stage.x} y={40} width={90} height={36} rx={18} stroke={stage.color} strokeWidth={1.5} fill="none" />
          <text x={stage.x + 45} y={63} textAnchor="middle" fill={stage.color} fontSize={11} fontWeight={600}>
            {stage.label}
          </text>
          {i < 6 && (
            <g>
              <line x1={stage.x + 90} y1={58} x2={stage.x + 115} y2={58} stroke="#d1d5db" strokeWidth={1.5} />
              <polygon points={`${stage.x + 115},58 ${stage.x + 110},53 ${stage.x + 110},63`} fill="#d1d5db" />
            </g>
          )}
        </g>
      ))}
      <text x={400} y={25} textAnchor="middle" fill="#9ca3af" fontSize={10} fontWeight={500}>
        Order Lifecycle Flow
      </text>
    </svg>
  );
}

function ProductionWorkflowDiagram() {
  return (
    <svg viewBox="0 0 800 180" className="w-full max-w-3xl" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="prodGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#22c55e" />
        </linearGradient>
      </defs>
      {[
        { x: 10, y: 30, label: 'Pending', color: '#6366f1' },
        { x: 130, y: 30, label: 'In Progress', color: '#8b5cf6' },
        { x: 260, y: 30, label: 'Finished', color: '#a855f7' },
        { x: 390, y: 30, label: 'En Route', color: '#14b8a6' },
        { x: 520, y: 30, label: 'Verification', color: '#0ea5e9' },
        { x: 660, y: 30, label: 'Arrived', color: '#22c55e' },
      ].map((stage, i) => (
        <g key={i}>
          <rect x={stage.x} y={stage.y} width={100} height={32} rx={16} fill={stage.color} opacity={0.12} />
          <rect x={stage.x} y={stage.y} width={100} height={32} rx={16} stroke={stage.color} strokeWidth={1.5} fill="none" />
          <text x={stage.x + 50} y={50} textAnchor="middle" fill={stage.color} fontSize={10} fontWeight={600}>
            {stage.label}
          </text>
          {i < 5 && (
            <g>
              <line x1={stage.x + 100} y1={46} x2={stage.x + 118} y2={46} stroke="#d1d5db" strokeWidth={1} />
              <polygon points={`${stage.x + 118},46 ${stage.x + 114},42 ${stage.x + 114},50`} fill="#d1d5db" />
            </g>
          )}
        </g>
      ))}
      <text x={400} y={15} textAnchor="middle" fill="#9ca3af" fontSize={10} fontWeight={500}>
        Production Workflow
      </text>
      <text x={400} y={85} textAnchor="middle" fill="#9ca3af" fontSize={9}>
        ▼ Item-Level Actions Available at Each Stage ▼
      </text>
      {[
        { x: 30, label: '▶ Start Item', color: '#6366f1' },
        { x: 150, label: '✓ Finish Item', color: '#8b5cf6' },
        { x: 280, label: '⏱ Delayed', color: '#a855f7' },
        { x: 410, label: '🚚 Mark En Route', color: '#14b8a6' },
        { x: 540, label: '✅ Verify Item', color: '#0ea5e9' },
        { x: 680, label: '📦 Confirm Arrived', color: '#22c55e' },
      ].map((action, i) => (
        <g key={`action-${i}`}>
          <rect x={action.x} y={95} width={110} height={26} rx={6} fill={action.color} opacity={0.08} />
          <text x={action.x + 55} y={112} textAnchor="middle" fill={action.color} fontSize={9} fontWeight={500}>
            {action.label}
          </text>
        </g>
      ))}
      <text x={400} y={145} textAnchor="middle" fill="#9ca3af" fontSize={9}>
        ▲ Order-Level Bulk Actions: Bulk Start / Bulk Finish / Bulk En Route ▲
      </text>
    </svg>
  );
}

function PaymentWorkflowDiagram() {
  return (
    <svg viewBox="0 0 800 130" className="w-full max-w-3xl" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="payGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#22c55e" />
        </linearGradient>
      </defs>
      {[
        { x: 10, label: 'Balance Due', color: '#f97316' },
        { x: 150, label: 'Slip Upload', color: '#eab308' },
        { x: 290, label: 'AI Extract', color: '#6366f1' },
        { x: 420, label: 'Verify', color: '#0ea5e9' },
        { x: 540, label: 'Payment Received', color: '#22c55e' },
        { x: 670, label: 'Confirmed', color: '#16a34a' },
      ].map((stage, i) => (
        <g key={i}>
          <rect x={stage.x} y={50} width={110} height={36} rx={18} fill={stage.color} opacity={0.12} />
          <rect x={stage.x} y={50} width={110} height={36} rx={18} stroke={stage.color} strokeWidth={1.5} fill="none" />
          <text x={stage.x + 55} y={73} textAnchor="middle" fill={stage.color} fontSize={10} fontWeight={600}>
            {stage.label}
          </text>
          {i < 5 && (
            <g>
              <line x1={stage.x + 110} y1={68} x2={stage.x + 132} y2={68} stroke="#d1d5db" strokeWidth={1} />
              <polygon points={`${stage.x + 132},68 ${stage.x + 128},64 ${stage.x + 128},72`} fill="#d1d5db" />
            </g>
          )}
        </g>
      ))}
      <text x={400} y={35} textAnchor="middle" fill="#9ca3af" fontSize={10} fontWeight={500}>
        Payment & Collection Workflow
      </text>
    </svg>
  );
}

// ─── Data ────────────────────────────────────────────────────────────────────

const SECTIONS: Section[] = [
  {
    id: 'orders',
    icon: FileText,
    color: 'bg-emerald-50 text-emerald-600',
    title: '📋 All Orders',
    href: '/orders',
    summary:
      'The All Orders tab is the central hub for creating, viewing, and managing all quotations and orders. Every order flows through this page from creation to completion.',
    diagram: 'order-lifecycle',
    steps: [
      {
        title: 'Create a New Order',
        description:
          'Click the "New Order" button to open the order creation modal. Fill in the required fields:',
        details: [
          'Quotation Number — A unique identifier for the order (e.g., QTN-001)',
          'Client Name — Start typing to search existing clients via the autocomplete dropdown, or type a new name',
          'Sales Agent — The person responsible for this order',
          'Total Amount — The total quoted amount for the order',
          'Upload a Quotation File — Drag & drop or click to upload a PDF/image of the quotation. The system can AI-extract order items from the file',
          'Deposit Slip (optional) — Upload a deposit slip image to AI-extract the deposit amount, date, and reference number',
        ],
        tip: 'Use the AI Extract button after uploading a quotation file — it will automatically parse order items, quantities, and amounts from the document.',
        links: [{ label: 'Open All Orders →', href: '/orders' }],
      },
      {
        title: 'View & Filter Orders',
        description:
          'The main table shows all orders with columns for Quotation #, Client, Sales Agent, Amount, Stage, Status, and Timestamps.',

        details: [
          'Use the search bar to filter by quotation number or client name',
          'Click column headers to sort',
          'Select multiple orders using checkboxes for bulk actions (bulk delete)',
          'Click on any order row to expand and see more details',
        ],
      },
      {
        title: 'Edit an Order',
        description:
          'Click the edit icon on any order row. You can modify the client name, sales agent, total amount, and quotation number. Changes require OTP verification.',
      },
      {
        title: 'Delete an Order',
        description:
          'Click the delete icon. You will be prompted to confirm via OTP verification. Deletion is permanent.',
      },
      {
        title: 'View Order Details',
        description:
          'Click the quotation number link to open the full Order Detail page. Here you can:',
        details: [
          'View the complete lifecycle timeline (creation → production → delivery → payment)',
          'Track individual order items with their production and en-route status',
          'Upload and view files attached to the order',
          'Record deposits and balance payments with AI extract from deposit slips',
          'Manually advance stages (admin only)',
          'View payment history with verification status',
        ],
        links: [{ label: 'View Sample Order Detail →', href: '/orders' }],
      },
    ],
  },

  {
    id: 'actions',
    icon: Zap,
    color: 'bg-amber-50 text-amber-600',
    title: '⚡ Quick Actions',
    href: '/actions',
    summary:
      'The Quick Actions tab provides shortcut tools for common tasks without navigating to the full order pages. Use this for fast deposit recording, balance payments, and stage updates.',
    steps: [
      {
        title: 'Record a Deposit',
        description:
          'Enter the Quotation Number, upload a deposit slip image, and click "Extract" to AI-parse the amount, date, and reference. Review the extracted data and submit with OTP verification.',

        tip: 'The AI extract works best with clear deposit slip images. Make sure the amount, date, and reference number are visible.',
        links: [{ label: 'Open Quick Actions →', href: '/actions' }],
      },
      {
        title: 'Pay Balance',
        description:
          'Enter the Quotation Number and the balance amount. Optionally upload a balance payment slip for AI extraction. Submit with OTP verification.',
      },
      {
        title: 'Advance Stage',
        description:
          'Manually move an order to the next stage in its lifecycle. Select the target stage from the dropdown and confirm with OTP. This is useful for testing or correcting stage transitions.',
        warning: 'Manual stage advancement bypasses normal workflow checks. Use with caution.',
      },
    ],
  },

  {
    id: 'clients',
    icon: Users,
    color: 'bg-rose-50 text-rose-600',
    title: '👥 Clients',
    href: '/clients',
    summary:
      'The Clients tab manages your client database. Create, search, edit, and manage client profiles with linked orders, delivery details, and contact information.',
    steps: [
      {
        title: 'View & Search Clients',
        description:
          'The client list shows all registered clients with their contact details, order counts, and latest activity. Use the search bar to find clients by name.',

        details: [
          'Each client row shows: name, delivery address, contact number, authorized receiver, order count, and active order count',
          'Click "View Orders" to expand a client and see all their linked orders',
          'Linked orders are clickable — click a quotation number to go directly to the Order Detail page',
        ],
        links: [{ label: 'Open Clients →', href: '/clients' }],
      },
      {
        title: 'Add a New Client',
        description:
          'Click "Add Client" to open the creation form. Fill in the client name, delivery address, contact number, and authorized receiver details. Clients are also auto-created when new orders reference a client name that doesn\'t exist yet.',
      },
      {
        title: 'Edit a Client',
        description:
          'Click the edit icon on any client row. You can update delivery details, contact information, and notes. When "Propagate to Orders" is checked, the delivery address and contact info are pushed to all linked orders.',
      },
      {
        title: 'Delete Clients',
        description:
          'Select clients using checkboxes and click "Delete Selected" for bulk deletion. You can force-delete clients that have linked orders (this unlinks rather than deletes the orders). Requires OTP verification.',
      },
    ],
  },

  {
    id: 'purchasing',
    icon: ShoppingCart,
    color: 'bg-orange-50 text-orange-600',
    title: '🛒 Purchasing',
    href: '/purchasing',
    summary:
      'The Purchasing tab manages orders in the purchasing stage. Track what needs to be purchased, verify deposits, and move orders into production.',
    steps: [
      {
        title: 'Understanding the Sections',
        description:
          'The Purchasing page is organized into workflow sections that orders move through. Before purchasing begins, deposit stages must be completed:',

        details: [
          'Deposit for Verification — Orders where a downpayment was recorded and needs confirmation before purchasing can start (deposit stages come before purchasing in the workflow)',
          'Purchasing Pending — Orders waiting for purchasing to begin (deposit is verified). Each order shows its items with action buttons',
          'Purchasing In Progress — Orders currently being purchased. Items can be marked as in_progress or finished',
        ],
        links: [{ label: 'Open Purchasing →', href: '/purchasing' }],
      },
      {
        title: 'Start Purchasing Workflow',
        description:
          'Click the "Start" button on an order in Purchasing Pending to begin the purchasing process. This moves the order to Purchasing In Progress.',
      },
      {
        title: 'Mark Items as Purchased',
        description:
          'For each item in an order, you can toggle its status between pending, in_progress, and finished. When all items are marked finished, the order is ready to move to production.',
      },
      {
        title: 'Verify Deposits',
        description:
          'Orders in "Deposit for Verification" need the deposit to be confirmed. Click "Verify Deposit" to confirm the payment and advance the order.',
      },
      {
        title: 'Filter by Client',
        description:
          'Use the client filter input at the top of the page to narrow down orders by client name. Start typing and select from the autocomplete dropdown.',
      },
    ],
  },

  {
    id: 'production',
    icon: Factory,
    color: 'bg-indigo-50 text-indigo-600',
    title: '🏭 Production',
    href: '/production',
    summary:
      'The Production tab is the most feature-rich section. It manages the entire production lifecycle — from pending production through to inventory arrival. It supports both order-level and item-level tracking.',
    diagram: 'production-workflow',
    steps: [
      {
        title: 'Production Pending',
        description:
          'Orders waiting to start production. Each order shows its items with individual "Start" buttons.',

        details: [
          'Click "▶ Start" on an item to begin production for that item',
          'You will be prompted to enter the estimated production days',
          'The system calculates the estimated finish date based on the days entered',
          'Use the "Bulk Start" button to start all items at once with the same production days',
        ],
        tip: 'Item-level tracking lets you start production on individual items even if other items in the same order are not ready yet.',
        links: [{ label: 'Open Production →', href: '/production' }],
      },
      {
        title: 'Partial Production',
        description:
          'Orders that have some items started but not all. This section shows only the pending items with "Start" buttons, while the started/finished items appear in Production In Progress.',
      },
      {
        title: 'Production In Progress',
        description:
          'Orders with items currently in production. Each item shows its status (pending/in_progress/finished) and estimated finish date.',
        details: [
          'Mark items as "Finished" when production completes',
          'Mark items as "Delayed" if production is behind schedule',
          'Use "Bulk Finish" to mark all items as finished at once',
          'When all items are finished, click "Finish Production" on the order header to advance the order',
        ],
      },
      {
        title: 'Production Finished Tracking',
        description:
          'Orders where production is complete and items are being dispatched. This section shows:',
        details: [
          'Estimated Inventory Arrival Date — calculated from the en-route days',
          'Dispatch Status — whether items have been dispatched',
          'Notes section — add internal notes about the order',
          'Item-level "Mark En Route" buttons to mark individual items as dispatched',
          '"Bulk En Route" to mark selected items as dispatched at once',
          '"Confirm En Route" on the order header when all items are dispatched',
        ],
        tip: 'When marking items en route, you will be prompted for the estimated arrival days. This determines when the inventory is expected to arrive.',
      },
      {
        title: 'En Route Verification',
        description:
          'Orders that are en route and waiting for arrival confirmation. Items can be marked as "Arrived" when they reach the warehouse.',
      },
      {
        title: 'Inventory Verification',
        description:
          'When items arrive, they need inventory verification. Click "Verify" on each item to confirm it matches the order. Use "Complete Verification" when all items are verified.',
      },
      {
        title: 'Inventory Arrived',
        description:
          'Orders where all items have been verified and confirmed as arrived. Click "Confirm Arrived" to finalize and move the order to the next stage (Delivery/Collection).',
      },
      {
        title: 'Item-Level Tracking',
        description:
          'Every order item is tracked individually through its lifecycle. Each item has independent status fields:',
        details: [
          'Production Status — pending / in_progress / finished',
          'En Route Status — pending / in_transit / arrived',
          'Inventory Verification — verified quantity vs ordered quantity',
          'Use the Order Detail page to see per-item progress bars and timelines',
        ],
        tip: 'Item-level tracking means one order can have some items in production while others are already en route.',
      },
      {
        title: 'Production Exceptions',
        description:
          'Use "Grant Exception" or "Revoke Exception" on orders that need special handling or bypass normal production checks.',
      },
      {
        title: 'Stock Replenishment',
        description:
          'The "Create Stock Replenishment" button lets you generate a stock replenishment order from production data. Upload a file and the system processes it.',
      },
      {
        title: 'Filter by Client',
        description:
          'Use the client filter at the top to narrow down orders across all production sections by client name.',
      },
    ],
  },

  {
    id: 'inventory',
    icon: Package,
    color: 'bg-teal-50 text-teal-600',
    title: '📦 Inventory',
    href: '/inventory',
    summary:
      'The Inventory tab manages the inventory item database. Create, search, edit, and manage inventory items with categories, descriptions, and stock levels.',
    steps: [
      {
        title: 'View Inventory Items',
        description:
          'The main view shows all inventory items in a table with columns for Name, Description, Category, Unit, Stock Quantity, and Price.',

        details: [
          'Use the search bar to find items by name or description',
          'Filter by category using the category dropdown',
          'Sort by any column',
        ],
        links: [{ label: 'Open Inventory →', href: '/inventory' }],
      },
      {
        title: 'Add a New Item',
        description:
          'Click "Add Item" to open the creation form. Fill in the item name, description, category, unit of measurement, stock quantity, and price.',
        tip: 'Use consistent naming conventions for inventory items to make searching and matching easier.',
      },
      {
        title: 'Edit an Item',
        description:
          'Click the edit icon on any item row. Update the fields as needed. Changes are saved immediately.',
      },
      {
        title: 'Delete Items',
        description:
          'Select items using checkboxes and click "Delete Selected" for bulk deletion. Individual items can be deleted via the delete icon. Requires OTP verification.',
      },
      {
        title: 'Bulk Upload',
        description:
          'Use the "Bulk Upload" button to upload a spreadsheet or document with multiple inventory items. The system parses the file and creates items in bulk.',
      },
      {
        title: 'Drafts Management',
        description:
          'When items are extracted from documents (e.g., via AI), they appear as drafts. Review, approve, or reject drafts from the Drafts section.',
      },
      {
        title: 'Inventory Movements',
        description:
          'Track stock movements (additions, deductions, adjustments) for each inventory item. View the movement history by expanding an item row.',
      },
    ],
  },

  {
    id: 'stock-prep',
    icon: PackageCheck,
    color: 'bg-lime-50 text-lime-600',
    title: '📦📋 Stock Prep',
    href: '/stock-prep',
    summary:
      'The Stock Prep tab handles orders that need stock preparation and inventory matching. This is where from-stock orders are matched against existing inventory items.',
    steps: [
      {
        title: 'Stock Preparation Orders',
        description:
          'Orders in the stock preparation stage appear here. These are typically "from-stock" orders where items are sourced from existing inventory rather than produced.',

        links: [{ label: 'Open Stock Prep →', href: '/stock-prep' }],
      },
      {
        title: 'Matching Verification',
        description:
          'For from-stock orders, the system automatically suggests the best inventory match for each order item using fuzzy matching:',
        details: [
          'Review the suggested match for each item',
          'Use the search tabs (All / By Name / By Description) to find alternative matches',
          'Click "Confirm Match" to link the order item to an inventory item',
          'The stock indicator shows green (sufficient stock) or red (insufficient stock)',
        ],
        tip: 'The auto-suggest feature uses local fuzzy matching — no AI cost. It compares item names and descriptions against your inventory database.',
      },
      {
        title: 'Mark Stock Ready',
        description:
          'Once all items are matched and verified, click "Mark Stock Ready" to advance the order. This deducts the items from inventory stock levels.',
      },
      {
        title: 'Set Stock Preparation',
        description:
          'Use the "Set Stock Prep" action to move orders into the stock preparation workflow from other stages.',
      },
    ],
  },

  {
    id: 'delivery',
    icon: Truck,
    color: 'bg-sky-50 text-sky-600',
    title: '🚚 Delivery',
    href: '/delivery',
    summary:
      'The Delivery tab manages the entire delivery workflow — from inventory arrival through scheduling, delivery, and payment collection.',
    diagram: 'payment-workflow',
    steps: [
      {
        title: 'Stock Preparation',
        description:
          'From-stock orders appear here first. These orders skip production and go straight to stock preparation. Match items against existing inventory, confirm stock is ready, and the order advances to Balance Due.',
        links: [{ label: 'Open Delivery →', href: '/delivery' }],
      },
      {
        title: 'Inventory Arrived',
        description:
          'Orders where inventory has arrived and is ready for delivery processing. Click "Balance Due →" to move the order forward.',
        tip: 'The button advances the order to the Balance Due stage so the team can collect payment before delivery.',
      },
      {
        title: 'Balance Due',
        description:
          'Orders awaiting balance payment. This section includes the deposit slip upload and AI extract feature:',

        details: [
          'Click "Confirm Payment" to open the payment modal',
          'Upload deposit slip images — the system AI-extracts the amount, date, and reference',
          'Add multiple slips if needed (e.g., partial payments)',
          'The system detects duplicate slips automatically',
          'Review extracted data and confirm with OTP verification',
          'Exception orders show a "Schedule" button to skip payment and schedule delivery directly',
        ],
        tip: 'You can upload multiple deposit slips for a single order. The system will sum up all slip amounts and detect duplicates. Exception orders can bypass payment if granted a delivery exception.',
      },
      {
        title: 'Balance Verification',
        description:
          'Orders where balance payment has been submitted but needs verification. Click "Verify Balance" to confirm the payment.',
      },
      {
        title: 'Delivery Pending',
        description:
          'Orders ready for delivery scheduling. Click "Schedule Delivery" to set a delivery date and time.',
      },
      {
        title: 'Delivery Scheduled',
        description:
          'Orders with a scheduled delivery date. Shows the scheduled date and allows rescheduling or cancelling if needed.',
      },
      {
        title: 'Delivered',
        description:
          'Orders that have been marked as delivered. From here you can:',
        details: [
          'Mark Payment Received — when the customer has paid',
          'Mark Countered — if the customer contested the delivery',
          'Mark Payment Confirmed — when payment is fully verified',
          'Complete Order — if balance was already paid before delivery, the order auto-completes',
        ],
      },
      {
        title: 'Payment Received / Confirmed',
        description:
          'Orders where payment has been received and/or confirmed. These are the final stages before completion.',
      },
      {
        title: 'Delivery Exceptions',
        description:
          'Use "Grant Exception" or "Revoke Exception" for orders that need special delivery handling. Exception orders can schedule delivery without full payment.',
        warning: 'Only grant exceptions for trusted clients or special-case orders.',
      },
      {
        title: 'Filter by Client',
        description:
          'Use the client filter at the top to narrow down orders across all delivery sections by client name.',
      },
    ],
  },

  {
    id: 'collection',
    icon: DollarSign,
    color: 'bg-emerald-50 text-emerald-600',
    title: '💰 Collection',
    href: '/collection',
    summary:
      'The Collection tab manages payment collection, deposit verification, balance tracking, and payment reconciliation across all orders.',
    diagram: 'payment-workflow',
    steps: [
      {
        title: 'Understanding the Sections',
        description:
          'The Collection page is organized into payment workflow sections:',

        details: [
          'Balance Due — Orders awaiting balance payment with deposit slip upload + AI extract',
          'Deposit for Verification — Deposits that need to be verified',
          'Balance for Verification — Balance payments that need verification',
          'Delivered — Orders marked as delivered, awaiting payment',
          'Countered — Orders where the customer contested',
          'Payment Received — Payments received but not yet confirmed',
          'Payment Confirmed — Fully confirmed payments',
          'Completed — Fully paid and completed orders',
        ],
        links: [{ label: 'Open Collection →', href: '/collection' }],
      },
      {
        title: 'Record Balance Payment with AI Extract',
        description:
          'In the Balance Due section, click "Confirm Payment" to open the payment modal:',
        details: [
          'Upload deposit slip images (JPG, PNG, PDF)',
          'Click "Extract" to AI-parse the amount, date, and reference from each slip',
          'Review the extracted data and correct if needed',
          'Add multiple slips for split payments',
          'The system highlights duplicate slips in red',
          'Confirm with OTP verification',
        ],
        tip: 'The AI extract supports multiple currencies and formats. It works with bank deposit slips, online transfer screenshots, and check images.',
      },
      {
        title: 'Verify Deposits & Balances',
        description:
          'Click "Verify Deposit" or "Verify Balance" on orders in the verification sections. This confirms the payment and advances the order.',
      },
      {
        title: 'Grant/Revoke Exceptions',
        description:
          'Use exception management for orders that need special payment handling, such as partial payments or extended terms.',
      },
      {
        title: 'Acknowledgement Receipts',
        description:
          'The Acknowledgement Receipts section shows all payment receipts. Each receipt shows the receipt number, order, client, payment type, amount, date, and status. Download receipts as PDF.',
      },
      {
        title: 'Collection Summary',
        description:
          'The Collection Summary table at the top provides a consolidated view of all orders with their payment status, deposit amounts, balance amounts, and payment dates.',
      },
      {
        title: 'Filter by Client',
        description:
          'Use the client filter at the top to narrow down orders across all collection sections by client name.',
      },
    ],
  },

  {
    id: 'calendar',
    icon: CalendarDays,
    color: 'bg-violet-50 text-violet-600',
    title: '📅 Calendar',
    href: '/calendar',
    summary:
      'The Calendar tab provides a visual calendar view of all scheduled events, delivery dates, reminders, and notes. It aggregates data from across the system.',
    steps: [
      {
        title: 'Viewing the Calendar',
        description:
          'The calendar shows events in a monthly grid view. Navigate between months using the previous/next buttons.',

        details: [
          'Scheduled deliveries appear with delivery icons',
          'Reminders appear with alert icons',
          'Notes appear with note icons',
          'Each event type has a distinct color in the legend',
        ],
        links: [{ label: 'Open Calendar →', href: '/calendar' }],
      },
      {
        title: 'Create a Calendar Note',
        description:
          'Click on any date to create a new note. Enter the note title and content. Notes are visible to all users and appear on the calendar.',
      },
      {
        title: 'Create a Schedule Event',
        description:
          'Use the "Add Schedule" button to create scheduled events with:',
        details: [
          'Title and description',
          'Date and time',
          'Recurrence (none, daily, weekly, monthly)',
          'End date for recurring events',
        ],
      },
      {
        title: 'Delivery Schedule Integration',
        description:
          'When orders are scheduled for delivery in the Delivery tab, they automatically appear on the calendar with the delivery date and order details.',
      },
      {
        title: 'Reminder Integration',
        description:
          'System reminders (production reminders, payment reminders, etc.) appear on the calendar with their due dates and status.',
      },
      {
        title: 'Edit & Delete Events',
        description:
          'Click on any calendar event to view details. Use the edit/delete buttons to modify or remove events. Deletion requires OTP verification.',
      },
    ],
  },

  {
    id: 'order-types',
    icon: PackageCheck,
    color: 'bg-sky-50 text-sky-600',
    title: '📦 Order Types & Workflow',
    href: '/orders',
    summary:
      'The system handles three order types. Understanding the difference prevents confusion when orders skip stages or follow alternate paths.',
    steps: [
      {
        title: 'Produced Orders (Standard)',
        description:
          'The default flow. Items are manufactured or sourced externally, then dispatched.',
        details: [
          'Flow: Order Confirmation → Math Verified → Downpayment → Purchasing → Production (Partial / In Progress) → En Route → Inventory → Balance → Delivery → Collection → Completed',
          'Downpayment (Pending → Verified) stages occur after math verification and before purchasing can begin',
          'Production supports partial production — individual items can start before others finish',
          'En route, en route verification, and inventory verification track physical arrival of goods',
          'Balance Due and Balance Verification stages handle the remaining payment before delivery',
          'Stock Preparation is used for from-stock orders instead of the production & en-route chain',
        ],
        tip: 'Most orders follow this path. The actual stage order has 21 stages in total — the Workflow page shows their exact exit conditions.',
      },
      {
        title: 'From-Stock Orders',
        description:
          'Items are pulled directly from existing inventory. These orders skip production, en route, and inventory verification.',
        details: [
          'Flow: Order Confirmation → Math Verified → Stock Preparation → Balance Due → Delivery → Collection → Completed',
          'Stock Preparation stage matches order items against inventory database',
          'Once stock is confirmed ready, the order advances to Balance Due',
        ],
        tip: 'From-stock orders appear in the Stock Preparation section of the Delivery tab, not in Production.',
      },
      {
        title: 'Stock Replenishment',
        description:
          'Internal orders to restock inventory. These do not require deposits or client payments.',
        details: [
          'No deposit or balance collection needed',
          'Moves straight to purchasing/production once confirmed',
          'Used to keep inventory levels healthy',
        ],
      },
    ],
  },

  {
    id: 'item-tracking',
    icon: Factory,
    color: 'bg-violet-50 text-violet-600',
    title: '🏗️ Item-Level Tracking',
    href: '/production',
    summary:
      'Every order item is tracked independently. One order can have items at different stages simultaneously.',
    steps: [
      {
        title: 'Production Tracking',
        description:
          'Each item has its own production status and estimated finish date.',
        details: [
          'Pending — not yet started',
          'In Progress — actively being produced',
          'Finished — production complete',
          'Delayed — behind schedule, triggers escalation reminders',
        ],
        tip: 'Use "Bulk Start" and "Bulk Finish" to update many items at once, or handle items individually for partial production.',
      },
      {
        title: 'En Route Tracking',
        description:
          'After production, each item is tracked during dispatch and transit.',
        details: [
          'Pending — waiting to be dispatched',
          'In Transit — dispatched, on the way',
          'Arrived — physically received at warehouse',
        ],
      },
      {
        title: 'Inventory Verification',
        description:
          'When items arrive, each is verified against the order quantity.',
        details: [
          'Verified Qty — how many units have been checked and confirmed',
          'Partial verification is allowed (e.g., 5/10 items verified)',
          'Bulk verify multiple items at once with a single OTP',
        ],
      },
    ],
  },

  {
    id: 'security',
    icon: ShieldAlert,
    color: 'bg-red-50 text-red-600',
    title: '🔒 Security & OTP Verification',
    href: '/settings',
    summary:
      'Critical actions require email OTP verification to prevent accidental or unauthorized changes.',
    steps: [
      {
        title: 'OTP-Protected Actions',
        description:
          'The following actions always require an OTP code sent to your email:',
        details: [
          'Editing or deleting an order',
          'Recording or verifying a payment',
          'Manually advancing a stage',
          'Granting or revoking exceptions',
          'Verifying deposits or balances',
          'Scheduling or cancelling delivery',
          'Marking an order as delivered or countered',
          'Deleting calendar events or clients',
        ],
        warning: 'If you do not receive the OTP email, check your spam folder or contact an admin.',
      },
      {
        title: 'How OTP Works',
        description:
          'When you trigger a protected action, the system sends a one-time code to your registered email. Enter the code in the modal to proceed. The code expires after a short time for security.',
        tip: 'The OTP modal shows which action you are confirming. Always double-check the order quotation number before entering the code.',
      },
    ],
  },

  {
    id: 'exceptions',
    icon: ShieldAlert,
    color: 'bg-amber-50 text-amber-600',
    title: '⚠️ Delivery Exceptions & Special Cases',
    href: '/delivery',
    summary:
      'Delivery exceptions allow orders to bypass normal requirements for trusted clients or special situations.',
    steps: [
      {
        title: 'What is a Delivery Exception?',
        description:
          'A delivery exception lets an order move to delivery scheduling without the balance being fully paid. This is useful for:',
        details: [
          'Trusted long-term clients with payment terms',
          'Emergency or rush deliveries where payment will follow',
          'Internal or special-case orders',
        ],
        warning: 'Only admins can grant exceptions. Use sparingly — exceptions bypass the standard payment guard.',
      },
      {
        title: 'How to Grant an Exception',
        description:
          'On the Delivery or Production tab, click "Grant Exception" on an order row. Add a note explaining why the exception is needed. The order will then show a "Special Case" badge and unlock skip-payment buttons.',
      },
      {
        title: 'Revoking an Exception',
        description:
          'If circumstances change, click "Revoke Exception" to restore normal payment requirements. The order will no longer allow skip-payment scheduling.',
      },
    ],
  },

  {
    id: 'telegram',
    icon: MessageSquare,
    color: 'bg-emerald-50 text-emerald-600',
    title: '🤖 Telegram Bot Quick Reference',
    href: '/telegram',
    summary:
      'The Telegram bot mirrors dashboard functionality for on-the-go updates. Most actions use inline buttons.',
    steps: [
      {
        title: 'Slash Commands',
        description:
          'Type these commands in any connected group or private chat:',
        details: [
          '/start — Show the main menu with all features',
          '/commands — List all available commands and features',
          '/help — Detailed guide for each feature',
          '/unlink — Clear the linked order for file uploads',
          '/prod — Quick production status check',
          '/bug — Report a bug or issue',
        ],
      },
      {
        title: 'Main Menu Features',
        description:
          'Tap the buttons in the main menu for guided workflows:',
        details: [
          'Check Order Status — type a quotation number to see current stage and payment status',
          'Purchasing / Production — confirm production started, partial, or not yet',
          'Record Downpayment — log deposit with optional AI slip scan',
          'Pay Balance — record balance payment before delivery',
          'Schedule Delivery — pick a date (requires balance paid unless exception granted)',
          'Mark as Delivered — confirm delivery with optional remarks',
          'Record Payment — confirm or log payment received',
          'Clients — search client details and delivery info',
        ],
      },
      {
        title: 'Smart Features',
        description:
          'Advanced automation features powered by AI and scheduling:',
        details: [
          'AI Vision — send a quotation or deposit slip photo and the bot auto-extracts details',
          'Auto Reminders — scheduled reminders for production, delivery, and payments',
          'Dashboard Sync — all data syncs to the web dashboard in real-time',
          'Inline Buttons — most actions use tap-friendly buttons instead of typed commands',
        ],
        tip: 'You can also type a quotation number directly (e.g., QTN-2026-001) and the bot will show its status instantly.',
      },
    ],
  },

  {
    id: 'shortcuts',
    icon: Keyboard,
    color: 'bg-gray-50 text-gray-600',
    title: '⌨️ Tips & Shortcuts',
    href: '#',
    summary:
      'Productivity tips to navigate the dashboard faster.',
    steps: [
      {
        title: 'Dashboard Navigation Tips',
        description:
          'Ways to move through the system more efficiently:',
        details: [
          'Click any quotation number to open the Order Detail page from any tab',
          'Use the client filter at the top of each page to narrow down orders quickly',
          'Expand order rows to see item-level details without leaving the page',
          'The Calendar tab aggregates all delivery dates and reminders in one view',
        ],
      },
      {
        title: 'Search Tips',
        description:
          'Make the most of search and filtering:',
        details: [
          'Client search uses fuzzy matching — partial names work',
          'Order search filters by quotation number and client name simultaneously',
          'Use the Workflow page to see live order counts at every stage',
        ],
      },
      {
        title: 'Mobile Tips',
        description:
          'The dashboard is responsive and works on mobile:',
        details: [
          'Tables scroll horizontally on small screens',
          'OTP modals are centered and thumb-friendly',
          'Add the dashboard to your home screen for quick access (PWA supported)',
        ],
      },
    ],
  },

  {
    id: 'faq',
    icon: HelpCircle,
    color: 'bg-orange-50 text-orange-600',
    title: '❓ FAQ & Troubleshooting',
    href: '#',
    summary:
      'Common questions and quick fixes for issues you might encounter.',
    steps: [
      {
        title: 'Why does my order not advance to the next stage?',
        description:
          'Orders only advance when all required conditions are met. Check:',
        details: [
          'Is the deposit verified? Production cannot start without a verified deposit.',
          'Are all items finished? Production only advances when every item is marked finished.',
          'Is the balance paid? Delivery scheduling requires balance payment unless an exception is granted.',
          'Check the Workflow page to see the exact exit condition for each stage.',
        ],
      },
      {
        title: 'Why am I getting duplicate reminders?',
        description:
          'The reminder scheduler auto-completes stale reminders when an order advances, but occasionally a reminder may fire just before the stage change. If you see persistent duplicate reminders for the same stage, check the Workflow page to confirm the order is not stuck.',
        tip: 'Stuck orders (e.g., balance_due with balance_verified=true) will trigger reminders until manually advanced.',
      },
      {
        title: 'Why did my dashboard action fail?',
        description:
          'Most failures fall into these categories:',
        details: [
          'OTP expired — request a new code and try again',
          'Invalid stage transition — the system blocks jumps that skip required steps',
          'Action token missing — dashboard actions require OTP verification; bot actions do not',
          'Network error — refresh the page and retry',
        ],
      },
      {
        title: 'How do I fix a stuck order?',
        description:
          'An order is "stuck" when it sits at a stage longer than expected. To resolve:',
        details: [
          'Check the Order Detail page for the full timeline and any error notes',
          'Verify all prerequisites are met (deposit verified, items finished, balance paid)',
          'Use the Quick Actions tab to manually advance the stage if needed',
          'If the stage transition is blocked, read the error message — it tells you exactly what is missing',
        ],
      },
      {
        title: 'The Telegram bot is not responding',
        description:
          'Try these steps:',
        details: [
          'Check the Bot Logs page for error messages',
          'Ensure the bot is added to the correct group chats with admin permissions',
          'Try typing /start to reset your session',
          'If the bot shows a 409 Conflict error, it will auto-retry within a few minutes',
        ],
      },
    ],
  },
];

// ─── Stage Badge Helper ──────────────────────────────────────────────────────

function GuideStageBadge({ stage }: { stage: string }) {
  const config = {
    order_confirmation_received: { label: 'Order Confirmation Received', color: 'var(--primary)', bg: '#eff6ff' },
    math_verified: { label: 'Math Verified', color: '#14b8a6', bg: '#f0fdfa' },
    purchasing_pending: { label: 'Purchasing Pending', color: '#f97316', bg: '#fff7ed' },
    deposit_pending: { label: 'Downpayment Pending', color: '#ec4899', bg: '#fdf2f8' },
    deposit_verification: { label: 'Deposit Verification', color: '#e11d48', bg: '#fff1f2' },
    production_pending: { label: 'Production Pending', color: '#eab308', bg: '#fefce8' },
    partial_production: { label: 'Partial Production', color: '#84cc16', bg: '#f7fee7' },
    production_in_progress: { label: 'Production In Progress', color: '#6366f1', bg: '#eef2ff' },
    en_route: { label: 'En Route', color: '#0ea5e9', bg: '#f0f9ff' },
    en_route_verification: { label: 'En Route Verification', color: '#3b82f6', bg: '#eff6ff' },
    inventory_verification: { label: 'Inventory Verification', color: '#14b8a6', bg: '#f0fdfa' },
    inventory_arrived: { label: 'Inventory Arrived', color: '#06b6d4', bg: '#ecfeff' },
    stock_preparation: { label: 'Stock Preparation', color: '#84cc16', bg: '#f7fee7' },
    balance_due: { label: 'Balance Due', color: '#8b5cf6', bg: '#f5f3ff' },
    balance_verification: { label: 'Balance Verification', color: '#d946ef', bg: '#fdf4ff' },
    delivery_pending: { label: 'Delivery Pending', color: '#f59e0b', bg: '#fffbeb' },
    delivery_scheduled: { label: 'Delivery Scheduled', color: '#a855f7', bg: '#faf5ff' },
    delivered: { label: 'Delivered', color: '#f97316', bg: '#fff7ed' },
    countered: { label: 'Countered', color: '#f43f5e', bg: '#fff1f2' },
    payment_received: { label: 'Payment Received', color: '#10b981', bg: '#ecfdf5' },
    payment_confirmed: { label: 'Payment Confirmed', color: '#22c55e', bg: '#f0fdf4' },
    completed: { label: 'Completed', color: '#6b7280', bg: '#f3f4f6' },
  }[stage];
  if (!config) return null;
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold"
      style={{ color: config.color, backgroundColor: config.bg, border: `1px solid ${config.color}33` }}
    >
      {config.label}
    </span>
  );
}

// ─── Diagram Renderer ────────────────────────────────────────────────────────

function DiagramRenderer({ type }: { type: string }) {
  switch (type) {
    case 'order-lifecycle':
      return <OrderLifecycleDiagram />;
    case 'production-workflow':
      return <ProductionWorkflowDiagram />;
    case 'payment-workflow':
      return <PaymentWorkflowDiagram />;
    default:
      return null;
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function GuidesPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(SECTIONS.map((s) => s.id)));
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  function toggleSection(id: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleStep(sectionId: string, stepIndex: number) {
    const key = `${sectionId}-${stepIndex}`;
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const filteredSections = SECTIONS.filter(
    (section) =>
      section.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      section.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
      section.steps.some(
        (step) =>
          step.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          step.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-indigo-50 p-2.5 text-indigo-600">
            <BookOpen className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Guides & Tutorials</h1>
            <p className="mt-1 text-sm text-gray-500">
              Step-by-step guides for every feature in the Workflow Automation System
            </p>
          </div>
        </div>

        {/* ── Search ───────────────────────────────────────────── */}
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search guides..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-gray-200 py-2.5 pl-10 pr-4 text-sm outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
      </div>

      {/* ── Quick Navigation Chips ──────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            onClick={() => {
              const el = document.getElementById(`section-${section.id}`);
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
          >
            <section.icon className="h-3.5 w-3.5" />
            {section.title.replace(/^[^\s]+\s/, '')}
          </button>
        ))}
      </div>

      {/* ── Sections ────────────────────────────────────────── */}
      {filteredSections.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
          <BookOpen className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">
            No guides match your search. Try a different keyword.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {filteredSections.map((section) => {
            const isExpanded = expandedSections.has(section.id);
            const Icon = section.icon;
            return (
              <div
                key={section.id}
                id={`section-${section.id}`}
                className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md"
              >
                {/* Section Header */}
                <button
                  onClick={() => toggleSection(section.id)}
                  className="flex w-full items-center justify-between p-5 text-left transition-colors hover:bg-gray-50"
                >
                  <div className="flex items-center gap-3">
                    <div className={`rounded-lg p-2.5 ${section.color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">
                        {section.title}
                      </h2>
                      <p className="mt-0.5 text-sm text-gray-500">{section.summary}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={section.href}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-indigo-100 hover:text-indigo-600"
                    >
                      Open <ExternalLink className="h-3 w-3" />
                    </a>
                    {isExpanded ? (
                      <ChevronUp className="arrow-animated h-6 w-6" />
                    ) : (
                      <ChevronDown className="arrow-animated h-6 w-6" />
                    )}
                  </div>
                </button>

                {/* Section Content */}
                {isExpanded && (
                  <div className="border-t border-gray-100 px-5 pb-5 pt-4">
                    {/* Diagram */}
                    {section.diagram && (
                      <div className="mb-4 overflow-hidden rounded-lg border border-gray-100 bg-gray-50/50 p-3">
                        <DiagramRenderer type={section.diagram} />
                      </div>
                    )}

                    {/* Steps */}
                    <div className="space-y-3">
                      {section.steps.map((step, stepIndex) => {
                        const stepKey = `${section.id}-${stepIndex}`;
                        const stepExpanded = expandedSteps.has(stepKey);
                        return (
                          <div
                            key={stepKey}
                            className="rounded-lg border border-gray-100 transition-colors hover:border-gray-200"
                          >
                            <button
                              onClick={() => toggleStep(section.id, stepIndex)}
                              className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50"
                            >
                              <div className="flex items-center gap-2">
                                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-600">
                                  {stepIndex + 1}
                                </span>
                                <span className="text-sm font-medium text-gray-900">
                                  {step.title}
                                </span>
                              </div>
                              {stepExpanded ? (
                                <ChevronUp className="arrow-animated h-5 w-5" />
                              ) : (
                                <ChevronDown className="arrow-animated h-5 w-5" />
                              )}
                            </button>

                            {stepExpanded && (
                              <div className="border-t border-gray-50 px-4 pb-4 pt-3">
                                <p className="text-sm leading-relaxed text-gray-600">
                                  {step.description}
                                </p>

                                {step.details && step.details.length > 0 && (
                                  <ul className="mt-2 space-y-1">
                                    {step.details.map((d, di) => (
                                      <li
                                        key={di}
                                        className="flex items-start gap-2 text-sm text-gray-500"
                                      >
                                        <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-indigo-400" />
                                        {d}
                                      </li>
                                    ))}
                                  </ul>
                                )}

                                {step.warning && (
                                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                                    <span className="font-medium">⚠️ Warning:</span>
                                    {step.warning}
                                  </div>
                                )}

                                {step.tip && (
                                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
                                    <span className="font-medium">💡 Tip:</span>
                                    {step.tip}
                                  </div>
                                )}

                                {step.links && step.links.length > 0 && (
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {step.links.map((link, li) => (
                                      <a
                                        key={li}
                                        href={link.href}
                                        className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-100"
                                      >
                                        {link.label}
                                        <ArrowRight className="h-3 w-3" />
                                      </a>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Footer ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-center">
        <p className="text-sm text-gray-500">
          Guides last updated: {new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}.
          For system issues, use the <a href="/bugs" className="font-medium text-indigo-600 underline-offset-2 hover:underline">Bug Report</a> page.
        </p>
      </div>
    </div>
  );
}
