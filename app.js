  // ── Configure your sheet here ──
  const SHEET_ID = '1q4EhX1RNMWXooqszhMz_X9if9Qyj3zRZ-8BcXwHLy7Y';
  const SHEET_NAME = 'Sheet1';
  const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;

  let allEntries = [];
  let selectedPeople = new Set(); // empty set = "All"

  function parseCSV(text) {
    // Simple CSV parser handling quoted fields with commas
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i], next = text[i + 1];
      if (inQuotes) {
        if (c === '"' && next === '"') { field += '"'; i++; }
        else if (c === '"') { inQuotes = false; }
        else { field += c; }
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\r') { /* skip */ }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else { field += c; }
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function parseNumber(v) {
    if (!v) return 0;
    const cleaned = String(v).replace(/[₹,\s]/g, '');
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  }

  function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();

  // gviz "Date(2026,6,15)" format
  const gvizMatch = s.match(/Date\((\d+),(\d+),(\d+)\)/);
  if (gvizMatch) {
    return new Date(+gvizMatch[1], +gvizMatch[2], +gvizMatch[3]);
  }

  // MM/DD/YYYY or MM-DD-YYYY
  const mdyMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (mdyMatch) {
    let [, month, day, year] = mdyMatch;
    if (year.length === 2) year = '20' + year;
    const d = new Date(+year, +month - 1, +day);
    return isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

  function daysUntil(dateObj) {
    const today = new Date(); today.setHours(0,0,0,0);
    const t = new Date(dateObj); t.setHours(0,0,0,0);
    return Math.round((t - today) / 86400000);
  }

  function fmtDate(d) {
    if (!d) return '—';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  }

  function fmtRs(n) {
    return '₹' + Math.ceil(n || 0).toLocaleString('en-IN');
  }

  function classify(e) {
    if (e.pending <= 0) return 'paid';
    if (e.daysUntilDue === null) return 'later';
    if (e.daysUntilDue < 0) return 'overdue';
    if (e.daysUntilDue <= 3) return 'soon';
    if (e.daysUntilDue <= 10) return 'upcoming';
    return 'later';
  }

  function statusLabel(e, cls) {
    if (cls === 'paid') return 'Paid';
    const d = e.daysUntilDue;
    if (d === null) return 'No date';
    if (d < 0) return Math.abs(d) + 'd overdue';
    if (d === 0) return 'Due today';
    return 'in ' + d + 'd';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : str;
    return div.innerHTML;
  }

  async function loadData() {
    const content = document.getElementById('content');
    content.className = 'loading';
    content.textContent = 'Loading dues…';

    try {
      const res = await fetch(CSV_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' — check sheet sharing is set to "Anyone with link can view"');
      const text = await res.text();
      const rows = parseCSV(text);
      if (rows.length < 2) throw new Error('Sheet appears empty');

      const dataRows = rows.slice(1); // skip header
      allEntries = [];

      dataRows.forEach(r => {
        const account = (r[0] || '').trim();
        const cardName = (r[1] || '').trim();
        if (!account && !cardName) return;

        
        const dueDate = parseDate(r[2]);
        const due = parseNumber(r[3]);
        const paid = parseNumber(r[4]);
        let pending = due - paid;
        if (pending < 0) pending = 0;

        const updatedOn = r[6] || '';
        const statement = r[7] || '';
        const totalLimit = parseNumber(r[9]);
        const currentLimit = parseNumber(r[10]);

        allEntries.push({
          account, cardName,
          dueDate, dueDateDisplay: fmtDate(dueDate),
          due, paid, pending,
          updatedOn, statement,
          totalLimit, currentLimit,
          daysUntilDue: dueDate ? daysUntil(dueDate) : null
        });
      });

      allEntries.sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate - b.dueDate;
      });

      populatePersonFilter();
      updatePersonButtonStyles();
      render();
      /* document.getElementById('updatedTag').textContent =
        'Fetched ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); */

    } catch (err) {
      content.className = 'err';
      content.innerHTML = 'Could not load sheet data.<br><br>' + escapeHtml(err.message) +
        '<br><br>Make sure the sheet is shared as "Anyone with the link can view".';
    }
  }

  function populatePersonFilter() {
    const container = document.getElementById('personTabs');
    const people = [...new Set(allEntries.map(e => e.account).filter(Boolean))].sort();
    container.innerHTML = '<button class="person-btn active" data-person="ALL">All</button>' +
      people.map(p => `<button class="person-btn" data-person="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join('');
  }

  function render() {
    const filtered = allEntries.filter(e => {
      if (e.pending <= 0) return false; // hide fully paid entries
      if (selectedPeople.size > 0 && !selectedPeople.has(e.account)) return false;
      return true;
    });

    renderStats();
    renderGrid(filtered);
  }

  function renderStats() {
    const totalPending = allEntries.reduce((s, e) => s + e.pending, 0);
    document.getElementById('stats').innerHTML = `
      <div class="stat"><div class="n" style="color:var(--overdue)">${fmtRs(totalPending)}</div><div class="l">Total pending</div></div>
    `;
  }

  function renderGrid(entries) {
    const content = document.getElementById('content');
    if (!entries.length) {
      content.className = 'empty';
      content.textContent = 'No entries match this filter.';
      return;
    }
    content.className = '';
    content.innerHTML = `
      <table class="due-table">
        <thead>
          <tr>
            <th>Card</th>
            <th>Person</th>
            <th>Due date</th>
            <th>Due</th>
            <th>Paid</th>
            <th>Pending</th>
          </tr>
        </thead>
        <tbody>
          ${entries.map(e => {
            const cls = classify(e);
            return `
              <tr class="${cls}">
                <td>${escapeHtml(e.cardName || 'Unnamed')}</td>
                <td>${escapeHtml(e.account)}</td>
                <td class="num">${e.dueDateDisplay}</td>
                <td class="num">${fmtRs(e.due)}</td>
                <td class="num">${fmtRs(e.paid)}</td>
                <td class="pending-cell ${e.pending <= 0 ? 'zero' : ''}">${fmtRs(e.pending)}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  document.getElementById('navTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');

    const tab = btn.dataset.tab;
    document.getElementById('duesSection').style.display = tab === 'dues' ? '' : 'none';
    document.getElementById('debitSection').style.display = tab === 'debit' ? '' : 'none';
    document.getElementById('creditSection').style.display = tab === 'credit' ? '' : 'none';
    document.getElementById('rewardsSection').style.display = tab === 'rewards' ? '' : 'none';
  });

  document.getElementById('personTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.person-btn');
    if (!btn) return;
    const person = btn.dataset.person;

    if (person === 'ALL') {
      selectedPeople.clear();
    } else {
      selectedPeople.delete('ALL');
      if (selectedPeople.has(person)) {
        selectedPeople.delete(person);
      } else {
        selectedPeople.add(person);
      }
      if (selectedPeople.size === 0) selectedPeople.clear(); // falls back to All look
    }

    updatePersonButtonStyles();
    render();
  });

  function updatePersonButtonStyles() {
    document.querySelectorAll('.person-btn').forEach(b => {
      const p = b.dataset.person;
      const isActive = p === 'ALL' ? selectedPeople.size === 0 : selectedPeople.has(p);
      b.classList.toggle('active', isActive);
    });
  }

  loadData();
