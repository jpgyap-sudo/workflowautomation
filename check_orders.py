import sys, json, urllib.request

# Check all stages
stages = [
    'production_pending', 'partial_production', 'production_confirmed',
    'en_route', 'inventory_verification', 'inventory_arrived',
    'balance_due', 'balance_verification', 'delivery_scheduled',
    'delivered', 'countered', 'payment_received', 'payment_confirmed',
    'completed'
]

for stage in stages:
    try:
        req = urllib.request.Request(f'http://localhost:8080/orders/stage/{stage}')
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
            if data:
                for o in data:
                    print(f"{o.get('quotation_number','?'):20s} | {str(o.get('client_name','?')):25s} | {stage}")
    except Exception as e:
        print(f"Error fetching {stage}: {e}")
