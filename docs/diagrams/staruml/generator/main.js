// Builds the Carbon Credit Trading Platform design diagrams with StarUML's own
// factory API and saves them as a .mdj project. Run via:
//   StarUML.exe exec empty.mdj -c carbon:build

const F = () => app.factory
const DEFAULT_OUT = 'C:/Users/hrush/OneDrive/Desktop/carbon dating/docs/diagrams/staruml/CarbonPlatform-Diagrams.mdj'

function log(msg) {
  try { require('electron').ipcRenderer.send('console-log', '[carbon] ' + msg) } catch (e) {}
}

function center(v) {
  return { x: v.left + v.width / 2, y: v.top + v.height / 2 }
}

function node(diagram, id, name, x, y, w, h, opts = {}) {
  return F().createModelAndView({
    id,
    parent: opts.parent || diagram._parent,
    diagram,
    x1: x, y1: y, x2: x + w, y2: y + h,
    modelInitializer: (m) => {
      m.name = name
      if (opts.m) opts.m(m)
    },
    viewInitializer: (v) => {
      if (opts.wrap && 'wordWrap' in v) v.wordWrap = true
      if (opts.v) opts.v(v)
    }
  })
}

// opts.via: list of [x, y] bend points between tail and head
function edge(diagram, id, tail, head, name, opts = {}) {
  const a = center(tail), b = center(head)
  return F().createModelAndView({
    id,
    parent: opts.parent || diagram._parent,
    diagram,
    tailView: tail, headView: head,
    tailModel: tail.model, headModel: head.model,
    x1: a.x, y1: a.y, x2: b.x, y2: b.y,
    modelInitializer: (m) => {
      if (name) m.name = name
      if (opts.m) opts.m(m)
    },
    viewInitializer: (v) => {
      v.lineStyle = opts.lineStyle !== undefined ? opts.lineStyle : 1
      if ('showVisibility' in v) v.showVisibility = false
      if (opts.via && opts.via.length) {
        const { Point } = app.type
        opts.via.forEach(([x, y], i) => v.points.insert(1 + i, new Point(x, y)))
      }
      if (opts.v) opts.v(v)
    }
  })
}

function copyOf(diagram, view, x, y, w, h) {
  const v = F().createViewOf({ model: view.model, diagram, x, y })
  v.left = x; v.top = y; v.width = w; v.height = h
  return v
}

function newModel(project, name) {
  return F().createModel({ id: 'UMLModel', parent: project, modelInitializer: (m) => { m.name = name } })
}

function newDiagram(id, parent, name) {
  return F().createDiagram({ id, parent, diagramInitializer: (d) => { d.name = name } })
}

// ── 1. System architecture (deployment view) ────────────────────────────────
function architecture(project) {
  const model = newModel(project, 'Architecture')
  const d = newDiagram('UMLDeploymentDiagram', model, '1 System Architecture')
  const browser = node(d, 'UMLNode', "User's Web Browser", 40, 40, 800, 150)
  const server = node(d, 'UMLNode', 'Application Server (Node.js + Express)', 40, 270, 800, 350)
  const db = node(d, 'UMLNode', 'Database Server (PostgreSQL)', 40, 700, 800, 170)
  const C = (name, x, y, w, h) => node(d, 'UMLComponent', name, x, y, w, h, { wrap: true })
  const nav = C('Page Navigator', 60, 100, 170, 60)
  const screens = C('Screens (9 views)', 255, 100, 170, 60)
  const conn = C('Server Connector', 450, 100, 170, 60)
  const safe = C('Safe Display Helper', 645, 100, 175, 60)
  const gate = C('Request Gatekeeper (CORS, rate limit, login token, role check)', 160, 330, 560, 55)
  const mods = ['Login & Accounts', 'Credit Marketplace', 'Order Book & Matching', 'Companies, Projects & Approvals', 'Emissions & Targets']
    .map((n, i) => C(n, 55 + i * 157, 430, 145, 75))
  const gw = C('Database Gateway', 120, 545, 200, 55)
  const audit = C('Audit Trail Writer', 345, 545, 190, 55)
  C('Web Page Host', 560, 545, 190, 55)
  ;['accounts (auth)', 'registry (projects & credits)', 'trading (orders & trades)', 'compliance (emissions)']
    .forEach((n, i) => node(d, 'UMLArtifact', n, 75 + i * 195, 760, 150, 80))
  edge(d, 'UMLDependency', nav, screens, 'shows')
  edge(d, 'UMLDependency', screens, conn, 'uses', { via: [[340, 175], [535, 175]] })
  edge(d, 'UMLDependency', conn, safe, 'uses')
  edge(d, 'UMLCommunicationPath', browser, server, 'HTTPS / JSON + login token')
  edge(d, 'UMLCommunicationPath', server, db, 'SQL on port 5432 (transactions, row locks)')
  for (const m of mods) {
    edge(d, 'UMLDependency', gate, m, '')
    edge(d, 'UMLDependency', m, gw, '')
  }
  edge(d, 'UMLDependency', gw, audit, 'records')
}

