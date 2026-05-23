# Telegram Callback Data Reference

> Complete inventory of all `callback_data` patterns used across the Quotation Automation System.
> Total: **56 bot.action() handlers** | **24 awaiting_* text states** | **6 agent files** producing callback_data

## Byte Size Rules

- **Hard limit**: 64 bytes per `callback_data` (Telegram API constraint)
- **1 character = 1 byte** (ASCII)
- **UUID shortening**: Always use `.slice(0, 8)` for UUIDs
- **UUID resolution**: Include `quotationNumber` as last segment, resolve full UUID via `getOrderByQuotation()`

## Callback Data Format Legend

```
action:subaction[:param1[:param2[:paramN]]]
```

| Abbreviation | Meaning | Max Length |
|-------------|---------|------------|
| `id8` | 8-char UUID prefix (`.slice(0, 8)`) | 8 |
| `qn` | Quotation number (e.g., `QTN-2026-001`) | variable |
| `full` | Full 36-char UUID | 36 |

## Complete Handler Index

### Menu & Navigation

| Callback Pattern | Handler Line | Description |
|-----------------|-------------|-------------|
| `action:cancel` | 739 | Cancel current operation, reset step |
| `noop` | 893 | No-op button (e.g., "+N more" placeholder) |
| `menu:(action)` | 758 | Main menu dispatcher: `status`, `produce`, `deposit`, `paybalance`, `deliverydate`, `delivered`, `payment`, `link`, `upload`, `clients`, `main` |
| `pick:(action):(qn)` | 899 | Order picker: `status`, `produce`, `deposit`, `paybalance`, `deliverydate`, `delivered`, `payment`, `link`, `bug_order` |
| `clients:list` | 1104 | List all clients |
| `date:(today\|tomorrow\|plus2\|friday\|custom):(qn)` | 1123 | Delivery date picker |
| `skip_remarks:(qn)` | 1192 | Skip optional remarks input |

### Purchasing / Production

| Callback Pattern | Handler Line | Produced By |
|-----------------|-------------|-------------|
| `produce:yes:(id8):(qn)` | 2115 | [`reminderScheduler.ts`](apps/api/src/services/reminderScheduler.ts) |
| `produce:no:(id8):(qn)` | 2115 | [`reminderScheduler.ts`](apps/api/src/services/reminderScheduler.ts) |
| `produce:partial:(id8):(qn)` | 2160 | [`reminderScheduler.ts`](apps/api/src/services/reminderScheduler.ts) |
| `partial_production:update:(id8):(qn)` | 2237 | [`reminderScheduler.ts`](apps/api/src/services/reminderScheduler.ts) |
| `payment:(confirmed\|pending):(qn)` | 2281 | [`reminderScheduler.ts`](apps/api/src/services/reminderScheduler.ts) |

### Production Tracking

| Callback Pattern | Handler Line | Produced By |
|-----------------|-------------|-------------|
| `production:ontime:(id8):(qn)` | 2360 | [`reminderScheduler.ts`](apps/api/src/services/reminderScheduler.ts) |
| `production:delayed:(id8):(qn)` | 2395 | [`reminderScheduler.ts`](apps/api/src/services/reminderScheduler.ts) |
| `production:finished:(id8):(qn)` | 2425 | [`reminderScheduler.ts`](apps/api/src/services/reminderScheduler.ts) |
| `production:not_finished:(id8):(qn)` | 2462 | [`reminderScheduler.ts`](apps/api/src/services/reminderScheduler.ts) |
| `production:delivery_standard:(id8):(qn)` | 2791 | [`bot.ts`](apps/telegram-bot/src/bot.ts) inline |
| `production:delivery_custom:(id8):(qn)` | 2832 | [`bot.ts`](apps/telegram-bot/src/bot.ts) inline |

### Item-Level Production

| Callback Pattern | Handler Line | Produced By |
|-----------------|-------------|-------------|
| `item_prod:(finished\|in_progress\|pending):(id8):(qn)` | 2514 | [`productionAgent.ts`](apps/api/src/agents/productionAgent.ts), [`bot.ts`](apps/telegram-bot/src/bot.ts) inline |
| `item_en_route:(yes\|no\|arrived):(id8):(qn)` | 2660 | [`productionAgent.ts`](apps/api/src/agents/productionAgent.ts), [`bot.ts`](apps/telegram-bot/src/bot.ts) inline |

### En Route

| Callback Pattern | Handler Line | Produced By |
|-----------------|-------------|-------------|
| `en_route:yes:(id8):(qn)` | 2867 | [`reminderScheduler.ts`](apps/api/src/services/reminderScheduler.ts) |
| `en_route:no:(id8):(qn)` | 2904 | [`reminderScheduler.ts`](apps/api/src/services/reminderScheduler.ts) |
| `en_route:arrival_standard:(id8):(qn)` | 2926 | [`bot.ts`](apps/telegram-bot/src/bot.ts) inline |
| `en_route:arrival_custom:(id8):(qn)` | 2960 | [`bot.ts`](apps/telegram-bot/src/bot.ts) inline |

