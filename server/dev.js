const { createServer } = require('node:http');
const { BlockList, isIPv4 } = require('node:net');
const { randomBytes } = require('node:crypto');
const { DatabaseSync, backup } = require('node:sqlite');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const domain = require('../miniprogram/utils/domain');
const { SEED_STATE, STAFF, SUPPLIERS } = require('../miniprogram/data/seed');

const directory = resolve(process.env.AJLY_DEV_DATA || join(__dirname, '../../ajly-dev-data'));
mkdirSync(directory, { recursive: true });
const database = new DatabaseSync(join(directory, 'purchase-dev.sqlite'));
database.exec(`
  PRAGMA busy_timeout = 5000;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS purchase_state (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    body TEXT NOT NULL CHECK(json_valid(body))
  ) STRICT;
`);
const initial = { ...SEED_STATE, orders: [], recons: [], seq: 0 };
database.prepare('INSERT OR IGNORE INTO purchase_state VALUES (1, ?)').run(JSON.stringify(initial));
const load = () => JSON.parse(database.prepare('SELECT body FROM purchase_state WHERE id = 1').get().body);

const actions = new Map([
  ['approve', [['region', 'central'], domain.approveOrder]],
  ['supplier-ack', [['supplier'], domain.supplierAck]],
  ['deliver', [['supplier'], domain.supplierDeliver]],
  ['accept', [['store'], domain.acceptDelivery]],
  ['settlement', [['store'], domain.submitSettlement]],
  ['settlement-confirm', [['supplier'], domain.settleAction]],
  ['reconciliation', [['central'], domain.createReconciliation]],
  ['reconciliation-update', [['central', 'supplier'], domain.reconAction]]
]);

function persist(apply) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const state = load();
    const result = apply(state);
    const audit = result.audits || (result.audit ? [result.audit] : []);
    state.serverAudit = (state.serverAudit || []).concat(audit);
    state.revision += 1;
    database.prepare('UPDATE purchase_state SET body = ? WHERE id = 1').run(JSON.stringify(state));
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

