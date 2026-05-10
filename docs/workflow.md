# Workflow

## 1. Quotation received

Sales forwards approved quotation to Purchasing Telegram group.

Bot:
- uploads file to Google Drive,
- creates order record,
- checks quotation math,
- starts purchasing reminder.

## 2. Purchasing / production

Daily reminder asks if production or purchasing has started.

Example reply:

```txt
/produce QTN-2026-001 yes 10 days
```

## 3. Inventory arrival

Inventory sends arrival photos/files.

Bot asks which quotation/order it belongs to.

Then inventory replies with order number and expected delivery date.

```txt
/deliverydate QTN-2026-001 May 22 2026
```

## 4. Delivery

Delivery team sends delivery photos/DR.

```txt
/delivered QTN-2026-001 yes countered
```

If not countered, reminders continue.

## 5. Collection

Collection team sends deposit slip/proof of payment.

```txt
/payment QTN-2026-001 confirmed
```

When confirmed, order becomes completed.

## Stages

```txt
quotation_received
math_verified
purchasing_pending
production_confirmed
inventory_arrived
delivery_scheduled
delivered
countered
payment_received
payment_confirmed
completed
```