// ── 2. DFD level 0 ──────────────────────────────────────────────────────────
function dfd0(project) {
  const model = newModel(project, 'Data Flow (Level 0)')
  const d = newDiagram('DFDDiagram', model, '2 DFD Level 0 - Context')
  const sys = node(d, 'DFDProcess', 'Carbon Credit Trading Platform', 360, 240, 200, 160, { m: (m) => { m.id = '0' } })
  const buyer = node(d, 'DFDExternalEntity', 'Buyer (company)', 20, 285, 150, 70)
  const seller = node(d, 'DFDExternalEntity', 'Seller (project developer)', 385, 20, 150, 70)
  const admin = node(d, 'DFDExternalEntity', 'Administrator', 385, 560, 150, 60)
  edge(d, 'DFDDataFlow', buyer, sys, 'login, company & KYC data, orders, emissions reports', { via: [[265, 280]] })
  edge(d, 'DFDDataFlow', sys, buyer, 'listings, trade confirmations, portfolio, compliance status', { via: [[265, 360]] })
  edge(d, 'DFDDataFlow', seller, sys, 'projects, credits, sell orders', { via: [[300, 165]] })
  edge(d, 'DFDDataFlow', sys, seller, 'approvals, trades', { via: [[640, 165]] })
  edge(d, 'DFDDataFlow', admin, sys, 'KYC, project & report decisions', { via: [[320, 480]] })
  edge(d, 'DFDDataFlow', sys, admin, 'pending requests, audit trail', { via: [[600, 480]] })
}