### Inventory Arrival

| Callback Pattern | Handler Line | Produced By |
|-----------------|-------------|-------------|
| `inv_arr:(yes\|no\|partial):(qn)` | 3019 | [`reminderScheduler.ts`](apps/api/src/services/reminderScheduler.ts) |
| `inv_ready:(qn)` | 3103 | [`bot.ts`](apps/telegram-bot/src/bot.ts) inline |
| `inv_wait:(qn)` | 3147 | [`bot.ts`](apps/telegram-bot/src/bot.ts) inline |
| `inventory:ready:(id8):(qn)` | 3163 | [`bot.ts`](apps/telegram-bot/src/bot.ts) inline |
| `inventory:waiting:(id8):(qn)` | 3224 | [`bot.ts`](apps/telegram-bot/src/bot.ts) inline |

### Inventory Verification

| Callback Pattern | Handler Line | Produced By |
|-----------------|-------------|-------------|
| `inv_verify:(all\|partial\|not_yet):(id8):(id8):(qn)` | 3258 | [`inventoryAgent.ts`](apps/api/src/agents/inventoryAgent.ts), [`bot.ts`](apps/telegram-bot/src/bot.ts) inline |
| `inv_v:comp:(full):(id8)` | 3360 | [`bot.ts`](apps/telegram-bot/src/bot.ts) inline |
| `inv_verify:complete:(id8):(qn)` | 3360 | [`escalationAgent.ts`](apps/api/src/agents/escalationAgent.ts) |
| `inv_v:rev:(full):(id8)` | 3424 | [`bot.ts`](apps/telegram-bot/src/bot.ts) inline |
| `inv_verify:review:(id8):(qn)` | 3424 | [`bot.ts`](apps/telegram-bot/src/bot.ts) inline |
| `inv_verify:pending:(id8):(qn)` | 3478 | [`escalationAgent.ts`](apps/api/src/agents/escalationAgent.ts) |

### Item-Level Inventory

| Callback Pattern | Handler Line | Produced By |
|-----------------|-------------|-------------|
| `item_inventory:(arrived\|en_route\|not_yet):(id8):(qn)` | 3502 | [`bot.ts`](apps/telegram-bot/src/bot.ts) inline |

### Reminder Item-Level

| Callback Pattern | Handler Line | Produced By |
|-----------------|-------------|-------------|
| `reminder:item_prod:(finished\|in_progress\|pending):(id8):(id8):(qn)` | 3641 | [`reminderScheduler.ts`](apps/api/src/services/reminderScheduler.ts) |
| `reminder:item_en_route:(en_route\|arrived\|not_yet):(id8):(id8):(qn)` | 3717 | [`reminderScheduler.ts`](apps/api/src/services/reminderScheduler.ts) |

### Balance & Payment

| Callback Pattern | Handler Line | Produced By |
|-----------------|-------------|-------------|
| `balance:paid:(id8):(qn)` | 3795 | [`reminderScheduler.ts`](apps/api/src/services/reminderScheduler.ts) |
| `balance:not_paid:(id8):(qn)` | 3820 | [`reminderScheduler.ts`](apps/api/src/services/reminderScheduler.ts) |
| `balance:confirm_yes:(full)` | 4562 | [`bot.ts`](apps/telegram-bot/src/bot.ts) inline |
| `verify:deposit:(id8):(qn)` | 4680 | [`reminderScheduler.ts`](apps/api/src/services/reminderScheduler.ts) |
| `verify:balance:(id8):(qn)` | 4752 | [`reminderScheduler.ts`](apps/api/src/services/reminderScheduler.ts) |

### Delivery

| Callback Pattern | Handler Line | Produced By |
|-----------------|-------------|-------------|
| `delivery:schedule:(id8):(qn)` | 3844 | [`deliveryAgent.ts`](apps/api/src/agents/deliveryAgent.ts) |
| `delivery:yes:(id8):(qn)` | 3859 | [`deliveryAgent.ts`](apps/api/src/agents/deliveryAgent.ts), [`reminderScheduler.ts`](apps/api/src/services/reminderScheduler.ts) |
| `delivery:no:(id8):(qn)` | 3902 | [`deliveryAgent.ts`](apps/api/src/agents/deliveryAgent.ts), [`reminderScheduler.ts`](apps/api/src/services/reminderScheduler.ts) |

### Deposit

