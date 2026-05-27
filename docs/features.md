# Quotation Automation System — Feature Reference

> Comprehensive guide to all platform features, organized by dashboard tab.
> This document is used by the AI Tutorial Assistant to answer user questions accurately.

---

## Table of Contents

1. [Dashboard](#1-dashboard)
2. [Guides](#2-guides)
3. [All Orders](#3-all-orders)
4. [Quick Actions](#4-quick-actions)
5. [Clients](#5-clients)
6. [Purchasing](#6-purchasing)
7. [Production](#7-production)
8. [Inventory](#8-inventory)
9. [Stock Prep](#9-stock-prep)
10. [Delivery](#10-delivery)
11. [Sales](#11-sales)
12. [Collection](#12-collection)
13. [Stage Pipeline](#13-stage-pipeline)
14. [Workflow](#14-workflow)
15. [Calendar](#15-calendar)
16. [Agents](#16-agents)
17. [Agent Logs](#17-agent-logs)
18. [Bot Logs](#18-bot-logs)
19. [Bug Report](#19-bug-report)
20. [Telegram](#20-telegram)
21. [Backups](#21-backups)
22. [Vision Upload](#22-vision-upload)
23. [Settings](#23-settings)
24. [Update Logs](#24-update-logs)
25. [AI Assistant Chat](#25-ai-assistant-chat)

---

## 1. Dashboard

**Path:** `/`

The main landing page showing a high-level overview of the business.

### Features
- **Stats Cards** — Total orders, pending orders, monthly revenue, active production
- **Recent Orders** — Quick list of the most recently created orders
- **Monthly Sales Chart** — Bar chart showing revenue trends over the past 12 months
- **Sales by Agent** — Breakdown of sales performance per sales agent
- **Sales by Client** — Top clients by total order value

### How to Use
1. Navigate to `/` after login
2. View real-time statistics at the top
3. Scroll down to see charts and breakdowns
4. Click any order row to go to its detail page

---

## 2. Guides

**Path:** `/guides`

Step-by-step tutorials for every feature on the platform.

### Features
- **Search** — Filter guides by keyword
- **Expandable Sections** — Click a section title to expand/collapse
- **Step-by-Step Instructions** — Numbered steps with details and links
- **SVG Workflow Diagrams** — Visual diagrams for Order Lifecycle, Production Workflow, and Payment Workflow
- **Quick Nav Chips** — Click chips at the top to jump to a specific section

### How to Use
1. Go to `/guides`
2. Use the search bar to find specific topics
3. Click a section title to expand it
4. Follow the numbered steps
5. Click internal links to navigate to the relevant dashboard page

---

## 3. All Orders

**Path:** `/orders`

Central hub for viewing, creating, and managing all orders.

### Features
- **Order Table** — Sortable, filterable table with all orders
- **Search** — Search by quotation number, client name, or reference
- **Stage Filters** — Filter by current stage (e.g., Quotation, Purchasing, Production, Delivery)
- **Date Filters** — Filter by date range
- **Create New Order** — Button to open the New Order modal
- **Order Detail Page** — Click any order to view full details, items, payments, notes, files, and stage history
- **Bulk Delete** — Select multiple orders and delete with OTP verification
- **Export** — Download order data

### Order Stages (Lifecycle)
1. **Quotation** — Order is created, awaiting confirmation
2. **Purchasing Pending** — Materials need to be purchased
3. **Production Pending** — Order is queued for production
4. **Production In Progress** — Items are being manufactured
5. **Stock Preparation** — Finished items being prepped for delivery
6. **En Route** — Items are in transit to client
7. **Inventory Verification** — Client verifies received items
8. **Inventory Arrived** — Items confirmed delivered
9. **Balance Verification** — Final payment is being verified
10. **Completed** — Order is fully done

### Order Types
- **Standard Order** — Goes through full production workflow
- **From-Stock Order** — Uses existing inventory, skips purchasing and production

### How to Create an Order
1. Click "New Order" button
2. Fill in client details (name, contact info)
3. Add order items (description, quantity, price)
4. Upload quotation file (optional)
5. Submit — order is created in "Quotation" stage

### How to View Order Details
1. Click any order row in the table
2. The detail page shows:
   - **Order Info** — Quotation number, client, dates, amounts
   - **Items Tab** — Line items with quantities, prices, production status
   - **Payments Tab** — Deposit and balance payment records
   - **Notes Tab** — Internal notes and agent notes
   - **Files Tab** — Uploaded documents and images
   - **Stage Updates Tab** — History of all stage transitions
   - **Production Logs Tab** — Detailed production tracking

---

## 4. Quick Actions

**Path:** `/actions`

Shortcut buttons for common tasks without navigating to the full page.

### Features
- **Create Order** — Quick link to open New Order modal
- **Record Payment** — Quick link to payment recording
- **View Production Board** — Quick link to production page
- **Check Inventory** — Quick link to inventory search
- **View Calendar** — Quick link to calendar

### How to Use
1. Go to `/actions`
2. Click any action button to navigate directly

---

## 5. Clients

**Path:** `/clients`

Manage client information and view client order history.

### Features
- **Client Table** — List of all clients with contact info
- **Search** — Search by name, company, or contact
- **Create Client** — Add a new client
- **Edit Client** — Update client details
- **Delete Client** — Remove client (with OTP verification)
- **Bulk Delete** — Select and delete multiple clients
- **Expanded Row** — Click a client to see their linked orders (clickable to order detail page)
- **Client Autocomplete** — When creating orders, client name auto-suggests from existing clients

### How to Use
1. Go to `/clients`
2. Click "Add Client" to create a new one
3. Click a client row to expand and see their orders
4. Click the edit icon to update details
5. Click the delete icon to remove (OTP required)

---

## 6. Purchasing

**Path:** `/purchasing`

Manage purchase orders and track material procurement.

### Features
- **Orders in Purchasing Pending** — List of orders waiting for materials
- **Mark as Purchased** — Mark materials as purchased
- **Client Filter** — Filter by client name
- **Notes** — Add purchasing notes to orders

### How to Use
1. Go to `/purchasing`
2. Review orders needing materials
3. Click "Mark Purchased" when materials are ordered
4. Add notes about supplier or delivery timeline

---

## 7. Production

**Path:** `/production`

Track and manage the manufacturing process.

### Features
- **Production Board** — Visual board showing all orders in production
- **Sections by Stage:**
  - **Production Pending** — Orders waiting to start
  - **Production In Progress** — Orders currently being manufactured
  - **Partial Production** — Orders where some items are finished
- **Item-Level Tracking** — Each item can be individually tracked
- **Start Production** — Begin production on an order or individual item
- **Report Status** — Update production status with notes
- **Finish Production** — Mark items/orders as completed
- **Production Days** — Set estimated production days per item
- **Production Logs** — View detailed production history per order
- **Client Filter** — Filter by client name

### How to Start Production
1. Go to `/production`
2. In "Production Pending" section, click "Start" on an order
3. Or click the item-level "▶ Start" button inside an order card
4. Enter estimated production days when prompted
5. Confirm with OTP verification

### How to Report Production Status
1. Click "Report Status" on an order
2. Enter status update text
3. Submit — notification is sent to the production Telegram group

### How to Finish Production
1. Click "Finish" on an order or individual item
2. Confirm with OTP verification
3. Order advances to "Stock Preparation" stage

---

## 8. Inventory

**Path:** `/inventory`

Manage stock items, track quantities, and handle inventory movements.

### Features
- **Inventory Table** — List of all stock items with quantities
- **Search** — Search by name, description, or category
- **Add Item** — Create a new inventory item
- **Edit Item** — Update item details (name, description, quantity, price, category)
- **Delete Item** — Remove item (with OTP verification)
- **Bulk Delete** — Select and delete multiple items
- **Image Upload** — Upload item images
- **AI Extract** — Extract item details from an image using AI vision
- **Bulk Upload** — Upload multiple items from a CSV/Excel file
- **Drafts** — Review and approve bulk-uploaded items before they go live
- **Item Movements** — View history of quantity changes for each item
- **Stock Alerts** — Items with low quantity are highlighted

### How to Add an Inventory Item
1. Go to `/inventory`
2. Click "Add Item"
3. Fill in name, description, quantity, price, category
4. Optionally upload an image
5. Submit

### How to Bulk Upload
1. Click "Bulk Upload"
2. Upload a CSV/Excel file with item data
3. Review drafts
4. Approve drafts to add items to inventory

---

## 9. Stock Prep

**Path:** `/stock-prep`

Prepare stock for delivery, including matching from-stock orders to inventory.

### Features
- **Stock Preparation Orders** — Orders in the stock preparation stage
- **Matching Verification** — For from-stock orders, match order items to inventory items
- **Auto-Suggest** — System suggests the best inventory match per item
- **Manual Search** — Search inventory by name or description
- **Stock Indicator** — Green if sufficient stock, red if insufficient
- **Confirm Match** — One-click confirmation with visual feedback
- **Mark Stock Ready** — Mark order as ready for delivery

### How to Match Inventory
1. Go to `/stock-prep`
2. Find a from-stock order
3. Click "Match Inventory" on an item
4. Review the auto-suggested match
5. Or search manually using the search tabs
6. Click "Confirm" to lock the match
7. Repeat for all items
8. Click "Mark Stock Ready" when done

---

## 10. Delivery

**Path:** `/delivery`

Manage order delivery, tracking, and exceptions.

### Features
- **En Route Orders** — Orders currently in transit
- **Confirm En Route** — Mark items as dispatched
- **Bulk En Route** — Mark multiple items dispatched at once
- **Delivery Tracking** — Start delivery tracking with ETA
- **Delivery Exceptions** — Report delivery issues (damaged, lost, delayed)
- **Revoke Exception** — Clear a delivery exception
- **Client Filter** — Filter by client name
- **Payment Due Display** — Shows remaining balance; clickable to open deposit slip upload modal

### How to Mark Items En Route
1. Go to `/delivery`
2. Select items to dispatch
3. Click "Mark En Route"
4. Confirm with OTP verification

### How to Report a Delivery Exception
1. Click "Report Exception" on an order
2. Select exception type (damaged, lost, delayed)
3. Add details
4. Submit — notification sent to delivery group

---

## 11. Sales

**Path:** `/sales`

View sales performance and revenue data.

### Features
- **Monthly Sales Chart** — Revenue trends over time
- **Sales by Agent** — Performance breakdown per sales agent
- **Sales by Client** — Top clients by revenue
- **Date Range Filter** — Filter data by date range

### How to Use
1. Go to `/sales`
2. View charts and data tables
3. Use date filters to narrow the view

---

## 12. Collection

**Path:** `/collection`

Manage payment collection, deposits, and balance payments.

### Features
- **Orders Pending Payment** — Orders with outstanding balances
- **Record Deposit** — Record a down payment
- **Record Balance Payment** — Record the final payment
- **Full Payment** — Record a single full payment (no deposit/balance split)
- **Deposit Slip Upload** — Upload payment slip images with AI extraction
- **Duplicate Detection** — System detects if a payment slip was already uploaded
- **Payment Verification** — Verify payments before they are finalized
- **Acknowledgement Receipts** — Generate and download PDF receipts for verified payments
- **Match & Record** — Auto-match bank deposits to orders
- **Bulk Balance Payment** — Pay balances for multiple orders at once

### How to Record a Deposit
1. Go to `/collection`
2. Find the order
3. Click "Record Deposit"
4. Enter amount and payment method
5. Optionally upload a deposit slip
6. Submit

### How to Generate an Acknowledgement Receipt
1. Record and verify a payment
2. The receipt appears in the Acknowledgement Receipts section
3. Click "Download PDF" to get the receipt

---

## 13. Stage Pipeline

**Path:** `/stages`

Visual pipeline view of all orders grouped by their current stage.

### Features
- **Kanban-Style Board** — Orders organized by stage columns
- **Drag-and-Drop** — Move orders between stages (with OTP verification)
- **Stage Counts** — Each column shows the number of orders in that stage
- **Quick View** — Click an order card to see summary

### How to Use
1. Go to `/stages`
2. View all orders organized by stage
3. Drag an order card to a new stage to advance it
4. Confirm with OTP verification

---

## 14. Workflow

**Path:** `/workflow`

Visual diagram of the complete order lifecycle and business processes.

### Features
- **Order Lifecycle Diagram** — End-to-end flow from quotation to completion
- **Production Workflow** — Detailed production process
- **Payment Workflow** — Payment collection process
- **Stage Descriptions** — Explanation of each stage

### How to Use
1. Go to `/workflow`
2. View the workflow diagrams
3. Read stage descriptions below each diagram

---

## 15. Calendar

**Path:** `/calendar`

Schedule and track events, production timelines, and delivery dates.

### Features
- **Monthly Calendar View** — Overview of the month
- **Events** — Schedule events with date, time, and description
- **Schedules** — Production schedules with order references
- **Notes** — Daily notes attached to specific dates
- **Create Event** — Add a new calendar event
- **Create Schedule** — Link a schedule to an order
- **Edit/Delete** — Modify or remove events and schedules

### How to Create an Event
1. Go to `/calendar`
2. Click a date or the "Add Event" button
3. Fill in title, date, time, description
4. Submit

### How to Add a Daily Note
1. Click a date on the calendar
2. Click "Add Note"
3. Write your note
4. Save

---

## 16. Agents

**Path:** `/agents`

View and manage automated AI agents that monitor and act on orders.

### Features
- **Agent List** — Cards showing each agent's status and last run time
- **Run Agent** — Manually trigger an agent to run
- **Agent Health** — Green/yellow/red status indicator
- **Last Run Time** — When the agent last executed
- **Run Interval** — How often the agent runs automatically

### Available Agents
| Agent | Purpose |
|-------|---------|
| **Quotation Checker** | Reviews new quotations for completeness and accuracy |
| **Purchasing Agent** | Monitors purchasing_pending orders and sends reminders |
| **Inventory Agent** | Tracks inventory levels and alerts on low stock |
| **Production Agent** | Monitors production progress and sends reminders |
| **Delivery Agent** | Tracks en-route orders and delivery confirmations |
| **Collection Agent** | Monitors pending payments and sends collection reminders |
| **Escalation Agent** | Escalates orders stuck in a stage for too long |
| **Supabase Backup Agent** | Creates automated database backups to Supabase |

### How to Run an Agent Manually
1. Go to `/agents`
2. Click "Run" on the desired agent
3. Confirm with OTP verification
4. The agent executes and logs its actions

---

## 17. Agent Logs

**Path:** `/logs`

View detailed logs of all agent actions and system events.

### Features
- **Log Table** — Chronological list of agent actions
- **Filter by Agent** — Filter logs by specific agent
- **Filter by Order** — Filter logs by order reference
- **Log Details** — Each log shows agent name, action, timestamp, and details

### How to Use
1. Go to `/logs`
2. Use filters to narrow down logs
3. Click a log entry to see full details

---

## 18. Bot Logs

**Path:** `/bot-logs`

View logs from the Telegram bot interactions.

### Features
- **Log Table** — Chronological list of Telegram bot events
- **Filter by Type** — Filter by message type (incoming, outgoing, error)
- **Filter by Chat** — Filter by Telegram chat ID
- **Search** — Search log content

### How to Use
1. Go to `/bot-logs`
2. Use filters to find specific bot interactions
3. Review message content and status

---

## 19. Bug Report

**Path:** `/bugs`

Report and track software bugs and issues.

### Features
- **Report Bug** — Submit a new bug report with description and screenshots
- **Bug List** — View all reported bugs
- **Status Tracking** — Track bug status (open, in progress, resolved, closed)
- **Admin Actions** — Admins can update bug status and assign priority

### How to Report a Bug
1. Go to `/bugs`
2. Click "Report Bug"
3. Fill in title, description, and optional screenshot
4. Submit

---

## 20. Telegram

**Path:** `/telegram`

View Telegram bot configuration and group information.

### Features
- **Bot Status** — Shows if the Telegram bot is running
- **Group List** — List of configured Telegram groups
- **Group Purposes** — Each group serves a specific function (purchasing, production, delivery, etc.)
- **Test Notification** — Send a test message to verify bot connectivity

### Telegram Groups
| Group | Purpose |
|-------|---------|
| Purchasing | Material procurement notifications |
| Production | Production status updates |
| Inventory | Stock level alerts |
| Delivery | Delivery tracking updates |
| Collection | Payment reminders |
| Escalation | Stuck order alerts |
| Quotation | New quotation notifications |
| Schedule | Schedule reminders |
| Stage Transition | All stage change notifications |

---

## 21. Backups

**Path:** `/backup`

Manage database backups and restore points.

### Features
- **Backup List** — Chronological list of all backups
- **Create Backup** — Manually trigger a database backup
- **Download Backup** — Download a backup file
- **Backup Schedule** — Automatic backups run daily via the Supabase Backup Agent
- **Storage** — Backups are stored on Supabase cloud storage

### How to Create a Backup
1. Go to `/backup`
2. Click "Create Backup"
3. Wait for the backup to complete
4. Download the backup file

---

## 22. Vision Upload

**Path:** `/vision`

Upload images for AI-powered analysis and data extraction.

### Features
- **Upload Image** — Upload an image file
- **AI Extraction** — Extract text and data from images using Gemini Vision
- **Extraction Modes:**
  - **Order Items** — Extract order line items from quotation images
  - **Inventory** — Extract inventory item details from product images
- **Share** — Generate a shareable link for an extraction result
- **Upload History** — View past uploads and extraction results

### How to Extract Order Items from an Image
1. Go to `/vision`
2. Upload a quotation image
3. Select "Order Items" mode
4. Click "Extract"
5. Review the extracted items
6. Apply to an order

---

## 23. Settings

**Path:** `/settings`

Manage account settings, password, and tab access.

### Features
- **Profile** — View account information
- **Change Password** — Update your login password
- **Tab Access (Admin Only)** — Admins can configure which tabs each user can see
- **Account Management (Admin Only)** — Create, edit, and delete user accounts
- **Sub-Users** — Manage sub-user accounts with limited access

### How to Change Password
1. Go to `/settings`
2. Click "Change Password"
3. Enter current password and new password
4. Submit

### How to Configure Tab Access (Admin)
1. Go to `/settings`
2. Find the user account
3. Click "Edit Tab Access"
4. Check/uncheck which tabs the user can access
5. Save

---

## 24. Update Logs

**Path:** `/update-logs`

View platform update history, changelog, and bug fixes. (Admin and bot only.)

### Features
- **Changelog** — Chronological list of all code changes and deployments
- **Bug Log** — Tracked bugs with root cause and fix information
- **Update Log** — Real-time work tracking across all coding extensions
- **Filters** — Filter by date, extension, or status
- **Status Badges** — Visual indicators (✅ Done, 🔴 Active, ❌ Failed)

### How to Use
1. Go to `/update-logs`
2. Browse the changelog for recent updates
3. Use filters to find specific entries
4. Click entries for more details

---

## 25. AI Assistant Chat

**Path:** Floating icon (bottom-right of every page)

AI-powered tutorial assistant that answers questions about platform features.

### Features
- **Floating Chat Icon** — Blue gradient button (bottom-right corner) on every page
- **Chat Panel** — 380x520px panel with conversation management
- **Conversation Management** — Create, select, and delete conversations
- **Knowledge Base** — AI searches the platform's knowledge base for accurate answers
- **Suggested Questions** — Quick-start questions on the welcome screen
- **Source Citations** — AI responses cite their knowledge sources
- **Follow-up Suggestions** — After answering, AI suggests related questions
- **Markdown Rendering** — Responses support bold, code blocks, lists, and links

### How to Use
1. Click the floating chat icon (bottom-right of any page)
2. A chat panel opens
3. Type your question about platform features
4. AI searches the knowledge base and responds with step-by-step guidance
5. Click suggested follow-up questions to learn more
6. Use the sidebar to manage multiple conversations

### Example Questions
- "How do I create a new order?"
- "What are the different order stages?"
- "How does the production workflow work?"
- "How do I record a payment?"
- "What is the Telegram bot for?"
- "How do I match inventory items?"
- "How do I generate an acknowledgement receipt?"
- "How do I report a delivery exception?"

---

## Security & Access Control

### Authentication
- **OTP Login** — Login requires email + OTP verification
- **Action Tokens** — Sensitive operations (delete, stage changes, payments) require OTP re-verification
- **Session Management** — Sessions persist in localStorage with automatic re-authentication

### Role-Based Access
- **Admin** — Full access to all features and settings
- **Staff** — Access limited to tabs configured by admin
- **Tab Access Control** — Admins can enable/disable specific tabs per user

### Data Security
- **Action Verification** — All destructive actions require OTP confirmation
- **Payment Verification** — Payments must be verified before they are finalized
- **Audit Trail** — All stage changes and agent actions are logged
- **Backup** — Daily automated database backups

---

## Telegram Bot Integration

The Telegram bot provides real-time notifications and allows interaction with the platform via Telegram.

### Features
- **Group Notifications** — Each stage has a dedicated Telegram group
- **Inline Keyboards** — Interactive buttons for quick actions (approve, reject, view)
- **Stage Updates** — Automatic notifications when orders change stage
- **Reminders** — Automated reminders for pending actions
- **Manual Commands** — Run agents and check order status via Telegram

### How It Works
1. Orders are created and managed on the dashboard
2. Stage changes trigger automatic Telegram notifications
3. Agents send reminders and alerts to the appropriate groups
4. Users can respond via inline keyboard buttons

---

## Item-Level Tracking

Each order item can be individually tracked through the production and delivery process.

### Features
- **Per-Item Status** — Each item has its own production status
- **Start/Finish Individual Items** — Start or finish production on specific items
- **Production Days** — Set estimated production days per item
- **En Route Tracking** — Mark individual items as dispatched
- **Inventory Verification** — Verify individual items upon arrival
- **Arrival Quantity** — Record actual arrived quantity (supports excess arrival)

### How Item Tracking Works
1. When an order enters production, items can be started individually
2. Each item tracks: production status, started at, finished at, production days
3. Items can be finished independently — partial completion is supported
4. When all items are finished, the order advances to stock preparation
5. During delivery, items can be individually marked en route
6. Upon arrival, items are individually verified

---

## Payment Types

### Deposit
- Partial payment recorded against an order
- Can be a percentage or fixed amount
- Deposit slip can be uploaded for verification
- Deposit verification advances the order stage

### Balance Payment
- Remaining amount after deposit
- Requires verification before generating acknowledgement receipt
- Can be paid in full or in installments

### Full Payment
- Single payment covering the entire order amount
- Sets `deposit_is_full_payment = true`
- For standard orders: advances to purchasing_pending (goes through production)
- For from-stock orders: advances to stock_preparation

### Payment Verification
- Payments must be verified by an authorized user
- Verified payments generate acknowledgement receipts
- Unverified payments show "Pending Verification" badge

---

## Exception Handling

### Delivery Exception
- Report when delivery has issues (damaged, lost, delayed)
- Order is flagged with exception status
- Can be revoked when resolved
- Notification sent to delivery Telegram group

### Production Exception
- Report when production encounters issues
- Order is flagged with production exception
- Can be revoked when resolved
- Notification sent to production Telegram group

---

## Excess Arrival Handling

When the actual arrived quantity exceeds the ordered quantity:

1. During inventory verification, enter the actual arrived quantity
2. If arrived > ordered, the excess is automatically added to inventory stock
3. A green badge shows the excess amount (e.g., "+2 → stock")
4. The inventory movement is logged as "excess_arrival"
5. Verified quantity column turns green when excess exists

---

## Stock Replenishment

When inventory runs low:

1. The system can create stock replenishment orders
2. These are tracked separately from client orders
3. Purchasing agent monitors and sends reminders
4. Stock is added to inventory when replenishment arrives