// ── 3. DFD level 1 ──────────────────────────────────────────────────────────
function dfd1(project) {
  const model = newModel(project, 'Data Flow (Level 1)')
  const d = newDiagram('DFDDiagram', model, '3 DFD Level 1')
  const Y = [20, 160, 300, 440, 600, 760]
  const P = (id, name, y) => node(d, 'DFDProcess', name, 330, y, 170, 100, { m: (m) => { m.id = id } })
  // One copy of the external entity beside each process (standard DFD practice)
  const user0 = node(d, 'DFDExternalEntity', 'Company User', 20, Y[0] + 20, 140, 60)
  const users = [user0].concat([1, 2, 3, 4].map((i) => copyOf(d, user0, 20, Y[i] + 20, 140, 60)))
  const admin = node(d, 'DFDExternalEntity', 'Administrator', 20, 840, 140, 60)
  const p = [
    P('1.0', 'Sign In', Y[0]), P('2.0', 'Register Company & KYC', Y[1]), P('3.0', 'Manage Projects & Issue Credits', Y[2]),
    P('4.0', 'Place & Match Orders', Y[3]), P('5.0', 'Report Emissions & Set Targets', Y[4])
  ]
  p.push(node(d, 'DFDProcess', 'Review & Oversee', 330, 805, 170, 130, { m: (m) => { m.id = '6.0' } }))
  const D = (id, name, y) => node(d, 'DFDDataStore', name, 640, y, 220, 50, { m: (m) => { m.id = id } })
  const s = {
    d1: D('D1', 'Users', Y[0] + 25), d2: D('D2', 'Companies', Y[1] + 25), d3: D('D3', 'Projects & Credits', Y[2] + 25),
    d4: D('D4', 'Orders & Trades', Y[3] - 5), d5: D('D5', 'Market Prices', Y[3] + 75),
    d6: D('D6', 'Emission Reports & Targets', Y[4] + 25), d7: D('D7', 'Audit Trail', 1010)
  }
  // Duplicate store symbols beside 6.0 keep the review flows short (standard DFD notation).
  // Created before any flow so StarUML does not copy existing flows onto them.
  const d2b = copyOf(d, s.d2, 640, 745, 220, 50)
  const d3b = copyOf(d, s.d3, 640, 835, 220, 50)
  const d6b = copyOf(d, s.d6, 640, 925, 220, 50)
  const f = (a, b, n, via, lineStyle) => edge(d, 'DFDDataFlow', a, b, n, { via, lineStyle })
  const pair = (u, proc, out, back) => {
    const cy = center(proc).y
    f(u, proc, out, [[245, cy - 18]])
    if (back) f(proc, u, back, [[245, cy + 18]])
  }
  pair(users[0], p[0], 'login details', 'login token')
  pair(users[1], p[1], 'company profile')
  pair(users[2], p[2], 'project, credit lot')
  pair(users[3], p[3], 'buy / sell order', 'trades, portfolio')
  pair(users[4], p[4], 'Scope 1/2/3 figures', 'compliance status')
  f(p[0], s.d1, 'check / lock account'); f(p[1], s.d2, 'company (KYC pending)'); f(p[2], s.d3, 'project, credits')
  f(s.d3, p[3], 'credit status'); f(p[3], s.d4, 'orders, trades'); f(p[3], s.d5, 'trade price')
  f(p[4], s.d6, 'report, target')
  pair(admin, p[5], 'decisions', 'pending items')
  f(p[5], d2b, 'KYC status'); f(p[5], d3b, 'project status'); f(p[5], d6b, 'report status')
  f(s.d7, p[5], 'audit trail')
}

// ── 4. Use case diagram ─────────────────────────────────────────────────────
function useCases(project) {
  const model = newModel(project, 'Use Cases')
  const d = newDiagram('UMLUseCaseDiagram', model, '4 Use Cases')
  node(d, 'UMLUseCaseSubject', 'Carbon Credit Trading Platform', 230, 10, 1190, 1010)
  const ux = 110, uy = 470, ax = 1490, ay = 470, R = 420
  const user = node(d, 'UMLActor', 'Company User', ux - 20, uy - 35, 40, 70)
  const buyer = node(d, 'UMLActor', 'Buyer', 20, 220, 40, 70)
  const seller = node(d, 'UMLActor', 'Seller', 20, 860, 40, 70)
  const admin = node(d, 'UMLActor', 'Administrator', ax - 20, ay - 35, 40, 70)
  const U = (name, cx, cy) => node(d, 'UMLUseCase', name, cx - 105, cy - 24, 210, 48)
  const arc = (names, ox, oy, sign, span) => names.map((n, i) => {
    const t = (-span / 2 + (span * i) / (names.length - 1)) * Math.PI / 180
    return U(n, ox + sign * R * Math.cos(t), oy + R * Math.sin(t))
  })
  const login = U('Log In', 820, 60)
  const a = arc(['Register Account', 'Set Up Company Profile', 'Browse & Filter Credits', 'Place Buy / Sell Order',
    'Cancel an Open Order', 'View Portfolio & Trades', 'Submit Emissions Report', 'Set Reduction Target'], ux + 40, uy, 1, 100)
  const b = arc(['Review Company KYC', 'Approve / Reject Projects', 'Review Emissions Reports',
    'Activate / Deactivate Users', 'See All Trades & Audit Trail'], ax - 40, ay, -1, 80)
  const proj = U('Create Carbon Project', 360, 900)
  const issue = U('Issue Carbon Credits', 360, 970)
  const match = U('Match Orders (best price first)', 790, 330)
  const verify = U('Check KYC & Seller Holdings', 790, 420)
  edge(d, 'UMLGeneralization', buyer, user)
  edge(d, 'UMLGeneralization', seller, user)
  edge(d, 'UMLAssociation', user, login, '', { via: [[ux, 60]] })
  for (const uc of a) edge(d, 'UMLAssociation', user, uc)
  edge(d, 'UMLAssociation', seller, proj)
  edge(d, 'UMLAssociation', seller, issue)
  edge(d, 'UMLAssociation', admin, login, '', { via: [[ax, 60]] })
  for (const uc of b) edge(d, 'UMLAssociation', admin, uc)
  edge(d, 'UMLInclude', a[3], match)
  edge(d, 'UMLInclude', a[3], verify)
}