| Callback Pattern | Handler Line | Produced By |
|-----------------|-------------|-------------|
| `deposit:yes:(id8):(qn)` | 4448 | [`collectionAgent.ts`](apps/api/src/agents/collectionAgent.ts), [`reminderScheduler.ts`](apps/api/src/services/reminderScheduler.ts) |
| `deposit:no:(id8):(qn)` | 4469 | [`collectionAgent.ts`](apps/api/src/agents/collectionAgent.ts), [`reminderScheduler.ts`](apps/api/src/services/reminderScheduler.ts) |
| `deposit:confirm_yes:(full)` | 4483 | [`bot.ts`](apps/telegram-bot/src/bot.ts) inline |
| `deposit:confirm_no` | 4637 | [`bot.ts`](apps/telegram-bot/src/bot.ts) inline |

### Vision / Extraction

| Callback Pattern | Handler Line | Description |
|-----------------|-------------|-------------|
| `vision:type_quotation` | 3932 | User says document is a quotation |
| `vision:type_deposit` | 3968 | User says document is a deposit slip |
| `vision:process_yes` | 4003 | User confirms to process the order |
| `vision:process_no` | 4049 | User declines to process |
| `vision:extract_yes` | 4067 | User confirms extraction |
| `vision:upload` | 4822 | Upload to Google Drive instead |
| `vision:ignore` | 4979 | Do nothing with the document |
| `vision:retry_extract` | 4997 | Retry vision extraction after failure |
| `upload:retry` | 4897 | Retry file upload |

## Awaiting Text States

These are the 24 text input states in the `message('text')` handler (line 1222):

| State | Line | Input Expected |
|-------|------|----------------|
| `awaiting_order_number_for_status` | 1250 | Quotation number |
| `awaiting_order_number_for_produce` | 1300 | Quotation number |
| `awaiting_produce_remarks` | 1325 | Production remarks text |
| `awaiting_order_number_for_deposit` | 1363 | Quotation number |
| `awaiting_deposit_amount` | 1389 | Deposit amount (number) |
| `awaiting_order_number_for_paybalance` | 1421 | Quotation number |
| `awaiting_paybalance_amount` | 1447 | Balance amount (number) |
| `awaiting_order_number_for_delivered` | 1493 | Quotation number |
| `awaiting_delivery_date` | 1533 | Free-text delivery date |
| `awaiting_order_number_for_mark_delivered` | 1560 | Quotation number |
| `awaiting_delivered_remarks` | 1593 | Delivery remarks text |
| `awaiting_order_number_for_payment` | 1620 | Quotation number |
| `awaiting_order_number_for_link` | 1654 | Quotation number |
| `awaiting_deposit_client_name` | 1675 | Client name |
| `awaiting_client_search` | 1758 | Search text |
| `awaiting_delay_days` | 1799 | Number of delay days |
| `awaiting_custom_delivery_days` | 1823 | Custom delivery days |
| `awaiting_en_route_arrival_days` | 1853 | Arrival days |
| `awaiting_partial_missing_items` | 1877 | Missing items list |
| `awaiting_partial_items_update` | 1903 | Updated items list |
| `awaiting_inv_verify_qty` | 1955 | Partial verification quantity |
| `awaiting_bug_title` | 2024 | Bug report title |
| `awaiting_bug_description` | 2038 | Bug report description |
| `awaiting_bug_order_pick` | 2078 | Bug report order selection |

## Agent → Callback Data Mapping

| Agent File | Callback Prefixes | bot.ts Handler Lines |
|-----------|------------------|---------------------|
| [`productionAgent.ts`](apps/api/src/agents/productionAgent.ts) | `item_prod:*`, `item_en_route:*` | 2514, 2660 |
| [`inventoryAgent.ts`](apps/api/src/agents/inventoryAgent.ts) | `inv_verify:*` | 3258 |
| [`collectionAgent.ts`](apps/api/src/agents/collectionAgent.ts) | `deposit:*` | 4448, 4469 |
| [`deliveryAgent.ts`](apps/api/src/agents/deliveryAgent.ts) | `delivery:*` | 3844, 3859, 3902 |
| [`escalationAgent.ts`](apps/api/src/agents/escalationAgent.ts) | `inv_verify:complete:*`, `inv_verify:pending:*` | 3360, 3478 |
| [`reminderScheduler.ts`](apps/api/src/services/reminderScheduler.ts) | `produce:*`, `production:*`, `en_route:*`, `inv_arr:*`, `balance:*`, `payment:*`, `delivery:*`, `deposit:*`, `verify:*`, `reminder:*` | Multiple |

## Byte Size Verification

When adding or modifying callback_data, verify the byte size:

```typescript
// Helper to calculate byte length
function cbSize(str: string): number {
  return new TextEncoder().encode(str).length;
}

// Example verification
const data = `inv_verify:all:${itemId.slice(0, 8)}:${orderId.slice(0, 8)}:${qn}`;
console.log(cbSize(data)); // Must be ≤ 64
```
