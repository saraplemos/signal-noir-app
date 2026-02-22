import React, { useState, useEffect } from 'react';

// ============================================
// SETUP INSTRUCTIONS
// ============================================
// 1. Open your Google Sheet
// 2. Go to Extensions > Apps Script
// 3. Delete any code there and paste the code from the APPS_SCRIPT section below
// 4. Click Deploy > New Deployment
// 5. Select "Web app" as type
// 6. Set "Execute as" to "Me" and "Who has access" to "Anyone"
// 7. Click Deploy and authorize
// 8. Copy the Web App URL and paste it below as APPS_SCRIPT_URL
// ============================================

// PASTE YOUR GOOGLE APPS SCRIPT WEB APP URL HERE:
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyiTFITgJ-U8QT4gIJ7lh9O2gmRlERAX6dmMr3LzaDYzSH962lpXN9wnrHy2W60mEjGiQ/exec';

// PASSWORD PROTECTION - Change this to your desired password
const APP_PASSWORD = 'signalnoir2026';

// If no Apps Script URL, use published CSV (read-only mode)
const PUBLISHED_CSV_URL = '';

// PASTE YOUR GOOGLE SHEET ID HERE (from the sheet URL):
const SHEET_ID = '';

// Data range: row 1 = headers, rows 2–30 = data (29 rows). All tabs use this range.
const HEADER_ROW = 1;
const DATA_FIRST_ROW = 2;
const DATA_LAST_ROW = 30;
const DATA_ROW_COUNT = DATA_LAST_ROW - DATA_FIRST_ROW + 1;

const WEIGHTS = {
  authority: 0.25,
  aiCitations: 0.30,
  content: 0.20,
  topical: 0.15,
  search: 0.10,
  social: 0.05
};

const SIGNAL_LABELS = {
  authority: 'Authority',
  aiCitations: 'AI Citations',
  content: 'Content',
  topical: 'Topical',
  search: 'Search',
  social: 'Social'
};

const WEIGHT_PERCENTAGES = {
  authority: '25%',
  aiCitations: '30%',
  content: '20%',
  topical: '15%',
  search: '10%',
  social: '5%'
};

const SIGNAL_TABS = [
  { key: 'authority', label: 'Authority', num: 1 },
  { key: 'aiCitations', label: 'AI Citations', num: 2 },
  { key: 'content', label: 'Content', num: 3 },
  { key: 'topical', label: 'Topical', num: 4 },
  { key: 'search', label: 'Search', num: 5 },
  { key: 'social', label: 'Social amplification', num: 6 }
];

const calculateScore = (scores) => {
  return Object.keys(WEIGHTS).reduce((total, key) => {
    return total + (scores[key] || 0) * WEIGHTS[key];
  }, 0);
};

// Gold/amber colour scale for citation bar fills
const citationColor = (val, max) => {
  const pct = max > 0 ? val / max : 0;
  if (pct >= 0.7) return '#FFD700';
  if (pct >= 0.4) return '#f59e0b';
  if (pct >= 0.2) return '#f97316';
  return '#6b7280';
};

