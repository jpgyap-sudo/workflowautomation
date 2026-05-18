# Dashboard

Next.js dashboard for the Quotation Automation System. ERPNext-inspired UI for tracking orders through the full quotation → purchasing → inventory → delivery → collection workflow.

## Pages

| Route | Description |
|---|---|
| `/` | Dashboard overview with stats cards and stage pipeline chart |
| `/orders` | All orders with filtering by status/stage |
| `/orders/[quotationNumber]` | Order detail with stage progress timeline |
| `/purchasing` | Purchasing & Production tracking |
| `/inventory` | Inventory arrival tracking |
| `/delivery` | Delivery scheduling & tracking |
| `/collection` | Counter & Collection tracking |
| `/stages` | Full stage pipeline visualization |
| `/logs` | Agent execution logs |

## Development

```bash
npm run dev
```

The dev server runs on `http://localhost:3000` and expects the API at `http://localhost:8080`.

Set `NEXT_PUBLIC_API_URL` env var to change the API endpoint.

## Production (Docker)

Built as part of `docker compose up -d --build`. Serves on port 3000.
