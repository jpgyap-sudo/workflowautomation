import { Telegraf } from 'telegraf';
import { uploadToDrive } from './services/googleDrive.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:8080';

if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

const bot = new Telegraf(token);

async function postJson(path: string, body: unknown) {
  const res = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getJson(path: string) {
  const res = await fetch(`${apiBaseUrl}${path}`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── In-memory order context per chat ─────────────────────────────────
// Maps chatId -> quotation_number so file uploads know which order to link to
const chatOrderContext = new Map<string, string>();

bot.start((ctx) => ctx.reply('Quotation Automation Bot is active.'));

bot.command('status', async (ctx) => {
  const quotationNumber = ctx.message.text.split(' ')[1];
  if (!quotationNumber) return ctx.reply('Usage: /status QTN-2026-001');
  const res = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(quotationNumber)}`);
  if (!res.ok) return ctx.reply('Order not found.');
  const order: any = await res.json();
  const totalAmount = Number(order.total_amount ?? 0);
  const depositAmount = Number(order.deposit_amount ?? 0);
  const balance = totalAmount - depositAmount;
  let msg =
    `📋 *${order.quotation_number}*\n` +
    `Stage: ${order.current_stage}\n` +
    `Status: ${order.status}\n` +
    `Math: ${order.math_status}\n` +
    `Total: ₱${totalAmount.toLocaleString()}\n` +
    `Deposit: ${order.deposit_paid ? `✅ ₱${depositAmount.toLocaleString()}` : '⏳ Pending'}\n` +
    `Balance: ${order.balance_paid ? '✅ Paid' : `⏳ ₱${balance.toLocaleString()}`}`;
  return ctx.reply(msg);
});

bot.command('produce', async (ctx) => {
  // Example: /produce QTN-2026-001 yes 10 days
  const [, quotation_number, status, ...remarks] = ctx.message.text.split(' ');
  if (!quotation_number || !status) return ctx.reply('Usage: /produce QTN-2026-001 yes 10 days');
  await postJson('/stage-updates', {
    quotation_number,
    stage: 'production_confirmed',
    status,
    remarks: remarks.join(' '),
    updated_by: ctx.from?.username ?? String(ctx.from?.id),
  });
  return ctx.reply(`✅ Purchasing update saved for ${quotation_number}.`);
});

bot.command('deliverydate', async (ctx) => {
  const [, quotation_number, ...dateParts] = ctx.message.text.split(' ');
  if (!quotation_number || dateParts.length === 0)
    return ctx.reply('Usage: /deliverydate QTN-2026-001 May 22 2026');

  // Check if balance is paid before allowing delivery scheduling
  try {
    const order: any = await getJson(`/orders/${encodeURIComponent(quotation_number)}`);
    const totalAmount = Number(order.total_amount ?? 0);
    const depositAmount = Number(order.deposit_amount ?? 0);
    const balance = totalAmount - depositAmount;

    if (order.total_amount == null) {
      return ctx.reply(
        `❌ *Total amount not set for ${quotation_number}*\n\n` +
        `Please set the total amount before scheduling delivery.`
      );
    }

    if (!order.balance_paid && balance > 0) {
      return ctx.reply(
        `❌ *Balance not yet paid for ${quotation_number}*\n\n` +
        `Total Amount: ₱${totalAmount.toLocaleString()}\n` +
        `Deposit Paid: ₱${depositAmount.toLocaleString()}\n` +
        `Balance Due: ₱${balance.toLocaleString()}\n\n` +
        `Please record the balance payment first using:\n` +
        `/paybalance ${quotation_number} [amount]\n\n` +
        `Delivery scheduling is blocked until the balance is fully paid.`
      );
    }
  } catch {
    return ctx.reply(`Order ${quotation_number} not found.`);
  }

  await postJson('/stage-updates', {
    quotation_number,
    stage: 'delivery_scheduled',
    status: 'scheduled',
    remarks: dateParts.join(' '),
    updated_by: ctx.from?.username ?? String(ctx.from?.id),
  });
  return ctx.reply(`🚚 Delivery date saved for ${quotation_number}.`);
});

bot.command('delivered', async (ctx) => {
  const [, quotation_number, ...remarks] = ctx.message.text.split(' ');
  if (!quotation_number) return ctx.reply('Usage: /delivered QTN-2026-001 yes countered');
  await postJson('/stage-updates', {
    quotation_number,
    stage: 'delivered',
    status: 'delivered',
    remarks: remarks.join(' '),
    updated_by: ctx.from?.username ?? String(ctx.from?.id),
  });
  return ctx.reply(`✅ Delivery update saved for ${quotation_number}.`);
});

bot.command('payment', async (ctx) => {
  const [, quotation_number, ...remarks] = ctx.message.text.split(' ');
  if (!quotation_number) return ctx.reply('Usage: /payment QTN-2026-001 confirmed');
  await postJson('/stage-updates', {
    quotation_number,
    stage: remarks.includes('confirmed') ? 'payment_confirmed' : 'payment_pending',
    status: remarks.join(' ') || 'pending',
    updated_by: ctx.from?.username ?? String(ctx.from?.id),
  });
  return ctx.reply(`💰 Payment update saved for ${quotation_number}.`);
});

/**
 * /deposit QTN-2026-001 5000
 * Record a deposit payment for an order.
 * Marks deposit_paid=TRUE and records the deposit amount.
 * Optionally attach a deposit slip image before or after using /link.
 */
bot.command('deposit', async (ctx) => {
  const [, quotation_number, amountStr, ...remarks] = ctx.message.text.split(' ');
  if (!quotation_number || !amountStr) {
    return ctx.reply(
      'Usage: /deposit QTN-2026-001 5000 [optional remarks]\n\n' +
      'You can also send a deposit slip image after linking the order with /link.'
    );
  }
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    return ctx.reply('❌ Invalid amount. Please provide a positive number.');
  }
  await postJson('/deposits', {
    quotation_number,
    amount,
    updated_by: ctx.from?.username ?? String(ctx.from?.id),
  });
  return ctx.reply(`✅ Deposit of ₱${amount.toLocaleString()} recorded for ${quotation_number}. Production can now proceed.`);
});

/**
 * /paybalance QTN-2026-001 15000
 * Record the balance payment (total_amount - deposit_amount) for an order.
 * Marks balance_paid=TRUE and records the payment timestamp.
 * Delivery scheduling (/deliverydate) is blocked until balance is paid.
 */
bot.command('paybalance', async (ctx) => {
  const [, quotation_number, amountStr, ...remarks] = ctx.message.text.split(' ');
  if (!quotation_number || !amountStr) {
    return ctx.reply(
      'Usage: /paybalance QTN-2026-001 15000 [optional remarks]\n\n' +
      'Records the remaining balance payment before delivery can be scheduled.'
    );
  }
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    return ctx.reply('❌ Invalid amount. Please provide a positive number.');
  }
  try {
    const result: any = await postJson('/pay-balance', {
      quotation_number,
      amount,
      updated_by: ctx.from?.username ?? String(ctx.from?.id),
    });
    let msg = `✅ Balance payment of ₱${amount.toLocaleString()} recorded for ${quotation_number}.`;
    if (result.overpayment > 0) {
      msg += `\n⚠️ Overpayment of ₱${result.overpayment.toLocaleString()}.`;
    }
    msg += `\n🚚 You can now schedule delivery using /deliverydate.`;
    return ctx.reply(msg);
  } catch (err: any) {
    const errorData = err?.response?.data;
    if (errorData?.lacking_amount) {
      return ctx.reply(
        `❌ Insufficient payment for ${quotation_number}\n\n` +
        `Expected balance: ₱${Number(errorData.expected_balance).toLocaleString()}\n` +
        `Received: ₱${amount.toLocaleString()}\n` +
        `Still lacking: ₱${Number(errorData.lacking_amount).toLocaleString()}\n\n` +
        `Please pay the full remaining balance.`
      );
    }
    return ctx.reply(`❌ Error recording balance payment: ${errorData?.error ?? 'Unknown error'}`);
  }
});

/**
 * /link QTN-2026-001
 * Set the active order context for this chat so subsequent file uploads
 * are linked to the correct order.
 */
bot.command('link', async (ctx) => {
  const chatId = String(ctx.chat.id);
  const quotationNumber = ctx.message.text.split(' ')[1];
  if (!quotationNumber) return ctx.reply('Usage: /link QTN-2026-001');

  // Verify order exists
  try {
    const order: any = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
    chatOrderContext.set(chatId, order.quotation_number);
    return ctx.reply(`🔗 Now linked to order ${order.quotation_number}. Uploaded files will be attached to this order.`);
  } catch {
    return ctx.reply(`Order ${quotationNumber} not found.`);
  }
});

/**
 * /unlink
 * Clear the active order context for this chat.
 */
bot.command('unlink', async (ctx) => {
  const chatId = String(ctx.chat.id);
  chatOrderContext.delete(chatId);
  return ctx.reply('🔗 Order context cleared. Files will not be linked to any order.');
});

// ── File Upload Handler ──────────────────────────────────────────────
// Handles documents (PDFs, images, etc.) and photos sent to the bot.
// Downloads the file from Telegram, uploads it to Google Drive,
// and links it to the active order (if set via /link).

bot.on(['document', 'photo'], async (ctx) => {
  const chatId = String(ctx.chat.id);
  const messageId = String(ctx.message.message_id);
  const from = ctx.from?.username ?? String(ctx.from?.id);

  // Determine file info using type-safe narrowing
  let fileId: string;
  let fileName: string;
  let mimeType: string;

  const msg = ctx.message as any;
  if (msg.document) {
    fileId = msg.document.file_id;
    fileName = msg.document.file_name ?? `document_${Date.now()}`;
    mimeType = msg.document.mime_type ?? 'application/octet-stream';
  } else if (msg.photo) {
    // Get the largest photo (last in array)
    const photo = msg.photo[msg.photo.length - 1];
    fileId = photo.file_id;
    fileName = `photo_${Date.now()}.jpg`;
    mimeType = 'image/jpeg';
  } else {
    return ctx.reply('❌ Unsupported file type.');
  }

  await ctx.reply(`📎 Downloading ${fileName}...`);

  try {
    // Step 1: Download file from Telegram
    const link = await ctx.telegram.getFileLink(fileId);
    const response = await fetch(link.href);
    if (!response.ok) throw new Error(`Telegram download failed: ${response.status}`);
    const fileBuffer = Buffer.from(await response.arrayBuffer());

    await ctx.reply(`📤 Uploading to Google Drive...`);

    // Step 2: Upload to Google Drive
    const quotationNumber = chatOrderContext.get(chatId);
    const driveResult = await uploadToDrive(fileBuffer, fileName, mimeType);

    // Step 3: Store reference in API database
    const payload: Record<string, unknown> = {
      file_type: mimeType,
      original_filename: fileName,
      mime_type: mimeType,
      file_data: fileBuffer.toString('base64'),
      telegram_chat_id: chatId,
      telegram_message_id: messageId,
      uploaded_by: from,
    };

    if (quotationNumber) {
      payload.quotation_number = quotationNumber;
    }

    const apiResult: any = await postJson('/drive/upload', payload);

    await ctx.reply(
      `✅ File uploaded to Google Drive!\n📄 ${fileName}\n🔗 ${driveResult.webViewLink}` +
        (quotationNumber ? `\n📦 Linked to order: ${quotationNumber}` : '')
    );
  } catch (error: any) {
    console.error('Upload error:', error);
    await ctx.reply(`❌ Upload failed: ${error.message}`);
  }
});

bot.launch();
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
