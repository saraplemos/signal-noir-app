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

  // ── Query Intelligence data ─────────────────────────────────────────────────
  const SOURCE_TYPES = {
    editorial: { label: 'Premium Editorial', color: '#FFD700', bg: 'rgba(255,215,0,0.15)', border: 'rgba(255,215,0,0.4)' },
    official:  { label: 'Official Brand / Destination', color: '#60a5fa', bg: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.4)' },
    specialist:{ label: 'Specialist Operator', color: '#2dd4bf', bg: 'rgba(45,212,191,0.12)', border: 'rgba(45,212,191,0.4)' },
    aggregator:{ label: 'Booking / Review Aggregator', color: '#f97316', bg: 'rgba(249,115,22,0.15)', border: 'rgba(249,115,22,0.4)' },
    blog:      { label: 'Commercial / Points Blog', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.4)' },
    youtube:   { label: 'YouTube', color: '#ef4444', bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.4)' },
  };

  const QUERY_DATA = [
    // ── BATCH 1: Hotels & Safari (Q1–12) ──────────────────────────────────────
    { id:1, topic:'Luxury hotel Dubai', category:'Hotels',
      chatgpt:[
        {n:'The Times Travel',t:'editorial'},
        {n:'Condé Nast Traveller UK',t:'editorial'},
        {n:'Condé Nast Traveler US',t:'editorial'},
        {n:'Four Seasons Press Room',t:'official'},
      ],
      perplexity:[
        {n:'LOCALS Insider',t:'blog'},
      ],
      gemini:[
        {n:'Condé Nast Traveler',t:'editorial'},
        {n:'Forbes Travel Guide',t:'editorial'},
        {n:'Four Seasons Press Room',t:'official'},
      ],
      claude:[
        {n:'MICHELIN Guide',t:'editorial'},
        {n:'TripAdvisor',t:'aggregator'},
        {n:'Expedia',t:'aggregator'},
        {n:'MakeMyTrip',t:'aggregator'},
      ]},
    { id:2, topic:'Desert resort Dubai', category:'Hotels',
      chatgpt:[
        {n:'Condé Nast Traveler',t:'editorial'},
        {n:'Marriott / Al Maha',t:'official'},
        {n:'Bab Al Shams',t:'official'},
      ],
      perplexity:[
        {n:'HIDMC',t:'blog'},
        {n:'God Save The Points',t:'blog'},
      ],
      gemini:[
        {n:'Condé Nast Traveler',t:'editorial'},
        {n:'Expedia',t:'aggregator'},
        {n:'Marriott.com',t:'official'},
      ],
      claude:[
        {n:'Booking.com',t:'aggregator'},
        {n:'TripAdvisor',t:'aggregator'},
        {n:'Travel Weekly',t:'editorial'},
        {n:'Bab Al Shams',t:'official'},
      ]},
    { id:3, topic:'Ski chalet Courchevel', category:'Ski',
      chatgpt:[
        {n:'Financial Times',t:'editorial'},
        {n:'Cheval Blanc',t:'official'},
        {n:'Leo Trippi',t:'specialist'},
      ],
      perplexity:[
        {n:'Ski In Luxury',t:'specialist'},
        {n:'Alpine Luxury Chalets',t:'specialist'},
      ],
      gemini:[
        {n:'Kaluma Ski',t:'specialist'},
        {n:'Telegraph Travel',t:'editorial'},
        {n:'Forbes Travel Guide',t:'editorial'},
      ],
      claude:[
        {n:'Courchevel.com',t:'blog'},
        {n:'Ski In Luxury',t:'specialist'},
        {n:'Le Collectionist',t:'specialist'},
        {n:'Ultimate Luxury Chalets',t:'specialist'},
      ]},
    { id:4, topic:'Luxury ski resort Verbier', category:'Ski',
      chatgpt:[
        {n:'TripAdvisor',t:'aggregator'},
        {n:'Experimental Chalet',t:'official'},
      ],
      perplexity:[
        {n:'Oxford Ski',t:'specialist'},
        {n:'Ski In Luxury',t:'specialist'},
      ],
      gemini:[
        {n:'Booking.com',t:'aggregator'},
        {n:'Forbes Travel Guide',t:'editorial'},
        {n:'Virgin Limited Edition',t:'official'},
      ],
      claude:[
        {n:'Scott Dunn',t:'specialist'},
        {n:'W Hotels / Marriott',t:'official'},
        {n:'Oxford Ski',t:'specialist'},
        {n:'Le Collectionist',t:'specialist'},
      ]},
    { id:5, topic:'Luxury resort Maldives', category:'Islands',
      chatgpt:[
        {n:'Condé Nast Traveller',t:'editorial'},
        {n:'Condé Nast Traveler',t:'editorial'},
        {n:'Forbes Travel Guide',t:'editorial'},
      ],
      perplexity:[
        {n:'YouTube (Tourpoint)',t:'youtube'},
      ],
      gemini:[
        {n:'YouTube (Top 10 Luxury Resorts)',t:'youtube'},
        {n:'Condé Nast Traveler',t:'editorial'},
        {n:'Travel + Leisure',t:'editorial'},
      ],
      claude:[
        {n:'Dorsia Travel',t:'blog'},
        {n:'Maldives Magazine',t:'blog'},
        {n:'The Asia Collective',t:'specialist'},
        {n:'Jetset & Travel',t:'blog'},
      ]},
    { id:6, topic:'Private island Maldives', category:'Islands',
      chatgpt:[
        {n:'Forbes Travel Guide (Velaa)',t:'editorial'},
        {n:'Forbes Travel Guide (Kudadoo)',t:'editorial'},
      ],
      perplexity:[
        {n:'YouTube (Tourpoint)',t:'youtube'},
        {n:'Niyama Private Islands',t:'official'},
      ],
      gemini:[
        {n:'Forbes Travel Guide',t:'editorial'},
        {n:'Four Seasons Press Room',t:'official'},
        {n:'Velaa Private Island',t:'official'},
      ],
      claude:[
        {n:'Kudadoo.com',t:'official'},
        {n:'Four Seasons Voavah',t:'official'},
        {n:'Travel Mole',t:'blog'},
        {n:'Vladi Private Islands',t:'specialist'},
      ]},
    { id:7, topic:'Private island Caribbean', category:'Islands',
      chatgpt:[
        {n:'Condé Nast Traveler',t:'editorial'},
        {n:'Condé Nast Traveller UK',t:'editorial'},
      ],
      perplexity:[
        {n:'Ambergris Cay',t:'official'},
        {n:'Carib Journal',t:'blog'},
      ],
      gemini:[
        {n:'Lifestyle Travel Network',t:'blog'},
        {n:'Travel + Leisure',t:'editorial'},
        {n:'Virgin Limited Edition',t:'official'},
      ],
      claude:[
        {n:'Private Islands Online',t:'aggregator'},
        {n:'Vladi Private Islands',t:'specialist'},
        {n:'WIMCO Villas',t:'specialist'},
        {n:'Mustique Island',t:'official'},
      ]},
    { id:8, topic:'Luxury hotel Lake Como', category:'Hotels',
      chatgpt:[
        {n:'Vogue',t:'editorial'},
        {n:'Condé Nast Traveler',t:'editorial'},
      ],
      perplexity:[
        {n:'YouTube (Luxury Travel)',t:'youtube'},
      ],
      gemini:[
        {n:'Forbes Travel Guide',t:'editorial'},
        {n:"World's 50 Best Hotels",t:'editorial'},
        {n:'Condé Nast Traveler',t:'editorial'},
      ],
      claude:[
        {n:'Elite Traveler',t:'editorial'},
        {n:'Hotels.com',t:'aggregator'},
        {n:'Travelocity',t:'aggregator'},
        {n:'Luxury Escapes',t:'aggregator'},
      ]},
    { id:9, topic:'Luxury hotel Amalfi Coast', category:'Hotels',
      chatgpt:[
        {n:'Condé Nast Traveller',t:'editorial'},
        {n:'Condé Nast Traveler',t:'editorial'},
      ],
      perplexity:[
        {n:'Luxury.it',t:'blog'},
      ],
      gemini:[
        {n:"Lulu's Luxury Lifestyle",t:'blog'},
        {n:'Forbes Travel Guide',t:'editorial'},
        {n:'Belmond',t:'official'},
      ],
      claude:[
        {n:'Mr & Mrs Smith',t:'specialist'},
        {n:'TripAdvisor',t:'aggregator'},
        {n:'Luxury Escapes',t:'aggregator'},
        {n:'American Express Travel',t:'aggregator'},
      ]},
    { id:10, topic:'Boutique hotel French Riviera', category:'Hotels',
      chatgpt:[
        {n:'Vogue',t:'editorial'},
        {n:'Mr & Mrs Smith',t:'specialist'},
        {n:'Condé Nast Traveler',t:'editorial'},
      ],
      perplexity:[
        {n:'Les Boutique Hotels',t:'blog'},
      ],
      gemini:[
        {n:'Tablet Hotels',t:'specialist'},
        {n:'Michelin Guide',t:'editorial'},
        {n:'Mr & Mrs Smith',t:'specialist'},
      ],
      claude:[
        {n:'Mr & Mrs Smith',t:'specialist'},
        {n:'Small Luxury Hotels',t:'specialist'},
        {n:'TripAdvisor',t:'aggregator'},
        {n:'Booking.com',t:'aggregator'},
      ]},
    { id:11, topic:'Luxury hotel Kyoto', category:'Hotels',
      chatgpt:[
        {n:'Vogue',t:'editorial'},
        {n:'Condé Nast Traveler',t:'editorial'},
      ],
      perplexity:[],
      gemini:[
        {n:'Forbes Travel Guide',t:'editorial'},
        {n:'Booking.com',t:'aggregator'},
        {n:'Travel + Leisure',t:'editorial'},
      ],
      claude:[
        {n:'MICHELIN Guide',t:'editorial'},
        {n:'Mr & Mrs Smith',t:'specialist'},
        {n:'TripAdvisor',t:'aggregator'},
        {n:'Hotel The Mitsui Kyoto',t:'official'},
      ]},
    { id:12, topic:'Luxury safari lodge Tanzania', category:'Safari',
      chatgpt:[
        {n:'Condé Nast Traveller',t:'editorial'},
        {n:'Financial Times',t:'editorial'},
        {n:'&Beyond',t:'official'},
      ],
      perplexity:[
        {n:'Tanzania National Parks',t:'official'},
        {n:'Go2Africa',t:'specialist'},
      ],
      gemini:[
        {n:'Africa Travel',t:'specialist'},
        {n:'Ubuntu Travel Group',t:'specialist'},
        {n:'Singita',t:'official'},
      ],
      claude:[
        {n:'TripAdvisor',t:'aggregator'},
        {n:'Serengeti.com',t:'blog'},
        {n:'Go2Africa',t:'specialist'},
        {n:'Singita',t:'official'},
      ]},

    // ── BATCH 2: Experiences, Wellness & Adventure (Q13–22) ───────────────────
    { id:13, topic:'Private museum tour Paris', category:'Experiences',
      chatgpt:[
        {n:'Louvre (official)',t:'official'},
        {n:'Context Travel',t:'specialist'},
        {n:'Musée d\'Orsay (official)',t:'official'},
      ],
      perplexity:[
        {n:'Paris Luxury Tours',t:'specialist'},
        {n:'Paris By Emy',t:'specialist'},
        {n:'My Private Paris',t:'specialist'},
      ],
      gemini:[
        {n:'Grand Hôtel du Palais Royal',t:'official'},
        {n:'My Private Paris',t:'specialist'},
        {n:'Paris to Versailles Tours',t:'specialist'},
      ],
      claude:[
        {n:'Louvre (official)',t:'official'},
        {n:'Paris Muse',t:'specialist'},
        {n:'Viator',t:'aggregator'},
        {n:'GetYourGuide',t:'aggregator'},
      ]},
    { id:14, topic:'Private Vatican tour', category:'Experiences',
      chatgpt:[
        {n:'Vatican Museums (official)',t:'official'},
        {n:'Context Travel',t:'specialist'},
        {n:'Through Eternity Tours',t:'specialist'},
      ],
      perplexity:[
        {n:'Vatican Tickets Online',t:'specialist'},
        {n:'LivTours',t:'specialist'},
        {n:'Italy by Luxe',t:'specialist'},
      ],
      gemini:[
        {n:'The Tour Guy',t:'specialist'},
        {n:'The Vatican Tickets',t:'specialist'},
      ],
      claude:[
        {n:'Vatican Museums (official)',t:'official'},
        {n:'Walks of Italy',t:'specialist'},
        {n:'LivTours',t:'specialist'},
        {n:'The Roman Guy',t:'specialist'},
      ]},
    { id:15, topic:'Private cooking class local chef', category:'Experiences',
      chatgpt:[
        {n:'Traveling Spoon',t:'specialist'},
        {n:'Eatwith',t:'specialist'},
        {n:'Airbnb Experiences',t:'aggregator'},
      ],
      perplexity:[
        {n:'Luxury Gold',t:'specialist'},
        {n:'Four Seasons Chiang Mai',t:'official'},
      ],
      gemini:[
        {n:'La Côte Saint-Jacques',t:'official'},
        {n:'Michelin Guide',t:'editorial'},
      ],
      claude:[
        {n:'EatWith',t:'specialist'},
        {n:'Traveling Spoon',t:'specialist'},
        {n:'Airbnb Experiences',t:'aggregator'},
        {n:'Context Travel',t:'specialist'},
      ]},
    { id:16, topic:'Wellness retreat', category:'Wellness',
      chatgpt:[
        {n:'Condé Nast Traveller UK',t:'editorial'},
        {n:'Condé Nast Traveller ME',t:'editorial'},
        {n:'Condé Nast Traveler US',t:'editorial'},
      ],
      perplexity:[
        {n:'The Luxury Travel Expert',t:'blog'},
        {n:'Locals Insider',t:'blog'},
        {n:'Luxe Wellness Club',t:'blog'},
      ],
      gemini:[
        {n:'Condé Nast Traveller',t:'editorial'},
        {n:'Explore.com',t:'blog'},
      ],
      claude:[
        {n:'SHA Wellness Clinic',t:'official'},
        {n:'COMO Hotels',t:'official'},
        {n:'Condé Nast Traveler',t:'editorial'},
        {n:'SpaFinder',t:'aggregator'},
      ]},
    { id:17, topic:'Medical wellness program', category:'Wellness',
      chatgpt:[
        {n:'Clinique La Prairie',t:'official'},
        {n:'Lanserhof',t:'official'},
        {n:'SHA Wellness Clinic',t:'official'},
      ],
      perplexity:[
        {n:'GetTransfer Blog',t:'blog'},
        {n:'RAKxa Integrative Wellness',t:'official'},
      ],
      gemini:[
        {n:'Lanserhof',t:'official'},
        {n:'Wellbeing Escapes',t:'specialist'},
        {n:'SHA Wellness Clinic',t:'official'},
      ],
      claude:[
        {n:'Lanserhof',t:'official'},
        {n:'Chenot',t:'official'},
        {n:'Six Senses',t:'official'},
        {n:'Medical Tourism Association',t:'specialist'},
      ]},
    { id:18, topic:'Antarctic expedition cruise', category:'Adventure',
      chatgpt:[
        {n:'Quark Expeditions',t:'specialist'},
        {n:'Silversea',t:'official'},
        {n:'PONANT',t:'official'},
        {n:'National Geographic Expeditions',t:'editorial'},
      ],
      perplexity:[
        {n:'Antarctica Cruises',t:'specialist'},
        {n:'Swoop Antarctica',t:'specialist'},
        {n:'Cruise Critic',t:'aggregator'},
      ],
      gemini:[
        {n:'Silversea',t:'official'},
        {n:'Luxury Check-In',t:'blog'},
        {n:'Ponant',t:'official'},
      ],
      claude:[
        {n:'Quark Expeditions',t:'specialist'},
        {n:'Silversea',t:'official'},
        {n:'IAATO',t:'official'},
        {n:'Cruise Critic',t:'aggregator'},
      ]},
    { id:19, topic:'Northern lights private charter', category:'Adventure',
      chatgpt:[
        {n:'Visit Tromsø',t:'official'},
        {n:'Arctic GM',t:'specialist'},
        {n:'TCS World Travel',t:'specialist'},
      ],
      perplexity:[
        {n:'TCS World Travel',t:'specialist'},
        {n:'Reykjavik Tourist Info',t:'official'},
      ],
      gemini:[
        {n:'Lapland Private',t:'specialist'},
        {n:'Aurora Zone',t:'specialist'},
      ],
      claude:[
        {n:'Guide to Iceland',t:'blog'},
        {n:'Hurtigruten',t:'official'},
        {n:'Visit Norway',t:'official'},
        {n:'Aurora Forecast',t:'specialist'},
      ]},
    { id:20, topic:'Heli-skiing British Columbia', category:'Adventure',
      chatgpt:[
        {n:'CMH Heli-Skiing',t:'official'},
        {n:'Mike Wiegele',t:'official'},
        {n:'Condé Nast Traveler',t:'editorial'},
      ],
      perplexity:[
        {n:'Bella Coola Heli Sports',t:'official'},
        {n:'Mabey Ski',t:'specialist'},
      ],
      gemini:[
        {n:'CMH Heli-Skiing',t:'official'},
        {n:'Bella Coola Heli Sports',t:'official'},
        {n:'Global Air Charters',t:'specialist'},
      ],
      claude:[
        {n:'CMH Heli-Skiing',t:'official'},
        {n:'Bella Coola Heli Sports',t:'official'},
        {n:'HeliCat Canada',t:'official'},
        {n:'Powder Magazine',t:'editorial'},
      ]},
    { id:21, topic:'Venice Simplon Orient Express', category:'Transport',
      chatgpt:[
        {n:'Belmond',t:'official'},
        {n:'Condé Nast Traveller UK',t:'editorial'},
        {n:'Condé Nast Traveler US',t:'editorial'},
      ],
      perplexity:[
        {n:'Luxury Train Tickets',t:'specialist'},
        {n:'Railtour',t:'specialist'},
      ],
      gemini:[
        {n:'Belmond',t:'official'},
        {n:'Condé Nast Traveler',t:'editorial'},
      ],
      claude:[
        {n:'Belmond',t:'official'},
        {n:'Condé Nast Traveler',t:'editorial'},
        {n:'Travel + Leisure',t:'editorial'},
      ]},
    { id:22, topic:'Private safari lodge Botswana', category:'Safari',
      chatgpt:[
        {n:'Expert Africa',t:'specialist'},
        {n:'Wilderness (Mombo)',t:'official'},
        {n:'Great Plains Conservation',t:'official'},
      ],
      perplexity:[
        {n:'The Luxury Travel Expert',t:'blog'},
        {n:'Passport and Pixels',t:'blog'},
      ],
      gemini:[
        {n:'Alluring Africa',t:'specialist'},
        {n:'Africa Odyssey',t:'specialist'},
        {n:'Wilderness Destinations',t:'official'},
      ],
      claude:[
        {n:'Great Plains Conservation',t:'official'},
        {n:'Wilderness Safaris',t:'official'},
        {n:'&Beyond',t:'official'},
        {n:'Safari Bookings',t:'aggregator'},
      ]},

    // ── BATCH 3: Villas, Yachts & Private Travel (Q23–30) ────────────────────
    { id:23, topic:'Villa with chef & staff Tuscany', category:'Villas',
      chatgpt:[
        {n:'Tuscany Now & More',t:'specialist'},
        {n:'Home in Italy',t:'specialist'},
        {n:'Le Collectionist',t:'specialist'},
      ],
      perplexity:[
        {n:'Coselli',t:'specialist'},
        {n:'Arianna and Friends',t:'specialist'},
        {n:'Il Casale del Marchese',t:'official'},
      ],
      gemini:[
        {n:'Tuscan Dream',t:'specialist'},
        {n:'Kinglike Concierge',t:'specialist'},
      ],
      claude:[
        {n:'The Thinking Traveller',t:'specialist'},
        {n:"Oliver's Travels",t:'specialist'},
        {n:'CV Villas',t:'specialist'},
        {n:'Scott Dunn',t:'specialist'},
      ]},
    { id:24, topic:'Ski chalet with catering Verbier', category:'Ski',
      chatgpt:[
        {n:'Verbier Exclusive',t:'specialist'},
        {n:'Ultimate Luxury Chalets',t:'specialist'},
        {n:'Leo Trippi',t:'specialist'},
        {n:'SeeVerbier',t:'blog'},
      ],
      perplexity:[
        {n:'David Pearson Travel',t:'specialist'},
        {n:'Luxury Chalet Co.',t:'specialist'},
        {n:'Verbier.co',t:'blog'},
      ],
      gemini:[
        {n:'Verbier Exclusive',t:'specialist'},
        {n:'Oxford Ski Company',t:'specialist'},
      ],
      claude:[
        {n:'Leo Trippi',t:'specialist'},
        {n:'Scott Dunn',t:'specialist'},
        {n:'Ski In Luxury',t:'specialist'},
        {n:'Powder Byrne',t:'specialist'},
      ]},
    { id:25, topic:'Yacht charter Mediterranean', category:'Yachts',
      chatgpt:[
        {n:'Fraser Yachts',t:'specialist'},
        {n:'Burgess',t:'specialist'},
        {n:'Camper & Nicholsons',t:'specialist'},
      ],
      perplexity:[
        {n:'Northrop & Johnson',t:'specialist'},
        {n:'Mediterranean Yacht Charters',t:'specialist'},
      ],
      gemini:[
        {n:'Fraser Yachts',t:'specialist'},
        {n:'Sunsail',t:'specialist'},
      ],
      claude:[
        {n:'Fraser Yachts',t:'specialist'},
        {n:'Burgess',t:'specialist'},
        {n:'Boat International',t:'editorial'},
        {n:'CharterWorld',t:'aggregator'},
      ]},
    { id:26, topic:'Private island resort with butler Maldives', category:'Islands',
      chatgpt:[
        {n:'St. Regis Maldives',t:'official'},
        {n:'St. Regis Butler Service',t:'official'},
        {n:'SUNxSIYAM Resorts',t:'official'},
      ],
      perplexity:[
        {n:'Go Ocean Travel',t:'blog'},
      ],
      gemini:[
        {n:'The Ritz-Carlton Maldives',t:'official'},
        {n:'St. Regis Maldives',t:'official'},
      ],
      claude:[
        {n:'Condé Nast Traveller',t:'editorial'},
        {n:'Mr & Mrs Smith',t:'specialist'},
        {n:'Velaa Private Island',t:'official'},
        {n:'Cheval Blanc',t:'official'},
      ]},
    { id:27, topic:'Multi-generational villa rental', category:'Villas',
      chatgpt:[
        {n:'onefinestay',t:'specialist'},
        {n:'Mandarin Oriental Exceptional Homes',t:'official'},
        {n:'Le Collectionist',t:'specialist'},
      ],
      perplexity:[
        {n:'Villas of Distinction',t:'specialist'},
        {n:'CV Villas',t:'specialist'},
      ],
      gemini:[
        {n:'Tripwix',t:'specialist'},
        {n:'Bailey Robinson',t:'specialist'},
      ],
      claude:[
        {n:'Scott Dunn',t:'specialist'},
        {n:'CV Villas',t:'specialist'},
        {n:'VillaNoVo',t:'specialist'},
        {n:'Travel + Leisure',t:'editorial'},
      ]},
    { id:28, topic:'Family estate rental', category:'Villas',
      chatgpt:[
        {n:"Oliver's Travels",t:'specialist'},
        {n:'Le Collectionist',t:'specialist'},
        {n:'Mandarin Oriental Exceptional Homes',t:'official'},
      ],
      perplexity:[
        {n:'Haute Retreats',t:'specialist'},
        {n:'Elite Havens',t:'specialist'},
      ],
      gemini:[
        {n:'Haute Retreats',t:'specialist'},
        {n:'Le Collectionist',t:'specialist'},
      ],
      claude:[
        {n:'Unique Homestays',t:'specialist'},
        {n:'Rural Retreats',t:'specialist'},
        {n:'Condé Nast Traveller',t:'editorial'},
        {n:'Historic Houses',t:'specialist'},
      ]},
    { id:29, topic:'Bespoke tour operators Antarctica', category:'Adventure',
      chatgpt:[
        {n:'Black Tomato',t:'specialist'},
        {n:'Abercrombie & Kent',t:'specialist'},
        {n:'Quark Expeditions',t:'specialist'},
      ],
      perplexity:[
        {n:'Extraordinary Journeys',t:'specialist'},
      ],
      gemini:[
        {n:'Cruise Critic',t:'aggregator'},
        {n:'Scenic Luxury Cruises',t:'official'},
      ],
      claude:[
        {n:'White Desert',t:'specialist'},
        {n:'Silversea',t:'official'},
        {n:'Abercrombie & Kent',t:'specialist'},
        {n:'Cooksons Adventures',t:'specialist'},
      ]},
    { id:30, topic:'Private jet charter London–New York', category:'Transport',
      chatgpt:[
        {n:'PrivateFly',t:'specialist'},
        {n:'VistaJet',t:'official'},
        {n:'NetJets',t:'official'},
        {n:'LunaJets',t:'specialist'},
      ],
      perplexity:[
        {n:'Private Jet London to New York',t:'specialist'},
      ],
      gemini:[
        {n:'ACC Aviation',t:'specialist'},
        {n:'Global Charter',t:'specialist'},
      ],
      claude:[
        {n:'VistaJet',t:'official'},
        {n:'NetJets',t:'official'},
        {n:'PrivateFly',t:'specialist'},
        {n:'FlyVictor',t:'specialist'},
      ]},
  ];

  // ── Query Intelligence panel ────────────────────────────────────────────────
  const QueryResultsPanel = () => {
    const [qFilter, setQFilter] = React.useState('all');
    const [catFilter, setCatFilter] = React.useState('All');
    const categories = ['All', ...Array.from(new Set(QUERY_DATA.map(q => q.category)))];
    const platforms = ['all','chatgpt','perplexity','gemini','claude'];
    const platformLabels = { all:'All Platforms', chatgpt:'ChatGPT', perplexity:'Perplexity', gemini:'Gemini', claude:'Claude' };
    const platformColors = { chatgpt:'#10a37f', perplexity:'#20b2aa', gemini:'#4285f4', claude:'#c9a96e' };

    const countType = (sources, type) => sources.filter(s => s.t === type).length;
    const isDiverged = (q) => {
      const all = [...q.chatgpt, ...q.perplexity, ...q.gemini, ...q.claude];
      const editorialCount = all.filter(s => s.t === 'editorial').length;
      const nonEditorialCount = all.filter(s => s.t !== 'editorial' && s.t !== 'official').length;
      return nonEditorialCount >= editorialCount;
    };

    const totalNonEditorial = QUERY_DATA.reduce((acc, q) => {
      const all = [...q.chatgpt, ...q.perplexity, ...q.gemini, ...q.claude];
      return acc + all.filter(s => s.t !== 'editorial' && s.t !== 'official').length;
    }, 0);
    const totalSources = QUERY_DATA.reduce((acc, q) =>
      acc + q.chatgpt.length + q.perplexity.length + q.gemini.length + q.claude.length, 0);
    const divergedCount = QUERY_DATA.filter(isDiverged).length;
    const youtubeCount = QUERY_DATA.filter(q =>
      [...q.chatgpt,...q.perplexity,...q.gemini,...q.claude].some(s => s.t === 'youtube')).length;

    const filtered = QUERY_DATA.filter(q =>
      (catFilter === 'All' || q.category === catFilter)
    );

    const renderSources = (sources, platform) => {
      const visible = qFilter === 'all' || qFilter === platform;
      if (!visible) return null;
      if (!sources || sources.length === 0) return (
        <span className="text-xs text-gray-600 italic">No data</span>
      );
      return sources.map((s, i) => {
        const st = SOURCE_TYPES[s.t] || SOURCE_TYPES.blog;
        return (
          <span key={i} className="inline-flex items-center text-xs px-2 py-0.5 rounded-full mr-1 mb-1"
            style={{ background: st.bg, border: `1px solid ${st.border}`, color: st.color, fontWeight: 500 }}>
            {s.n}
          </span>
        );
      });
    };

    return (
      <div className="mb-6">
        <button onClick={() => setSignalPage(null)}
          className="mb-4 text-gray-500 hover:text-gray-300 text-sm flex items-center gap-1 transition-colors">
          ← Back to dashboard
        </button>

        {/* Batch status */}
        <div className="mb-5 flex items-center gap-3 px-4 py-3 rounded-lg border"
          style={{ background: 'rgba(255,215,0,0.05)', borderColor: 'rgba(255,215,0,0.2)' }}>
          <span className="text-sm font-mono" style={{ color: '#FFD700' }}>ALL 3 BATCHES COMPLETE</span>
          <span className="text-gray-500 text-xs">30 queries tested · Batches 1–3 · Verified Feb 14 2026</span>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 gap-3 mb-6 sm:grid-cols-4">
          {[
            { label: 'Queries verified', val: `${QUERY_DATA.length}`, sub: 'across Batches 1–3 (Hotels, Experiences, Villas)' },
            { label: 'Platform divergence', val: `${divergedCount}/${QUERY_DATA.length}`, sub: 'queries where non-editorial leads' },
            { label: 'YouTube citations', val: `${youtubeCount} queries`, sub: 'where video outranked print' },
            { label: 'Non-editorial sources', val: `${Math.round(totalNonEditorial/totalSources*100)}%`, sub: 'of all citations across 4 platforms' },
          ].map((s,i) => (
            <div key={i} className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
              <div className="font-mono text-2xl font-bold mb-1" style={{ color: '#FFD700' }}>{s.val}</div>
              <div className="text-gray-300 text-sm font-medium">{s.label}</div>
              <div className="text-gray-600 text-xs mt-1">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Insight: Why 4 queries converged */}
        <div className="rounded-lg p-4 mb-5" style={{ background: 'rgba(255,215,0,0.05)', border: '1px solid rgba(255,215,0,0.2)' }}>
          <div className="flex items-start gap-3">
            <span style={{ color: '#FFD700', fontSize: 18 }}>◎</span>
            <div>
              <div className="text-sm font-semibold mb-1" style={{ color: '#FFD700' }}>
                Why 4/30 queries showed platform consensus
              </div>
              <div className="text-xs text-gray-400 mb-3">
                The 4 queries where all platforms agreed share one trait: dominant, unambiguous editorial authority or a single known operator. When there's a clear "correct" answer, AI platforms converge. When a category is competitive or fragmented, they diverge — and that divergence is where your clients are losing AI visibility.
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { q: 'Luxury hotel Dubai', why: 'Condé Nast + Forbes dominate across all platforms' },
                  { q: 'Luxury hotel Lake Como', why: 'Strong premium editorial consensus (Vogue, Forbes, W50Best)' },
                  { q: 'Luxury hotel Kyoto', why: 'Premium editorial led on 3 of 4 platforms' },
                  { q: 'Venice Simplon Orient Express', why: 'Single operator (Belmond) + consistent editorial coverage' },
                ].map(({ q, why }) => (
                  <div key={q} className="rounded px-3 py-2 text-xs" style={{ background: 'rgba(255,215,0,0.08)', border: '1px solid rgba(255,215,0,0.15)' }}>
                    <div style={{ color: '#FFD700' }} className="font-medium">{q}</div>
                    <div className="text-gray-500 mt-0.5">{why}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-2 mb-5">
          {Object.entries(SOURCE_TYPES).map(([k,v]) => (
            <span key={k} className="inline-flex items-center text-xs px-2 py-1 rounded-full"
              style={{ background: v.bg, border: `1px solid ${v.border}`, color: v.color }}>
              {v.label}
            </span>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-5">
          <div className="flex flex-wrap gap-2">
            {platforms.map(p => (
              <button key={p} onClick={() => setQFilter(p)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={qFilter === p
                  ? { background: p === 'all' ? '#FFD700' : platformColors[p], color: p === 'all' ? '#111' : '#fff' }
                  : { background: '#1f2937', color: '#9ca3af' }}>
                {platformLabels[p]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {categories.map(c => (
              <button key={c} onClick={() => setCatFilter(c)}
                className="px-3 py-1.5 rounded-lg text-xs transition-colors"
                style={catFilter === c ? { background: 'rgba(255,215,0,0.15)', color: '#FFD700', border: '1px solid rgba(255,215,0,0.4)' }
                  : { background: '#1f2937', color: '#6b7280', border: '1px solid transparent' }}>
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Query cards */}
        <div className="space-y-3">
          {filtered.map(q => {
            const diverged = isDiverged(q);
            return (
              <div key={q.id} className="bg-gray-900/50 border rounded-lg overflow-hidden"
                style={{ borderColor: diverged ? 'rgba(249,115,22,0.3)' : '#1f2937' }}>
                <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
                  <span className="font-mono text-xs text-gray-600 w-6">{q.id}</span>
                  <span className="text-sm font-medium text-gray-100 flex-1">{q.topic}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-500">{q.category}</span>
                  {diverged && (
                    <span className="text-xs px-2 py-0.5 rounded-full"
                      style={{ background: 'rgba(249,115,22,0.15)', color: '#f97316', border: '1px solid rgba(249,115,22,0.3)' }}>
                      ⚠ Platform divergence
                    </span>
                  )}
                </div>
                <div className="p-4 grid gap-3"
                  style={{ gridTemplateColumns: qFilter === 'all' ? 'repeat(4, 1fr)' : '1fr' }}>
                  {['chatgpt','perplexity','gemini','claude'].map(p => {
                    if (qFilter !== 'all' && qFilter !== p) return null;
                    return (
                      <div key={p}>
                        <div className="text-xs font-medium mb-2" style={{ color: platformColors[p] }}>
                          {platformLabels[p]}
                        </div>
                        <div className="flex flex-wrap">
                          {renderSources(q[p], p)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Platform divergence spotlight */}
        <div className="mt-6 bg-gray-900/50 border border-gray-800 rounded-lg p-5">
          <h3 className="text-sm text-gray-400 uppercase tracking-wider mb-4">Platform divergence spotlight — Query 1: Luxury hotel Dubai</h3>
          <div className="grid grid-cols-4 gap-4">
            {['chatgpt','perplexity','gemini','claude'].map(p => (
              <div key={p}>
                <div className="text-xs font-semibold mb-2" style={{ color: platformColors[p] }}>{platformLabels[p]}</div>
                {renderSources(QUERY_DATA[0][p], p)}
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-600 mt-4 border-t border-gray-800 pt-3">
            Same query. Four completely different authority hierarchies. ChatGPT and Gemini surface premium editorial; Perplexity leads with commercial blogs; Claude leads with aggregators. This is the structural gap Spotlight can close.
          </p>
        </div>
      </div>
    );
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
          <button onClick={() => setSignalPage('queryResults')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${signalPage === 'queryResults' ? 'text-white' : 'bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-300'}`}
            style={signalPage === 'queryResults' ? { background: '#7c3aed' } : {}}>
            ◉ Query Intelligence
          </button>
        </div>

        {/* Query Intelligence page */}
        {signalPage === 'queryResults' && <QueryResultsPanel />}

        {/* AI Citations page — custom breakdown */}
        {signalPage === 'aiCitations' && (
          <AICitationsPanel pubs={publications} breakdown={aiBreakdown} />
        )}

        {/* Other signal pages */}
        {signalPage && signalPage !== 'aiCitations' && signalPage !== 'queryResults' && (() => {
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
