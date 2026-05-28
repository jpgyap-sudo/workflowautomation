-- Rename delivery_invoice columns to delivery_receipt in payment_counter table
-- This aligns the DB column names with the frontend variable names (deliveryReceiptStatus)

ALTER TABLE payment_counter RENAME COLUMN delivery_invoice_status TO delivery_receipt_status;
ALTER TABLE payment_counter RENAME COLUMN delivery_invoice_file_id TO delivery_receipt_file_id;