const SignalNoirApp = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return sessionStorage.getItem('signalnoir_auth') === 'true';
  });
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [publications, setPublications] = useState([]);
  // aiBreakdown: { [pubName]: { chatgpt, claude, perplexity, gemini, total, rate } }
  const [aiBreakdown, setAiBreakdown] = useState({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [connectionMode, setConnectionMode] = useState('not_configured');
  const [newPubName, setNewPubName] = useState('');
  const [signalPage, setSignalPage] = useState(null);

  useEffect(() => {
    if (isAuthenticated) {
      loadData();
    }
  }, [isAuthenticated]);

  const handleLogin = (e) => {
    e.preventDefault();
    if (passwordInput === APP_PASSWORD) {
      sessionStorage.setItem('signalnoir_auth', 'true');
      setIsAuthenticated(true);
      setAuthError('');
    } else {
      setAuthError('Incorrect password');
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem('signalnoir_auth');
    setIsAuthenticated(false);
    setPasswordInput('');
  };

  const loadData = async () => {
    setLoading(true);
    setError(null);

    if (APPS_SCRIPT_URL) {
      setConnectionMode('readwrite');
      await fetchFromAppsScript();
    } else if (PUBLISHED_CSV_URL) {
      setConnectionMode('readonly');
      await fetchFromCSV();
    } else {
      setConnectionMode('not_configured');
      setError('No data source configured. Please set up APPS_SCRIPT_URL or PUBLISHED_CSV_URL.');
      setPublications([]);
      setLoading(false);
    }
  };

  const fetchFromAppsScript = async () => {
    try {
      const response = await fetch(`${APPS_SCRIPT_URL}?action=read`);
      const data = await response.json();

      if (data.error) throw new Error(data.error);

      // ── Master_Dashboard rows ──────────────────────────────────────────
      const rawRows = Array.isArray(data.data) ? data.data : [];
      const skipHeader = rawRows.length > 0 && String((rawRows[0][0] || '')).toLowerCase() === 'publication';
      const dataRows = (skipHeader ? rawRows.slice(1) : rawRows).slice(0, DATA_ROW_COUNT);

      const pubs = dataRows
        .map((row, index) => ({
          id: index + 1,
          name: row[0],
          row: index + DATA_FIRST_ROW,
          scores: {
            authority:   parseFloat(row[3]) || 0,
            aiCitations: parseFloat(row[4]) || 0,
            content:     parseFloat(row[5]) || 0,
            topical:     parseFloat(row[6]) || 0,
            search:      parseFloat(row[7]) || 0,
            social:      parseFloat(row[8]) || 0
          },
          status:    row[9]  || '',
          interview: row[10] || ''
        }))
        .filter(pub => pub.name);

      setPublications(pubs);

      // ── 2_AI_Citations breakdown rows ────────────────────────────────
      // Apps Script now returns data.aiCitationsData as an array of rows
      // from 2_AI_Citations: [name, chatgpt, claude, perplexity, gemini, total, rate]
      if (Array.isArray(data.aiCitationsData)) {
        const breakdown = {};
        const skipAIHeader = data.aiCitationsData.length > 0 &&
          String((data.aiCitationsData[0][0] || '')).toLowerCase() === 'publication';
        const aiRows = (skipAIHeader ? data.aiCitationsData.slice(1) : data.aiCitationsData)
          .slice(0, DATA_ROW_COUNT);

        aiRows.forEach(row => {
          const name = row[0];
          if (!name) return;
          breakdown[name] = {
            chatgpt:    parseFloat(row[1]) || 0,   // col B
            claude:     parseFloat(row[2]) || 0,   // col C
            perplexity: parseFloat(row[3]) || 0,   // col D
            gemini:     parseFloat(row[4]) || 0,   // col E
            total:      parseFloat(row[5]) || 0,   // col F
            rate:       parseFloat(row[6]) || 0,   // col G (as decimal e.g. 0.25)
          };
        });
        setAiBreakdown(breakdown);
      }

      setLastSync(new Date());
    } catch (err) {
      setError(`Failed to load from Google Sheets: ${err.message}`);
      setPublications([]);
    } finally {
      setLoading(false);
    }
  };

  const parseCSV = (text) => {
    const rows = [];
    let currentRow = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (inQuotes) {
        if (char === '"' && nextChar === '"') { currentField += '"'; i++; }
        else if (char === '"') { inQuotes = false; }
        else { currentField += char; }
      } else {
        if (char === '"') { inQuotes = true; }
        else if (char === ',') { currentRow.push(currentField); currentField = ''; }
        else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
          currentRow.push(currentField);
          if (currentRow.length > 1 || currentRow[0] !== '') rows.push(currentRow);
          currentRow = []; currentField = '';
          if (char === '\r') i++;
        } else if (char !== '\r') { currentField += char; }
      }
    }
    if (currentField || currentRow.length > 0) { currentRow.push(currentField); rows.push(currentRow); }
    return rows;
  };

  const fetchFromCSV = async () => {
    try {
      const response = await fetch(PUBLISHED_CSV_URL);
      const text = await response.text();
      const rows = parseCSV(text);
      const dataRows = rows.slice(1, 1 + DATA_ROW_COUNT);
      const pubs = dataRows
        .map((row, index) => ({
          id: index + 1,
          name: row[0] || '',
          row: index + DATA_FIRST_ROW,
          scores: {
            authority:   parseFloat(row[3]) || 0,
            aiCitations: parseFloat(row[4]) || 0,
            content:     parseFloat(row[5]) || 0,
            topical:     parseFloat(row[6]) || 0,
            search:      parseFloat(row[7]) || 0,
            social:      parseFloat(row[8]) || 0
          }
        })).filter(pub => pub.name);
      setPublications(pubs);
      setLastSync(new Date());
    } catch (err) {
      setError(`Failed to load CSV: ${err.message}`);
      setPublications([]);
    } finally {
      setLoading(false);
    }
  };

  const saveToSheet = async (pubId, scores) => {
    if (connectionMode !== 'readwrite') return;
    setSyncing(true);
    const pub = publications.find(p => p.id === pubId);
    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          row: pub.row,
          scores: [scores.authority, scores.aiCitations, scores.content, scores.topical, scores.search, scores.social],
          overallScore: calculateScore(scores)
        })
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      setLastSync(new Date());
    } catch (err) {
      setError(`Failed to save: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const updateScore = (pubId, signal, value) => {
    const numValue = Math.min(100, Math.max(0, parseInt(value) || 0));
    setPublications(publications.map(pub => {
      if (pub.id === pubId) {
        return { ...pub, scores: { ...pub.scores, [signal]: numValue } };
      }
      return pub;
    }));
  };

  const handleDoneEditing = (pubId) => {
    const pub = publications.find(p => p.id === pubId);
    if (pub && connectionMode === 'readwrite') saveToSheet(pubId, pub.scores);
    setEditingId(null);
  };

  const addPublication = async () => {
    if (!newPubName.trim()) return;
    const newPub = {
      id: Date.now(), name: newPubName.trim(), row: null,
      scores: { authority: 0, aiCitations: 0, content: 0, topical: 0, search: 0, social: 0 }
    };
    if (connectionMode === 'readwrite' && APPS_SCRIPT_URL) {
      try {
        const response = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'add', name: newPub.name })
        });
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        newPub.row = data.row;
      } catch (err) { setError(`Failed to add publication: ${err.message}`); return; }
    } else {
      const maxRow = publications.reduce((max, p) => Math.max(max, p.row || 0), 1);
      newPub.row = maxRow + 1;
    }
    setPublications([...publications, newPub]);
    setNewPubName('');
    setEditingId(newPub.id);
  };

  const sortedPublications = [...publications].sort((a, b) => calculateScore(b.scores) - calculateScore(a.scores));

  const exportData = () => {
    const headers = ['Rank', 'Publication', 'Overall Score', ...Object.values(SIGNAL_LABELS)];
    const rows = sortedPublications.map((pub, index) => [
      index + 1, pub.name, calculateScore(pub.scores).toFixed(1),
      ...Object.keys(WEIGHTS).map(key => pub.scores[key])
    ]);
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `signal-noir-evaluation-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const getConnectionBadge = () => {
    switch (connectionMode) {
      case 'readwrite': return <span style={{ color: '#FFD700' }}>● Connected (Read/Write)</span>;
      case 'readonly':  return <span style={{ color: '#f00069' }}>● Connected (Read Only)</span>;
      default:          return <span className="text-red-400">○ Not Connected</span>;
    }
  };

  // ── AI Citations breakdown panel ───────────────────────────────────────────
  const AICitationsPanel = ({ pubs, breakdown }) => {
    const sorted = [...pubs].sort((a, b) => {
      const bTotal = (breakdown[b.name]?.total) ?? (b.scores.aiCitations || 0);
      const aTotal = (breakdown[a.name]?.total) ?? (a.scores.aiCitations || 0);
      return bTotal - aTotal;
    });

    const hasBreakdown = Object.keys(breakdown).length > 0;

    return (
      <div className="mb-6">
        <button
          onClick={() => setSignalPage(null)}
          className="mb-4 text-gray-500 hover:text-gray-300 text-sm flex items-center gap-1 transition-colors"
        >
          ← Back to dashboard
        </button>

        {/* Breakdown table */}
        <div className="mb-6 bg-gray-900/50 rounded-lg border border-gray-800 overflow-hidden">
          <div className="p-4 border-b border-gray-800">
            <h2 className="text-lg font-light tracking-wide">
              AI Citations Results
              <span className="text-gray-600 text-sm ml-2">({pubs.length} publications)</span>
            </h2>
            {!hasBreakdown && (
              <p className="text-gray-600 text-xs mt-1">
                Breakdown data not yet available — update Apps Script to return aiCitationsData
              </p>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase tracking-wider">
                  <th className="px-4 py-3 text-left w-8">#</th>
                  <th className="px-4 py-3 text-left min-w-44">Publication</th>
                  <th className="px-3 py-3 text-center">
                    <span style={{ color: '#10a37f' }}>ChatGPT</span>
                    <span className="block font-normal text-gray-600">/30</span>
                  </th>
                  <th className="px-3 py-3 text-center">
                    <span style={{ color: '#c9a96e' }}>Claude</span>
                    <span className="block font-normal text-gray-600">/30</span>
                  </th>
                  <th className="px-3 py-3 text-center">
                    <span style={{ color: '#20b2aa' }}>Perplexity</span>
                    <span className="block font-normal text-gray-600">/30</span>
                  </th>
                  <th className="px-3 py-3 text-center">
                    <span style={{ color: '#4285f4' }}>Gemini</span>
                    <span className="block font-normal text-gray-600">/30</span>
                  </th>
                  <th className="px-3 py-3 text-center">
                    Total
                    <span className="block font-normal text-gray-600">/120</span>
                  </th>
                  <th className="px-3 py-3 text-center">
                    Rate %
                  </th>
                  <th className="px-3 py-3 text-center">
                    RAW Score
                    <span className="block font-normal text-gray-600">/100</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((pub, index) => {
                  const b = breakdown[pub.name];
                  const rawScore = pub.scores.aiCitations || 0;
                  const total = b?.total ?? '—';
                  const rate = b ? `${(b.rate * 100).toFixed(1)}%` : '—';

                  return (
                    <tr key={pub.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-3 font-mono text-gray-500">{index + 1}</td>
                      <td className="px-4 py-3 font-medium">{pub.name}</td>

                      {/* ChatGPT */}
                      <td className="px-3 py-3 text-center">
                        {b ? (
                          <div className="flex flex-col items-center gap-1">
                            <span className="font-mono text-sm" style={{ color: '#10a37f' }}>{b.chatgpt}</span>
                            <div className="w-12 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${(b.chatgpt/30)*100}%`, background: '#10a37f' }} />
                            </div>
                          </div>
                        ) : <span className="text-gray-600">—</span>}
                      </td>

                      {/* Claude */}
                      <td className="px-3 py-3 text-center">
                        {b ? (
                          <div className="flex flex-col items-center gap-1">
                            <span className="font-mono text-sm" style={{ color: '#c9a96e' }}>{b.claude}</span>
                            <div className="w-12 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${(b.claude/30)*100}%`, background: '#c9a96e' }} />
                            </div>
                          </div>
                        ) : <span className="text-gray-600">—</span>}
                      </td>

                      {/* Perplexity */}
                      <td className="px-3 py-3 text-center">
                        {b ? (
                          <div className="flex flex-col items-center gap-1">
                            <span className="font-mono text-sm" style={{ color: '#20b2aa' }}>{b.perplexity}</span>
                            <div className="w-12 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${(b.perplexity/30)*100}%`, background: '#20b2aa' }} />
                            </div>
                          </div>
                        ) : <span className="text-gray-600">—</span>}
                      </td>

                      {/* Gemini */}
                      <td className="px-3 py-3 text-center">
                        {b ? (
                          <div className="flex flex-col items-center gap-1">
                            <span className="font-mono text-sm" style={{ color: '#4285f4' }}>{b.gemini}</span>
                            <div className="w-12 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${(b.gemini/30)*100}%`, background: '#4285f4' }} />
                            </div>
                          </div>
                        ) : <span className="text-gray-600">—</span>}
                      </td>

                      {/* Total */}
                      <td className="px-3 py-3 text-center">
                        <span className="font-mono font-semibold"
                          style={{ color: typeof total === 'number' && total >= 60 ? '#FFD700' : typeof total === 'number' && total >= 30 ? '#f59e0b' : '#d1d5db' }}>
                          {total}
                        </span>
                      </td>

                      {/* Rate */}
                      <td className="px-3 py-3 text-center font-mono text-gray-300">{rate}</td>

                      {/* RAW Score */}
                      <td className="px-3 py-3 text-center">
                        <span className="font-mono"
                          style={{ color: rawScore >= 70 ? '#FFD700' : rawScore >= 50 ? '#f00069' : rawScore >= 30 ? '#ff8c00' : '#6b7280' }}>
                          {rawScore}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Platform comparison bars */}
        {hasBreakdown && (
          <div className="bg-gray-900/50 rounded-lg border border-gray-800 p-5">
            <h3 className="text-sm text-gray-500 uppercase tracking-wider mb-5">Platform breakdown — top 15</h3>

            {/* Platform legend */}
            <div className="flex gap-6 mb-5 text-xs">
              {[
                { label: 'ChatGPT', color: '#10a37f' },
                { label: 'Claude',  color: '#c9a96e' },
                { label: 'Perplexity', color: '#20b2aa' },
                { label: 'Gemini', color: '#4285f4' },
              ].map(({ label, color }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm" style={{ background: color }} />
                  <span className="text-gray-400">{label}</span>
                </div>
              ))}
            </div>

            <div className="space-y-4">
              {sorted.slice(0, 15).map((pub, index) => {
                const b = breakdown[pub.name];
                if (!b) return null;
                return (
                  <div key={pub.id}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-3">
                        <span className="w-5 text-xs font-mono text-gray-600">{index + 1}</span>
                        <span className="text-sm text-gray-300">{pub.name}</span>
                      </div>
                      <span className="text-xs font-mono text-gray-500">{b.total}/120</span>
                    </div>
                    {/* Stacked bar */}
                    <div className="ml-8 flex h-4 rounded overflow-hidden bg-gray-800">
                      {[
                        { val: b.chatgpt,    color: '#10a37f' },
                        { val: b.claude,     color: '#c9a96e' },
                        { val: b.perplexity, color: '#20b2aa' },
                        { val: b.gemini,     color: '#4285f4' },
                      ].map(({ val, color }, i) => (
                        val > 0 ? (
                          <div
                            key={i}
                            style={{ width: `${(val / 120) * 100}%`, background: color }}
                            title={`${val}/30`}
                          />
                        ) : null
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Login screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen text-gray-100 flex items-center justify-center" style={{ background: '#0f0e17' }}>
        <div className="w-full max-w-sm p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-light tracking-widest mb-2">
              SIGNAL <span className="font-bold">NOIR</span>
              <span className="text-lg align-super" style={{ color: '#FFD700' }}>™</span>
            </h1>
            <p className="text-gray-500 text-sm">Enter password to continue</p>
          </div>
          <form onSubmit={handleLogin}>
            <input
              type="password" value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder="Password"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-gray-100 placeholder-gray-600 focus:outline-none mb-4"
              onFocus={(e) => e.target.style.borderColor = '#FFD700'}
              onBlur={(e) => e.target.style.borderColor = ''}
              autoFocus
            />
            {authError && <p className="text-red-400 text-sm mb-4">{authError}</p>}
            <button type="submit"
              className="w-full text-gray-900 font-medium py-3 rounded-lg transition-colors"
              style={{ background: '#FFD700' }}
              onMouseEnter={(e) => e.target.style.background = '#ffeb3b'}
              onMouseLeave={(e) => e.target.style.background = '#FFD700'}
            >Login</button>
          </form>
          <p className="text-gray-700 text-xs text-center mt-6">by Make Lemonade Fizz</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen text-gray-100 flex items-center justify-center" style={{ background: '#0f0e17' }}>
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-t-transparent rounded-full mx-auto mb-4"
            style={{ borderColor: '#FFD700', borderTopColor: 'transparent' }}></div>
          <p className="text-gray-500">Loading SIGNAL NOIR™...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-gray-100 p-6" style={{ background: 'linear-gradient(135deg, #0f0e17 0%, #1a1a2e 50%, #0f0e17 100%)' }}>
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="mb-6 flex justify-between items-start">
          <div>
            <h1 className="text-4xl font-light tracking-widest mb-2">
              SIGNAL <span className="font-bold">NOIR</span>
              <span className="text-lg align-super" style={{ color: '#FFD700' }}>™</span>
            </h1>
            <p className="text-gray-500 text-sm tracking-wide">AI Authority Evaluation for Luxury Travel & Hospitality</p>
            <p className="text-gray-600 text-xs mt-1">by Make Lemonade Fizz</p>
          </div>
          <div className="text-right text-xs">
            <div className="mb-2">{getConnectionBadge()}</div>
            {lastSync && <div className="text-gray-600">Last sync: {lastSync.toLocaleTimeString()}</div>}
            {syncing && <div className="animate-pulse" style={{ color: '#FFD700' }}>Saving...</div>}
            <button onClick={handleLogout} className="mt-2 text-gray-600 hover:text-gray-400 transition-colors">Logout</button>
          </div>
        </div>

        {error && (
          <div className="mb-4 bg-red-900/30 border border-red-800 rounded-lg p-3 text-red-400 text-sm">
            {error}
            <button onClick={() => setError(null)} className="ml-4 text-red-600 hover:text-red-400">✕</button>
          </div>
        )}

        {connectionMode === 'not_configured' && (
          <div className="mb-6 bg-gray-900/50 border border-gray-800 rounded-lg p-4">
            <h3 className="text-sm font-medium mb-2" style={{ color: '#FFD700' }}>Setup Google Sheets Connection</h3>
            <p className="text-gray-500 text-xs mb-3">To connect to your master dashboard, you need to deploy a Google Apps Script.</p>
            {SHEET_ID && (
              <a href={`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`} target="_blank" rel="noopener noreferrer"
                className="text-xs bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded transition-colors inline-block">
                Open Master Sheet →
              </a>
            )}
          </div>
        )}

        {/* Weights */}
        <div className="mb-6 bg-gray-900/50 rounded-lg p-5 border border-gray-800">
          <div className="flex flex-wrap justify-center gap-6 text-base">
            {Object.keys(WEIGHTS).map(key => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-gray-400 font-medium">{SIGNAL_LABELS[key]}</span>
                <span className="font-mono text-lg font-semibold" style={{ color: '#FFD700' }}>{WEIGHT_PERCENTAGES[key]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Signal tabs */}
        <div className="mb-6 flex flex-wrap gap-2">
          {SIGNAL_TABS.map(({ key, label, num }) => (
            <button key={key} onClick={() => setSignalPage(key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${signalPage === key ? 'text-gray-900' : 'bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-300'}`}
              style={signalPage === key ? { background: '#FFD700' } : {}}>
              {num}. {label}
            </button>
          ))}
        </div>

        {/* AI Citations page — custom breakdown */}
        {signalPage === 'aiCitations' && (
          <AICitationsPanel pubs={publications} breakdown={aiBreakdown} />
        )}

        {/* Other signal pages */}
        {signalPage && signalPage !== 'aiCitations' && (() => {
          if (publications.length === 0) {
            return (
              <div className="mb-6">
                <button onClick={() => setSignalPage(null)}
                  className="mb-4 text-gray-500 hover:text-gray-300 text-sm flex items-center gap-1 transition-colors">
                  ← Back to dashboard
                </button>
                <p className="text-gray-500">No publications to show for this signal.</p>
              </div>
            );
          }
          const tab = SIGNAL_TABS.find(t => t.key === signalPage);
          const label = tab ? tab.label : SIGNAL_LABELS[signalPage] || signalPage;
          const sortedBySignal = [...publications].sort((a, b) => (b.scores[signalPage] || 0) - (a.scores[signalPage] || 0));
          return (
            <div className="mb-6">
              <button onClick={() => setSignalPage(null)}
                className="mb-4 text-gray-500 hover:text-gray-300 text-sm flex items-center gap-1 transition-colors">
                ← Back to dashboard
              </button>
              <div className="mb-6 bg-gray-900/50 rounded-lg border border-gray-800 overflow-hidden">
                <div className="p-4 border-b border-gray-800">
                  <h2 className="text-lg font-light tracking-wide">
                    {label} Results
                    <span className="text-gray-600 text-sm ml-2">({publications.length} publications, sorted by {label})</span>
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase tracking-wider">
                        <th className="px-4 py-3 text-left w-12">#</th>
                        <th className="px-4 py-3 text-left min-w-48">Publication</th>
                        <th className="px-4 py-3 text-center w-20">{label}</th>
                        <th className="px-4 py-3 text-center w-20">Overall</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedBySignal.map((pub, index) => {
                        const signalScore = pub.scores[signalPage] || 0;
                        const overall = calculateScore(pub.scores);
                        return (
                          <tr key={pub.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                            <td className="px-4 py-3 font-mono text-gray-500">{index + 1}</td>
                            <td className="px-4 py-3 font-medium">{pub.name}</td>
                            <td className="px-4 py-3 text-center">
                              <span className="font-mono text-lg"
                                style={{ color: signalScore >= 70 ? '#FFD700' : signalScore >= 50 ? '#f00069' : signalScore >= 30 ? '#ff8c00' : '#6b7280' }}>
                                {signalScore}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center font-mono text-gray-400">{overall.toFixed(1)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="bg-gray-900/50 rounded-lg border border-gray-800 p-4">
                <h3 className="text-sm text-gray-500 uppercase tracking-wider mb-4">{label} score distribution</h3>
                <div className="space-y-3">
                  {sortedBySignal.slice(0, 15).map((pub, index) => {
                    const score = pub.scores[signalPage] || 0;
                    const barGradient = score >= 70 ? 'linear-gradient(to right, #b8860b, #FFD700)'
                      : score >= 50 ? 'linear-gradient(to right, #c5004f, #f00069)'
                      : score >= 30 ? 'linear-gradient(to right, #cc5500, #ff8c00)'
                      : 'linear-gradient(to right, #374151, #6b7280)';
                    return (
                      <div key={pub.id} className="flex items-center gap-4">
                        <span className="w-6 text-xs font-mono text-gray-600">{index + 1}</span>
                        <span className="w-48 text-sm truncate">{pub.name}</span>
                        <div className="flex-1 h-6 bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${score}%`, background: barGradient }} />
                        </div>
                        <span className="w-12 text-right font-mono text-sm">{score}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Main dashboard */}
        {!signalPage && (
          <>
            <div className="mb-6 flex gap-3">
              <input type="text" value={newPubName} onChange={(e) => setNewPubName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addPublication()}
                placeholder="Add new publication..."
                className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-gray-100 placeholder-gray-600 focus:outline-none transition-colors"
                onFocus={(e) => e.target.style.borderColor = '#FFD700'}
                onBlur={(e) => e.target.style.borderColor = ''} />
              <button onClick={addPublication}
                className="text-gray-900 font-medium px-6 py-3 rounded-lg transition-colors"
                style={{ background: '#FFD700' }}
                onMouseEnter={(e) => e.target.style.background = '#ffeb3b'}
                onMouseLeave={(e) => e.target.style.background = '#FFD700'}>Add</button>
              <button onClick={loadData}
                className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-3 rounded-lg transition-colors"
                title="Refresh from sheet">↻</button>
            </div>

            {publications.length > 0 && (
              <div className="mb-6 bg-gray-900/50 rounded-lg border border-gray-800 overflow-hidden">
                <div className="p-4 border-b border-gray-800 flex justify-between items-center">
                  <h2 className="text-lg font-light tracking-wide">
                    Ranked Evaluation
                    <span className="text-gray-600 text-sm ml-2">({publications.length} publications)</span>
                  </h2>
                  <button onClick={exportData}
                    className="text-xs bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded transition-colors">
                    Export CSV
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase tracking-wider">
                        <th className="px-4 py-3 text-left w-12">#</th>
                        <th className="px-4 py-3 text-left min-w-48">Publication</th>
                        <th className="px-4 py-3 text-center w-20">Score</th>
                        {Object.keys(WEIGHTS).map(key => (
                          <th key={key} className="px-3 py-3 text-center whitespace-nowrap">
                            {SIGNAL_LABELS[key]}
                            <span className="block font-normal" style={{ color: 'rgba(255, 215, 0, 0.6)' }}>({WEIGHT_PERCENTAGES[key]})</span>
                          </th>
                        ))}
                        <th className="px-4 py-3 w-24"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedPublications.map((pub, index) => {
                        const score = calculateScore(pub.scores);
                        const isEditing = editingId === pub.id;
                        return (
                          <tr key={pub.id}
                            className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors ${isEditing ? 'bg-gray-800/50' : ''}`}>
                            <td className="px-4 py-3">
                              <span className={`font-mono ${index === 1 ? 'text-gray-400' : index === 2 ? 'text-amber-700' : index > 2 ? 'text-gray-600' : ''}`}
                                style={index === 0 ? { color: '#FFD700' } : {}}>
                                {index + 1}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-medium">{pub.name}</td>
                            <td className="px-4 py-3 text-center">
                              <span className="font-mono text-lg"
                                style={{ color: score >= 70 ? '#FFD700' : score >= 50 ? '#f00069' : score >= 30 ? '#ff8c00' : '#ef4444' }}>
                                {score.toFixed(1)}
                              </span>
                            </td>
                            {Object.keys(WEIGHTS).map(key => (
                              <td key={key} className="px-3 py-3 text-center">
                                {isEditing ? (
                                  <input type="number" min="0" max="100" value={pub.scores[key]}
                                    onChange={(e) => updateScore(pub.id, key, e.target.value)}
                                    className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-center text-gray-100 focus:outline-none"
                                    onFocus={(e) => e.target.style.borderColor = '#FFD700'}
                                    onBlur={(e) => e.target.style.borderColor = ''} />
                                ) : (
                                  <span className="font-mono"
                                    style={{ color: pub.scores[key] >= 70 ? 'rgba(255, 215, 0, 0.8)' : pub.scores[key] >= 50 ? '#d1d5db' : '#6b7280' }}>
                                    {pub.scores[key]}
                                  </span>
                                )}
                              </td>
                            ))}
                            <td className="px-4 py-3">
                              <div className="flex gap-2 justify-end">
                                <button
                                  onClick={() => isEditing ? handleDoneEditing(pub.id) : setEditingId(pub.id)}
                                  className={`text-xs px-3 py-1 rounded transition-colors ${isEditing ? 'text-gray-900' : 'bg-gray-800 hover:bg-gray-700 text-gray-400'}`}
                                  style={isEditing ? { background: '#FFD700' } : {}}
                                  onMouseEnter={(e) => { if (isEditing) e.target.style.background = '#ffeb3b'; }}
                                  onMouseLeave={(e) => { if (isEditing) e.target.style.background = '#FFD700'; }}>
                                  {isEditing ? 'Save' : 'Edit'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {publications.length > 0 && (
              <div className="bg-gray-900/50 rounded-lg border border-gray-800 p-4">
                <h3 className="text-sm text-gray-500 uppercase tracking-wider mb-4">Score Distribution</h3>
                <div className="space-y-3">
                  {sortedPublications.slice(0, 15).map((pub, index) => {
                    const score = calculateScore(pub.scores);
                    const barGradient = score >= 70 ? 'linear-gradient(to right, #b8860b, #FFD700)'
                      : score >= 50 ? 'linear-gradient(to right, #c5004f, #f00069)'
                      : score >= 30 ? 'linear-gradient(to right, #cc5500, #ff8c00)'
                      : 'linear-gradient(to right, #b91c1c, #ef4444)';
                    return (
                      <div key={pub.id} className="flex items-center gap-4">
                        <span className="w-6 text-xs font-mono text-gray-600">{index + 1}</span>
                        <span className="w-48 text-sm truncate">{pub.name}</span>
                        <div className="flex-1 h-6 bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${score}%`, background: barGradient }} />
                        </div>
                        <span className="w-12 text-right font-mono text-sm">{score.toFixed(1)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        <div className="mt-8 text-center text-xs text-gray-700">
          <p>SIGNAL NOIR™ is a proprietary framework owned by Make Lemonade Fizz.</p>
          <p className="mt-1">Methodology and calculations are confidential intellectual property.</p>
        </div>
      </div>
    </div>
  );
};

export default SignalNoirApp;

// ============================================
// GOOGLE APPS SCRIPT CODE  — REPLACE YOUR EXISTING SCRIPT WITH THIS
// ============================================
/*

function doGet(e) {
  const action = e.parameter.action;
  if (action === 'read') return readData();
  return ContentService.createTextOutput(JSON.stringify({ error: 'Invalid action' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  if (data.action === 'update') return updateRow(data);
  if (data.action === 'add') return addRow(data);
  return ContentService.createTextOutput(JSON.stringify({ error: 'Invalid action' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function readData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Master_Dashboard: rows 2-30
  const masterSheet = ss.getSheetByName('Master_Dashboard');
  const masterData = masterSheet.getRange(2, 1, 29, 11).getValues();

  // 2_AI_Citations: rows 2-30, cols A-G (name + 6 citation fields)
  const aiSheet = ss.getSheetByName('2_AI_Citations');
  const aiData = aiSheet.getRange(2, 1, 29, 7).getValues();

  return ContentService.createTextOutput(JSON.stringify({
    data: masterData,
    aiCitationsData: aiData
  })).setMimeType(ContentService.MimeType.JSON);
}

function updateRow(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Master_Dashboard');
  const row = data.row;
  sheet.getRange(row, 2).setValue(data.overallScore);
  sheet.getRange(row, 4).setValue(data.scores[0]); // Authority
  sheet.getRange(row, 5).setValue(data.scores[1]); // AI Citations
  sheet.getRange(row, 6).setValue(data.scores[2]); // Content
  sheet.getRange(row, 7).setValue(data.scores[3]); // Topical
  sheet.getRange(row, 8).setValue(data.scores[4]); // Search
  sheet.getRange(row, 9).setValue(data.scores[5]); // Social
  return ContentService.createTextOutput(JSON.stringify({ success: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

function addRow(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Master_Dashboard');
  const lastRow = sheet.getLastRow() + 1;
  sheet.getRange(lastRow, 1).setValue(data.name);
  sheet.getRange(lastRow, 2).setValue(0);
  return ContentService.createTextOutput(JSON.stringify({ success: true, row: lastRow }))
    .setMimeType(ContentService.MimeType.JSON);
}

*/
