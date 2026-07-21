// ── Configure your sheet here ──
  const SHEET_ID = '1q4EhX1RNMWXooqszhMz_X9if9Qyj3zRZ-8BcXwHLy7Y';
  const SHEET_NAME = 'Sheet1';
  const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;
  const MAINTENANCE_SHEET_NAME = 'Maintenance';
  const MAINTENANCE_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(MAINTENANCE_SHEET_NAME)}`;

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
        const account = (r[0] || '').trim();   // A: Name
        const bank = (r[1] || '').trim();      // B: Bank
        const cardName = (r[2] || '').trim();  // C: Card name
        const ending = (r[3] || '').trim();    // D: Ending
        if (!account && !cardName) return;

        const dueDate = parseDate(r[4]);       // E: Due date
        const due = parseNumber(r[5]);         // F: Due (Rs.)
        const paid = parseNumber(r[6]);        // G: Paid (Rs.)
        let pending = due - paid;
        if (pending < 0) pending = 0;

        const updatedOn = r[8] || '';          // I: Updated on
        const statement = r[9] || '';          // J: Statement
        const totalLimit = parseNumber(r[11]); // L: Total limit
        const currentLimit = parseNumber(r[12]); // M: Current limit

        allEntries.push({
          account, bank, cardName, ending,
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
            <th>Name</th>
            <th>Bank</th>
            <th>Ending</th>
            <th class="highlight-col">Due date</th>
            <th class="highlight-col">Due</th>
            <th>Paid</th>
            <th>Pending</th>
          </tr>
        </thead>
        <tbody>
          ${entries.map(e => {
            const cls = classify(e);
            return `
              <tr class="${cls}">
                <td>${escapeHtml(e.account)}</td>
                <td>${escapeHtml(e.bank)}</td>
                <td class="num">${escapeHtml(e.ending)}</td>
                <td class="num highlight-col">${e.dueDateDisplay}</td>
                <td class="num highlight-col">${fmtRs(e.due)}</td>
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
    document.getElementById('maintenanceSection').style.display = tab === 'maintenance' ? '' : 'none';
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

  async function loadMaintenanceTasks() {
    const section = document.getElementById('maintenanceTasks');
    section.innerHTML = '<div class="loading">Loading tasks…</div>';

    try {
      const res = await fetch(MAINTENANCE_CSV_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      const rows = parseCSV(text);
      const tasks = rows.slice(1).map(r => (r[0] || '').trim()).filter(Boolean);

      if (!tasks.length) {
        section.innerHTML = '<div class="empty">No pending tasks.</div>';
        return;
      }

      section.innerHTML = `
        <ol class="task-list">
          ${tasks.map(t => `<li>${escapeHtml(t)}</li>`).join('')}
        </ol>
      `;
    } catch (err) {
      section.innerHTML = '<div class="err">Could not load tasks.<br><br>' + escapeHtml(err.message) + '</div>';
    }
  }

  function nearestUpcomingDayOfMonth(dayNum) {
    const today = new Date(); today.setHours(0,0,0,0);
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), dayNum);
    if (thisMonth >= today) return thisMonth;
    return new Date(today.getFullYear(), today.getMonth() + 1, dayNum);
  }

  function nearestDueDaysDate(dueDaysRaw) {
    if (!dueDaysRaw) return null;
    const days = String(dueDaysRaw).split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n >= 1 && n <= 31);
    if (!days.length) return null;
    const dates = days.map(nearestUpcomingDayOfMonth);
    return dates.reduce((a, b) => (a < b ? a : b));
  }

  async function loadLimitCheck() {
    const section = document.getElementById('limitCheck');
    section.innerHTML = '<div class="loading">Checking limits…</div>';

    try {
      const res = await fetch(CSV_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      const rows = parseCSV(text);
      const dataRows = rows.slice(1);

      const today = new Date(); today.setHours(0,0,0,0);
      const results = [];

      dataRows.forEach(r => {
        const account = (r[0] || '').trim();   // A: Name
        const cardName = (r[2] || '').trim();  // C: Card name
        const ending = (r[3] || '').trim();    // D: Ending
        const updatedOn = (r[8] || '').trim(); // I: Updated on
        const statement = (r[9] || '').trim(); // J: Statement
        const dueDaysRaw = (r[10] || '').trim(); // K: Due days
        const totalLimit = parseNumber(r[11]); // L: Total limit
        const currentLimit = parseNumber(r[12]); // M: Current limit
        const sharedLimit = (r[13] || '').trim().toLowerCase(); // N: Shared limit

        if (!account && !cardName) return;
        if (sharedLimit === 'yes') return;
        if (!(currentLimit < totalLimit)) return;

        if (!dueDaysRaw) {
          results.push({ account, cardName, ending, statement, dueDaysRaw, updatedOn, totalLimit, currentLimit });
          return;
        }

        const nearest = nearestDueDaysDate(dueDaysRaw);
        if (!nearest) return;
        const daysAway = Math.round((nearest - today) / 86400000);
        if (daysAway >= 0 && daysAway <= 15) {
          results.push({ account, cardName, ending, statement, dueDaysRaw, updatedOn, totalLimit, currentLimit });
        }
      });

      if (!results.length) {
        section.innerHTML = '<div class="empty">No cards need attention.</div>';
        return;
      }

      section.innerHTML = `
        <table class="due-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Card name</th>
              <th>Ending</th>
              <th>Statement</th>
              <th>Due days</th>
              <th>Updated on</th>
              <th>Limit</th>
            </tr>
          </thead>
          <tbody>
            ${results.map(e => `
              <tr>
                <td>${escapeHtml(e.account)}</td>
                <td>${escapeHtml(e.cardName)}</td>
                <td class="num">${escapeHtml(e.ending)}</td>
                <td class="num">${escapeHtml(e.statement || '—')}</td>
                <td class="num">${escapeHtml(e.dueDaysRaw || '—')}</td>
                <td class="num">${escapeHtml(e.updatedOn)}</td>
                <td class="num">${fmtRs(e.currentLimit)}/${fmtRs(e.totalLimit)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } catch (err) {
      section.innerHTML = '<div class="err">Could not check limits.<br><br>' + escapeHtml(err.message) + '</div>';
    }
  }

  loadData();
  loadMaintenanceTasks();
  loadLimitCheck();
