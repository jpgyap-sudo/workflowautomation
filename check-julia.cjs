const { query } = require('./db.js');
query(`SELECT quotation_number, client_name, current_stage, balance_paid, balance_verified FROM orders WHERE client_name ILIKE '%julia%' ORDER BY created_at DESC LIMIT 5`)
  .then(r => console.log(JSON.stringify(r, null, 2)))
  .catch(e => console.error(e));