// ── 5. Component diagram ────────────────────────────────────────────────────
function components(project) {
  const model = newModel(project, 'Components')
  const d = newDiagram('UMLComponentDiagram', model, '5 Components')
  node(d, 'UMLPackage', 'Web Browser', 20, 20, 820, 130)
  const nav = node(d, 'UMLComponent', 'Page Navigator', 40, 60, 220, 70)
  const screens = node(d, 'UMLComponent', 'Screens', 310, 60, 220, 70)
  const conn = node(d, 'UMLComponent', 'Server Connector', 580, 60, 240, 70)
  const rest = node(d, 'UMLInterface', 'Web API (JSON)', 680, 200, 40, 40, { v: (v) => { v.stereotypeDisplay = 'icon' } })
  node(d, 'UMLPackage', 'Application Server', 20, 290, 820, 350)
  const gate = node(d, 'UMLComponent', 'Request Gatekeeper', 230, 330, 400, 60)
  const svc = ['Login & Accounts', 'Credit Marketplace', 'Order Book & Matching', 'Companies, Projects & Approvals', 'Emissions & Targets']
    .map((n, i) => node(d, 'UMLComponent', n, 35 + i * 160, 430, 148, 85, { wrap: true }))
  const gw = node(d, 'UMLComponent', 'Database Gateway & Audit Trail', 230, 560, 400, 60)
  const sql = node(d, 'UMLInterface', 'SQL', 410, 680, 40, 40, { v: (v) => { v.stereotypeDisplay = 'icon' } })
  node(d, 'UMLPackage', 'Database Server', 20, 770, 820, 120)
  const db = node(d, 'UMLComponent', 'carbon_credit_platform database', 230, 810, 400, 60)
  edge(d, 'UMLDependency', nav, screens, 'shows')
  edge(d, 'UMLDependency', screens, conn, 'uses')
  edge(d, 'UMLDependency', conn, rest, 'calls')
  edge(d, 'UMLInterfaceRealization', gate, rest, '')
  for (const s of svc) {
    edge(d, 'UMLDependency', gate, s, '')
    edge(d, 'UMLDependency', s, gw, '')
  }
  edge(d, 'UMLDependency', gw, sql, 'calls')
  edge(d, 'UMLInterfaceRealization', db, sql, '')
}