async function main() {
  if (process.argv[2] === 'backup') {
    const destination = join(directory, 'purchase-backup-' + randomBytes(8).toString('hex') + '.sqlite');
    await backup(database, destination);
    const copy = new DatabaseSync(destination, { readOnly: true });
    try {
      if (copy.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') {
        throw new Error('Backup integrity check failed');
      }
    } finally {
      copy.close();
      database.close();
    }
    console.log(destination);
    return;
  }

  const credentialPath = join(directory, 'dev-credentials.json');
  try {
    writeFileSync(credentialPath, JSON.stringify({
      'TEST-STORE-A': randomBytes(32).toString('hex'),
      'TEST-CENTRAL': randomBytes(32).toString('hex')
    }, null, 2), { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const credentials = JSON.parse(readFileSync(credentialPath, 'utf8'));
  const supplier = { id: 'TEST-SUPPLIER-1', name: SUPPLIERS[0], role: 'supplier', supplier: SUPPLIERS[0] };
  const workflowCredentials = join(directory, 'workflow-credentials.json');
  try {
    writeFileSync(workflowCredentials, JSON.stringify({
      'TEST-REGION-A': randomBytes(32).toString('hex'),
      [supplier.id]: randomBytes(32).toString('hex')
    }, null, 2), { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  Object.assign(credentials, JSON.parse(readFileSync(workflowCredentials, 'utf8')));
  const actors = new Map(Object.entries(credentials).map(([id, token]) =>
    ['Bearer ' + token, [...STAFF, supplier].find(profile => profile.id === id)]
  ));

  return async (request, response) => {
    const send = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(value));
    };
    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      return response.end(readFileSync(join(__dirname, 'orders.html')));
    }
    const actor = actors.get(request.headers.authorization);
    if (!actor) return send(401, { error: 'Authentication required' });
    const url = new URL(request.url, 'http://localhost');
    const isOrders = url.pathname === '/api/orders';
    if (url.pathname === '/api/account') {
      if (request.method !== 'GET') return send(405, { error: 'Unsupported method' });
      return send(200, { role: actor.role, stores: actor.role === 'store' ? actor.stores : [] });
    }
    const workflowPrefix = '/api/workflow/';
    const action = request.url.startsWith(workflowPrefix) && actions.get(request.url.slice(workflowPrefix.length));
    if (!isOrders && !action) return send(404, { error: 'Unknown endpoint' });
    if (isOrders && request.method === 'GET') {
      const store = url.searchParams.get('store');
      if (store !== null && actor.role === 'store' && !actor.stores.includes(store)) {
        return send(403, { error: 'Store is outside account scope' });
      }
      const visible = domain.visibleOrders(load(), actor);
      const rows = store === null ? visible : visible.filter(order => order.store === store);
      return send(200, actor.role === 'supplier'
        ? rows.map(({ id, store, status }) => ({ id, store, status }))
        : rows);
    }
    if (request.method !== 'POST') return send(405, { error: 'Unsupported method' });
    if (!(isOrders ? actor.role === 'store' : action[0].includes(actor.role))) {
      return send(403, { error: 'Role cannot perform this operation' });
    }

    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > (request.url === '/api/workflow/accept' ? 1500000 : 65536)) {
          response.setHeader('Connection', 'close');
          return send(413, { error: 'Request is too large' });
        }
        chunks.push(chunk);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!isOrders) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          return send(400, { error: 'Invalid workflow input' });
        }
        if (request.url === '/api/workflow/accept' &&
            !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(data.photoPath || '')) {
          return send(400, { error: '请上传 JPEG、PNG 或 WebP 验收照片' });
        }
        const result = persist(state => action[1](state, actor, data));
        return send(200, {
          order: result.order && { id: result.order.id, status: result.order.status },
          reconciliation: result.recon && { id: result.recon.id, status: result.recon.status }
        });
      }
      if (!data || typeof data.store !== 'string' || !Array.isArray(data.items) ||
          !data.items.every(item => item && typeof item.id === 'string' && Number.isSafeInteger(item.qty) && item.qty > 0)) {
        return send(400, { error: 'Invalid order' });
      }
      if (!actor.stores.includes(data.store)) return send(403, { error: 'Store is outside account scope' });
      return send(201, persist(state => domain.createStoreOrder(state, actor, data)).order);
    } catch (error) {
      if (error.code && error.code.startsWith('ERR_SQLITE')) {
        console.error(error);
        return send(503, { error: 'Database operation failed' });
      }
      return send(400, { error: error.message });
    }
  };
}

if (require.main === module) {
  main().then(handler => {
    if (!handler) return;
    const lanTrial = process.env.AJLY_LAN_TRIAL === '1';
    const host = lanTrial ? process.env.AJLY_LAN_HOST : '127.0.0.1';
    const allowed = new BlockList();
    if (lanTrial) {
      if (!host || !isIPv4(host) || host === '0.0.0.0') throw new Error('Set AJLY_LAN_HOST to a specific IPv4 address');
      const [network, bits, extra] = (process.env.AJLY_LAN_CIDR || '').split('/');
      if (!isIPv4(network) || !/^\d+$/.test(bits || '') || Number(bits) < 1 || Number(bits) > 32 || extra !== undefined) {
        throw new Error('Set AJLY_LAN_CIDR to the authorized IPv4 subnet');
      }
      allowed.addSubnet(network, Number(bits), 'ipv4');
    }
    const server = createServer((request, response) => {
      if (lanTrial && !allowed.check(request.socket.remoteAddress || '', 'ipv4')) {
        response.writeHead(403).end();
        return;
      }
      handler(request, response).catch(error => {
        console.error(error);
        if (response.headersSent) response.destroy();
        else response.writeHead(500).end();
      });
    });
    server.on('error', error => {
      console.error('AJLY could not start on ' + host + ': ' + error.message);
      process.exitCode = 1;
      database.close();
    });
    server.listen(Number(process.env.AJLY_DEV_PORT || 3000), host, function () {
      console.log('AJLY development API listening on ' + host + ':' + this.address().port);
    });
  }).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = main;
