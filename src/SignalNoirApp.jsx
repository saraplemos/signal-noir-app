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
// To get this: File > Share > Publish to web > Select "Master_Dashboard" > CSV
const PUBLISHED_CSV_URL = '';

// PASTE YOUR GOOGLE SHEET ID HERE (from the sheet URL):
// https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID_HERE/edit
const SHEET_ID = '';

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

const calculateScore = (scores) => {
  return Object.keys(WEIGHTS).reduce((total, key) => {
    return total + (scores[key] || 0) * WEIGHTS[key];
  }, 0);
};

const SignalNoirApp = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return sessionStorage.getItem('signalnoir_auth') === 'true';
  });
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [publications, setPublications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [connectionMode, setConnectionMode] = useState('not_configured'); // 'not_configured', 'readonly', 'readwrite'
  const [newPubName, setNewPubName] = useState('');

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

    // Check connection mode
    if (APPS_SCRIPT_URL) {
      setConnectionMode('readwrite');
      await fetchFromAppsScript();
    } else if (PUBLISHED_CSV_URL) {
      setConnectionMode('readonly');
      await fetchFromCSV();
    } else {
      // Not configured
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
      
      if (data.error) {
        throw new Error(data.error);
      }

      const pubs = data.data
        .slice(0, 29) // Only rows 2-30 (29 data rows)
        .map((row, index) => ({
          id: index + 1,
          name: row[0],
          row: index + 2, // Sheet row number (1-indexed, skip header)
          scores: {
            authority: parseFloat(row[3]) || 0,
            aiCitations: parseFloat(row[4]) || 0,
            content: parseFloat(row[5]) || 0,
            topical: parseFloat(row[6]) || 0,
            search: parseFloat(row[7]) || 0,
            social: parseFloat(row[8]) || 0
          },
          status: row[9] || '',
          interview: row[10] || ''
        })).filter(pub => pub.name); // Filter out empty rows

      setPublications(pubs);
      setLastSync(new Date());
    } catch (err) {
      setError(`Failed to load from Google Sheets: ${err.message}`);
      setPublications([]);
    } finally {
      setLoading(false);
    }
  };

  // Parse CSV properly handling quoted fields with commas
  const parseCSV = (text) => {
    const rows = [];
    let currentRow = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (inQuotes) {
        if (char === '"' && nextChar === '"') {
          currentField += '"';
          i++; // Skip escaped quote
        } else if (char === '"') {
          inQuotes = false;
        } else {
          currentField += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ',') {
          currentRow.push(currentField);
          currentField = '';
        } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
          currentRow.push(currentField);
          if (currentRow.length > 1 || currentRow[0] !== '') {
            rows.push(currentRow);
          }
          currentRow = [];
          currentField = '';
          if (char === '\r') i++; // Skip \n in \r\n
        } else if (char !== '\r') {
          currentField += char;
        }
      }
    }

    // Handle last field/row
    if (currentField || currentRow.length > 0) {
      currentRow.push(currentField);
      rows.push(currentRow);
    }

    return rows;
  };

  const fetchFromCSV = async () => {
    try {
      const response = await fetch(PUBLISHED_CSV_URL);
      const text = await response.text();
      const rows = parseCSV(text);

      // Skip header row, limit to rows 2-30
      const pubs = rows
        .slice(1, 30) // Only rows 2-30 (29 data rows)
        .map((row, index) => ({
          id: index + 1,
          name: row[0] || '',
          row: index + 2,
          scores: {
            authority: parseFloat(row[3]) || 0,
            aiCitations: parseFloat(row[4]) || 0,
            content: parseFloat(row[5]) || 0,
            topical: parseFloat(row[6]) || 0,
            search: parseFloat(row[7]) || 0,
            social: parseFloat(row[8]) || 0
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
          scores: [
            scores.authority,
            scores.aiCitations,
            scores.content,
            scores.topical,
            scores.search,
            scores.social
          ],
          overallScore: calculateScore(scores)
        })
      });

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }
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
        const newScores = { ...pub.scores, [signal]: numValue };
        return { ...pub, scores: newScores };
      }
      return pub;
    }));
  };

  const handleDoneEditing = (pubId) => {
    const pub = publications.find(p => p.id === pubId);
    if (pub && connectionMode === 'readwrite') {
      saveToSheet(pubId, pub.scores);
    }
    setEditingId(null);
  };

  const addPublication = async () => {
    if (!newPubName.trim()) return;

    const newPub = {
      id: Date.now(),
      name: newPubName.trim(),
      row: null, // Will be set by server response or calculated locally
      scores: {
        authority: 0,
        aiCitations: 0,
        content: 0,
        topical: 0,
        search: 0,
        social: 0
      }
    };

    if (connectionMode === 'readwrite' && APPS_SCRIPT_URL) {
      try {
        const response = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'add',
            name: newPub.name
          })
        });
        const data = await response.json();
        if (data.error) {
          throw new Error(data.error);
        }
        // Use the row number returned by the server
        newPub.row = data.row;
      } catch (err) {
        setError(`Failed to add publication: ${err.message}`);
        return;
      }
    } else {
      // For local-only mode, calculate row based on max existing row
      const maxRow = publications.reduce((max, p) => Math.max(max, p.row || 0), 1);
      newPub.row = maxRow + 1;
    }

    setPublications([...publications, newPub]);
    setNewPubName('');
    setEditingId(newPub.id);
  };

  const sortedPublications = [...publications].sort((a, b) => {
    return calculateScore(b.scores) - calculateScore(a.scores);
  });

  const exportData = () => {
    const headers = ['Rank', 'Publication', 'Overall Score', ...Object.values(SIGNAL_LABELS)];
    const rows = sortedPublications.map((pub, index) => [
      index + 1,
      pub.name,
      calculateScore(pub.scores).toFixed(1),
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
      case 'readwrite':
        return <span style={{ color: '#FFD700' }}>● Connected (Read/Write)</span>;
      case 'readonly':
        return <span style={{ color: '#f00069' }}>● Connected (Read Only)</span>;
      default:
        return <span className="text-red-400">○ Not Connected</span>;
    }
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
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder="Password"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-gray-100 placeholder-gray-600 focus:outline-none mb-4"
              onFocus={(e) => e.target.style.borderColor = '#FFD700'}
              onBlur={(e) => e.target.style.borderColor = ''}
              autoFocus
            />
            {authError && (
              <p className="text-red-400 text-sm mb-4">{authError}</p>
            )}
            <button
              type="submit"
              className="w-full text-gray-900 font-medium py-3 rounded-lg transition-colors"
              style={{ background: '#FFD700' }}
              onMouseEnter={(e) => e.target.style.background = '#ffeb3b'}
              onMouseLeave={(e) => e.target.style.background = '#FFD700'}
            >
              Login
            </button>
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
          <div className="animate-spin w-8 h-8 border-2 border-t-transparent rounded-full mx-auto mb-4" style={{ borderColor: '#FFD700', borderTopColor: 'transparent' }}></div>
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
            <p className="text-gray-500 text-sm tracking-wide">
              AI Authority Evaluation for Luxury Travel & Hospitality
            </p>
            <p className="text-gray-600 text-xs mt-1">by Make Lemonade Fizz</p>
          </div>
          <div className="text-right text-xs">
            <div className="mb-2">{getConnectionBadge()}</div>
            {lastSync && (
              <div className="text-gray-600">
                Last sync: {lastSync.toLocaleTimeString()}
              </div>
            )}
            {syncing && (
              <div className="animate-pulse" style={{ color: '#FFD700' }}>Saving...</div>
            )}
            <button
              onClick={handleLogout}
              className="mt-2 text-gray-600 hover:text-gray-400 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="mb-4 bg-red-900/30 border border-red-800 rounded-lg p-3 text-red-400 text-sm">
            {error}
            <button onClick={() => setError(null)} className="ml-4 text-red-600 hover:text-red-400">✕</button>
          </div>
        )}

        {/* Connection Setup Guide */}
        {connectionMode === 'not_configured' && (
          <div className="mb-6 bg-gray-900/50 border border-gray-800 rounded-lg p-4">
            <h3 className="text-sm font-medium mb-2" style={{ color: '#FFD700' }}>Setup Google Sheets Connection</h3>
            <p className="text-gray-500 text-xs mb-3">To connect to your master dashboard, you need to deploy a Google Apps Script. See instructions in the code comments.</p>
            {SHEET_ID && (
              <a
                href={`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded transition-colors inline-block"
              >
                Open Master Sheet →
              </a>
            )}
          </div>
        )}

        {/* Weights Display */}
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

        {/* Add Publication */}
        <div className="mb-6 flex gap-3">
          <input
            type="text"
            value={newPubName}
            onChange={(e) => setNewPubName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPublication()}
            placeholder="Add new publication..."
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-gray-100 placeholder-gray-600 focus:outline-none transition-colors"
            style={{ '--focus-border': '#FFD700' }}
            onFocus={(e) => e.target.style.borderColor = '#FFD700'}
            onBlur={(e) => e.target.style.borderColor = ''}
          />
          <button
            onClick={addPublication}
            className="text-gray-900 font-medium px-6 py-3 rounded-lg transition-colors"
            style={{ background: '#FFD700' }}
            onMouseEnter={(e) => e.target.style.background = '#ffeb3b'}
            onMouseLeave={(e) => e.target.style.background = '#FFD700'}
          >
            Add
          </button>
          <button
            onClick={loadData}
            className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-3 rounded-lg transition-colors"
            title="Refresh from sheet"
          >
            ↻
          </button>
        </div>

        {/* Rankings Table */}
        {publications.length > 0 && (
          <div className="mb-6 bg-gray-900/50 rounded-lg border border-gray-800 overflow-hidden">
            <div className="p-4 border-b border-gray-800 flex justify-between items-center">
              <h2 className="text-lg font-light tracking-wide">
                Ranked Evaluation
                <span className="text-gray-600 text-sm ml-2">({publications.length} publications)</span>
              </h2>
              <button
                onClick={exportData}
                className="text-xs bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded transition-colors"
              >
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
                      <tr 
                        key={pub.id} 
                        className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors ${isEditing ? 'bg-gray-800/50' : ''}`}
                      >
                        <td className="px-4 py-3">
                          <span
                            className={`font-mono ${index === 1 ? 'text-gray-400' : index === 2 ? 'text-amber-700' : index > 2 ? 'text-gray-600' : ''}`}
                            style={index === 0 ? { color: '#FFD700' } : {}}
                          >
                            {index + 1}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium">{pub.name}</td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className="font-mono text-lg"
                            style={{ color: score >= 70 ? '#FFD700' : score >= 50 ? '#f00069' : score >= 30 ? '#ff8c00' : '#ef4444' }}
                          >
                            {score.toFixed(1)}
                          </span>
                        </td>
                        {Object.keys(WEIGHTS).map(key => (
                          <td key={key} className="px-3 py-3 text-center">
                            {isEditing ? (
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={pub.scores[key]}
                                onChange={(e) => updateScore(pub.id, key, e.target.value)}
                                className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-center text-gray-100 focus:outline-none"
                                onFocus={(e) => e.target.style.borderColor = '#FFD700'}
                                onBlur={(e) => e.target.style.borderColor = ''}
                              />
                            ) : (
                              <span
                                className="font-mono"
                                style={{ color: pub.scores[key] >= 70 ? 'rgba(255, 215, 0, 0.8)' : pub.scores[key] >= 50 ? '#d1d5db' : '#6b7280' }}
                              >
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
                              onMouseLeave={(e) => { if (isEditing) e.target.style.background = '#FFD700'; }}
                            >
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

        {/* Visual Score Bars */}
        {publications.length > 0 && (
          <div className="bg-gray-900/50 rounded-lg border border-gray-800 p-4">
            <h3 className="text-sm text-gray-500 uppercase tracking-wider mb-4">Score Distribution</h3>
            <div className="space-y-3">
              {sortedPublications.slice(0, 15).map((pub, index) => {
                const score = calculateScore(pub.scores);
                const barGradient = score >= 70
                  ? 'linear-gradient(to right, #b8860b, #FFD700)'
                  : score >= 50
                  ? 'linear-gradient(to right, #c5004f, #f00069)'
                  : score >= 30
                  ? 'linear-gradient(to right, #cc5500, #ff8c00)'
                  : 'linear-gradient(to right, #b91c1c, #ef4444)';
                return (
                  <div key={pub.id} className="flex items-center gap-4">
                    <span className="w-6 text-xs font-mono text-gray-600">{index + 1}</span>
                    <span className="w-48 text-sm truncate">{pub.name}</span>
                    <div className="flex-1 h-6 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${score}%`, background: barGradient }}
                      />
                    </div>
                    <span className="w-12 text-right font-mono text-sm">{score.toFixed(1)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
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
// GOOGLE APPS SCRIPT CODE
// ============================================
// Copy everything below into your Google Apps Script editor
// (Extensions > Apps Script in your Google Sheet)
/*

function doGet(e) {
  const action = e.parameter.action;
  
  if (action === 'read') {
    return readData();
  }
  
  return ContentService.createTextOutput(JSON.stringify({ error: 'Invalid action' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  
  if (data.action === 'update') {
    return updateRow(data);
  } else if (data.action === 'add') {
    return addRow(data);
  }
  
  return ContentService.createTextOutput(JSON.stringify({ error: 'Invalid action' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function readData() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Master_Dashboard');
  const data = sheet.getDataRange().getValues();
  
  // Remove header row
  const rows = data.slice(1);
  
  return ContentService.createTextOutput(JSON.stringify({ data: rows }))
    .setMimeType(ContentService.MimeType.JSON);
}

function updateRow(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Master_Dashboard');
  const row = data.row;
  
  // Update scores (columns D through I, which are 4-9)
  // Column B is Overall Score, Columns D-I are the 6 signal scores
  sheet.getRange(row, 2).setValue(data.overallScore); // Overall Score
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
  sheet.getRange(lastRow, 2).setValue(0); // Overall Score
  
  return ContentService.createTextOutput(JSON.stringify({ success: true, row: lastRow }))
    .setMimeType(ContentService.MimeType.JSON);
}

*/