// ── 6. Sequence diagram ─────────────────────────────────────────────────────
function sequence(project) {
  const model = newModel(project, 'Place an Order')
  const d = newDiagram('UMLSequenceDiagram', model, '6 Sequence - Place an Order')
  const inter = d._parent
  inter.name = 'Place an Order'
  const xs = [40, 220, 420, 620, 860]
  const names = ['Buyer', 'Market Screen', 'Request Gatekeeper', 'Order Book & Matching', 'Database']
  const L = names.map((n, i) => F().createModelAndView({
    id: 'UMLLifeline', parent: inter, diagram: d,
    x1: xs[i], y1: 40, x2: xs[i] + 160, y2: 1150,
    modelInitializer: (m) => { m.name = n }
  }))
  let y = 130
  const mid = (v) => v.left + v.width / 2
  const msg = (a, b, name, sort, step = 44) => {
    F().createModelAndView({
      id: 'UMLMessage', parent: inter, diagram: d,
      tailView: L[a], headView: L[b], tailModel: L[a].model, headModel: L[b].model,
      x1: mid(L[a]), y1: y, x2: mid(L[b]), y2: y,
      modelInitializer: (m) => { m.name = name; if (sort) m.messageSort = sort }
    })
    y += step
  }
  const frag = (op, guard, top, bottom) => F().createModelAndView({
    id: 'UMLCombinedFragment', parent: inter, diagram: d,
    x1: 600, y1: top, x2: 1060, y2: bottom,
    modelInitializer: (m) => { m.name = ''; m.interactionOperator = op; m.operands[0].guard = guard }
  })
  msg(0, 1, 'enter order (credit, buy/sell, quantity, price)')
  msg(1, 2, 'POST /api/trading/orders + login token')
  msg(2, 2, 'check token & rate limit', null, 50)
  msg(2, 3, 'place order')
  msg(3, 3, 'check quantity > 0, price > 0', null, 50)
  msg(3, 4, 'BEGIN; read company KYC status')
  msg(3, 4, 'lock the credit row')
  let top = y - 20
  y += 45
  msg(3, 4, 'how many credits can this company sell?')
  msg(4, 3, 'issued + bought - sold - already listed', 'reply')
  frag('alt', 'selling', top, y - 15)
  y += 25
  msg(3, 4, 'save the new order (open)')
  msg(3, 4, 'lock matching orders, best price first')
  top = y - 20
  y += 45
  msg(3, 4, 'save trade at resting price, 0.5% fee')
  msg(3, 4, 'update filled quantity & status of both orders')
  msg(3, 4, 'record new market price')
  frag('loop', 'quantity left and prices cross', top, y - 15)
  y += 25
  msg(3, 4, 'COMMIT')
  msg(3, 4, 'write audit trail entries')
  msg(3, 2, 'order + trades', 'reply')
  msg(2, 1, '201 Created', 'reply')
  msg(1, 0, '"N trade(s) executed"', 'reply')
  // Shorten lifelines and fit the diagram frame around everything
  for (const v of L) v.height = y + 20 - v.top
  for (const v of d.ownedViews) {
    if (v instanceof app.type.UMLFrameView) { v.left = 10; v.top = 5; v.width = 1080; v.height = y + 40 }
  }
}

// ── 7. ER diagram ───────────────────────────────────────────────────────────
function erd(project) {
  const dm = F().createModel({ id: 'ERDDataModel', parent: project, modelInitializer: (m) => { m.name = 'Database' } })
  const d = newDiagram('ERDDiagram', dm, '7 Database (ER Diagram)')
  const E = (name, x, y, cols) => {
    const v = node(d, 'ERDEntity', name, x, y, 230, 40)
    for (const [cn, type, pk, fk] of cols) {
      F().createModel({
        id: 'ERDColumn', parent: v.model, field: 'columns',
        modelInitializer: (c) => { c.name = cn; c.type = type; c.primaryKey = !!pk; c.foreignKey = !!fk }
      })
    }
    return v
  }
  const users = E('users', 20, 20, [['id', 'UUID', 1], ['email', 'VARCHAR'], ['password_hash', 'VARCHAR'], ['role', 'VARCHAR'], ['locked_until', 'TIMESTAMPTZ']])
  const audit = E('audit_log', 320, 20, [['id', 'BIGSERIAL', 1], ['user_id', 'UUID', 0, 1], ['action', 'VARCHAR'], ['table_name', 'VARCHAR'], ['logged_at', 'TIMESTAMPTZ']])
  const prices = E('market_prices', 620, 20, [['id', 'BIGSERIAL', 1], ['credit_id', 'UUID', 0, 1], ['price', 'NUMERIC'], ['volume_24h', 'NUMERIC'], ['recorded_at', 'TIMESTAMPTZ']])
  const comp = E('companies', 20, 280, [['id', 'UUID', 1], ['user_id', 'UUID', 0, 1], ['legal_name', 'VARCHAR'], ['company_type', 'VARCHAR'], ['kyc_status', 'VARCHAR']])
  const proj = E('carbon_projects', 320, 280, [['id', 'UUID', 1], ['company_id', 'UUID', 0, 1], ['project_type', 'VARCHAR'], ['verification_standard', 'VARCHAR'], ['status', 'VARCHAR']])
  const cred = E('carbon_credits', 620, 280, [['id', 'UUID', 1], ['project_id', 'UUID', 0, 1], ['serial_number', 'VARCHAR'], ['vintage_year', 'INTEGER'], ['quantity', 'NUMERIC'], ['price_per_unit', 'NUMERIC']])
  const rep = E('emissions_reports', 20, 560, [['id', 'UUID', 1], ['company_id', 'UUID', 0, 1], ['report_year', 'INTEGER'], ['scope1/2/3_tonnes', 'NUMERIC'], ['status', 'VARCHAR']])
  const orders = E('orders', 320, 560, [['id', 'UUID', 1], ['company_id', 'UUID', 0, 1], ['credit_id', 'UUID', 0, 1], ['order_type', 'VARCHAR'], ['quantity', 'NUMERIC'], ['filled_qty', 'NUMERIC'], ['status', 'VARCHAR']])
  const trades = E('trades', 620, 560, [['id', 'UUID', 1], ['buy_order_id', 'UUID', 0, 1], ['sell_order_id', 'UUID', 0, 1], ['credit_id', 'UUID', 0, 1], ['quantity', 'NUMERIC'], ['trade_price', 'NUMERIC']])
  const tgt = E('emission_targets', 20, 820, [['id', 'UUID', 1], ['company_id', 'UUID', 0, 1], ['target_year', 'INTEGER'], ['reduction_pct', 'NUMERIC']])
  const R = (a, b, c1, c2, via) => edge(d, 'ERDRelationship', a, b, '', {
    lineStyle: 0, via,
    m: (m) => { m.end1.cardinality = c1; m.end2.cardinality = c2 }
  })
  R(users, comp, '1', '0..1'); R(users, audit, '1', '0..*'); R(comp, proj, '1', '0..*'); R(proj, cred, '1', '0..*')
  R(cred, prices, '1', '0..*'); R(comp, orders, '1', '0..*'); R(cred, orders, '1', '0..*'); R(orders, trades, '1', '0..*')
  R(cred, trades, '1', '0..*'); R(comp, rep, '1', '0..*'); R(comp, tgt, '1', '0..*')
}

function build(outPath) {
  const project = app.project.getProject()
  project.name = 'Carbon Credit Trading Platform'
  const steps = { architecture, dfd0, dfd1, useCases, components, sequence, erd }
  for (const [name, fn] of Object.entries(steps)) {
    try {
      fn(project)
      log('built ' + name)
    } catch (err) {
      log('FAILED ' + name + ': ' + (err && err.stack ? err.stack : err))
    }
  }
  app.project.save(outPath)
  log('saved ' + outPath)
}

function init() {
  app.commands.register('carbon:build', (arg) => {
    const out = arg || DEFAULT_OUT
    require('fs').mkdirSync(require('path').dirname(out), { recursive: true })
    try { build(out) } catch (e) { log('build error: ' + (e && e.stack ? e.stack : e)) }
  })
}

exports.init = init
