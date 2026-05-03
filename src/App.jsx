import React, { useState, useEffect } from 'react';
import mammoth from 'mammoth';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { Shield, User, History as HistoryIcon, Settings, Wand2, Upload, LogOut, Copy, Check } from 'lucide-react';

// -- Utils --
const getWordCount = (text) => text.trim().split(/\s+/).filter(w => w.length > 0).length;

const extractTextFromPDF = async (file) => {
  const arrayBuffer = await file.arrayBuffer();
  // using pdfjsLib loaded via CDN
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(' ') + '\n';
  }
  return text;
};

const extractTextFromDOCX = async (file) => {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
};

const callGroq = async (systemPrompt, userText, apiKey, maxTokens = 1000, model = 'llama-3.3-70b-versatile') => {
  if (!apiKey) throw new Error("API Key is missing. Please set it in Settings.");
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText }
      ]
    })
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
};

// -- Components --
const CircularGauge = ({ percentage }) => {
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;
  const color = percentage > 70 ? '#ff3366' : percentage > 40 ? '#ffaa00' : '#00ff88';

  return (
    <div className="relative w-40 h-40 flex items-center justify-center">
      <svg className="w-full h-full transform -rotate-90">
        <circle cx="80" cy="80" r="60" stroke="#222" strokeWidth="12" fill="none" />
        <circle cx="80" cy="80" r="60" stroke={color} strokeWidth="12" fill="none" 
          strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} 
          className="transition-all duration-1000 ease-out" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold orbitron" style={{ color }}>{percentage}%</span>
        <span className="text-xs text-gray-400">AI</span>
      </div>
    </div>
  );
};

const AuthPage = ({ setPage, setCurrentUser, isLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setError('');
    if (!email || !password) return setError("Fields required.");
    
    const allKeys = await window.storage.keys();
    const userKeys = allKeys.filter(k => k.startsWith('users:'));
    
    if (isLogin) {
      const userObj = await window.storage.get(`users:${email}`);
      if (!userObj) return setError("User not found.");
      if (userObj.value.password !== password) return setError("Invalid password.");
      setCurrentUser(userObj.value);
      setPage('detect');
    } else {
      const exists = await window.storage.get(`users:${email}`);
      if (exists) return setError("User already exists.");
      
      const role = userKeys.length === 0 ? 'admin' : 'user';
      const newUser = { email, password, role, wordsScanned: 0 };
      await window.storage.set(`users:${email}`, newUser);
      setCurrentUser(newUser);
      setPage('detect');
    }
  };

  return (
    <div className="flex items-center justify-center h-full">
      <div className="animated-border p-[1px] w-full max-w-md">
        <div className="glass p-8 rounded-lg flex flex-col gap-4">
          <h1 className="text-3xl orbitron text-[#00ff88] text-center mb-4">{isLogin ? 'Login' : 'Sign Up'}</h1>
          {error && <div className="text-[#ff3366] text-sm text-center">{error}</div>}
          <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
            className="bg-[#111] border border-[#333] p-3 rounded focus:outline-none focus:border-[#00ff88] text-white" />
          <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)}
            className="bg-[#111] border border-[#333] p-3 rounded focus:outline-none focus:border-[#00ff88] text-white" />
          <button onClick={handleSubmit} className="bg-[#00ff88] text-black font-bold py-3 rounded mt-4 hover:bg-[#00cc6a] transition">
            {isLogin ? 'Enter' : 'Register'}
          </button>
          <div className="text-center mt-4">
            <span className="text-gray-400 cursor-pointer hover:text-white" onClick={() => setPage(isLogin ? 'signup' : 'login')}>
              {isLogin ? "Need an account? Sign up" : "Already have an account? Login"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

const DetectPage = ({ currentUser, apiKey, model, onHumanizeRequest, initialText = '' }) => {
  const [text, setText] = useState(initialText);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true); setError('');
    try {
      let extracted = '';
      if (file.name.endsWith('.pdf')) {
        extracted = await extractTextFromPDF(file);
      } else if (file.name.endsWith('.docx')) {
        extracted = await extractTextFromDOCX(file);
      } else {
        extracted = await file.text();
      }
      setText(extracted);
    } catch (err) {
      setError("File extraction failed: " + err.message);
    }
    setLoading(false);
  };

  const handleScan = async () => {
    setError(''); setResult(null);
    if (!text.trim()) return setError("Please enter text or upload a file.");
    const words = getWordCount(text);
    if (currentUser.role === 'user' && words > 5000) {
      return setError("Word limit exceeded (5000). Please upgrade to Admin/Pro.");
    }
    if (!apiKey) return setError("API Key not set. Please go to Settings.");

    setLoading(true);
    const systemPrompt = `You are an expert AI content detector. Analyze the text and return ONLY a JSON object:
{
  "ai_percentage": <0-100 number>,
  "human_percentage": <0-100 number>,
  "confidence": "<Low|Medium|High>",
  "verdict": "<Likely AI-Generated|Possibly AI-Generated|Likely Human-Written>",
  "suspicious_patterns": ["pattern1", "pattern2"],
  "sentence_analysis": [
    {"sentence": "first 8 words...", "ai_probability": <0-100>}
  ],
  "writing_style_notes": "brief analysis"
}
Return ONLY the JSON. No markdown. No explanation.`;

    try {
      const res = await callGroq(systemPrompt, text, apiKey, 1000, model);
      const raw = res.replace(/```json/gi, '').replace(/```/gi, '').trim();
      const data = JSON.parse(raw);
      setResult(data);
      
      await window.storage.set(`history:${currentUser.email}:${Date.now()}`, {
        type: 'detection',
        wordCount: words,
        aiPercent: data.ai_percentage,
        date: new Date().toISOString(),
        textPreview: text.substring(0, 100) + '...'
      });
      
      // Update words scanned
      const userObj = await window.storage.get(`users:${currentUser.email}`);
      if(userObj) {
        userObj.value.wordsScanned = (userObj.value.wordsScanned || 0) + words;
        await window.storage.set(`users:${currentUser.email}`, userObj.value);
      }
    } catch (err) {
      setError("Detection failed: " + err.message);
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto">
      <h2 className="text-2xl orbitron text-[#00ff88]">AI Content Detection</h2>
      <div className="glass p-6 rounded-lg flex flex-col gap-4 scan-container">
        {loading && <div className="scan-line"></div>}
        <div className="flex justify-between items-center">
          <label className="cursor-pointer bg-[#222] hover:bg-[#333] px-4 py-2 rounded flex items-center gap-2 border border-[#444] transition">
            <Upload size={18} /> Upload PDF/DOCX
            <input type="file" className="hidden" accept=".pdf,.docx,.txt" onChange={handleFileUpload} />
          </label>
          <div className="text-sm text-gray-400">Words: {getWordCount(text)} {currentUser.role==='user' && '/ 5000'}</div>
        </div>
        <textarea 
          value={text} onChange={e => setText(e.target.value)}
          placeholder="Paste your text here..."
          className="w-full h-64 bg-[#111] border border-[#333] rounded p-4 focus:outline-none focus:border-[#00ff88] resize-none text-white"
        ></textarea>
        {error && <div className="text-[#ff3366]">{error}</div>}
        <button onClick={handleScan} disabled={loading} className="bg-[#00ff88] text-black font-bold py-3 rounded hover:bg-[#00cc6a] transition disabled:opacity-50">
          {loading ? <span className="typewriter">🔍 Analyzing patterns...</span> : 'Analyze Content'}
        </button>
      </div>

      {result && (
        <div className="animated-border p-[1px] mt-4">
          <div className="glass p-6 rounded-lg grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="col-span-1 flex flex-col items-center justify-center gap-4 border-r border-[#333] pr-6">
              <CircularGauge percentage={result.ai_percentage} />
              <div className={`px-4 py-1 rounded text-sm font-bold ${result.ai_percentage > 70 ? 'bg-[#ff3366]/20 text-[#ff3366]' : result.ai_percentage > 40 ? 'bg-yellow-500/20 text-yellow-500' : 'bg-[#00ff88]/20 text-[#00ff88]'}`}>
                {result.verdict}
              </div>
              <div className="text-sm text-gray-400">Confidence: <span className="text-white">{result.confidence}</span></div>
              {onHumanizeRequest && (
                <button onClick={() => onHumanizeRequest(text)} className="mt-4 flex items-center gap-2 border border-[#00ff88] text-[#00ff88] px-4 py-2 rounded hover:bg-[#00ff88]/10 transition">
                  <Wand2 size={18} /> Humanize Text
                </button>
              )}
            </div>
            <div className="col-span-2 flex flex-col gap-4">
              <div>
                <h3 className="orbitron text-lg mb-2 text-gray-300">Suspicious Patterns</h3>
                <ul className="list-disc pl-5 text-sm text-[#ff3366]">
                  {result.suspicious_patterns?.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
              <div>
                <h3 className="orbitron text-lg mb-2 text-gray-300">Writing Style Notes</h3>
                <p className="text-sm text-gray-400">{result.writing_style_notes}</p>
              </div>
              <div>
                <h3 className="orbitron text-lg mb-2 text-gray-300">Sentence Analysis</h3>
                <div className="flex flex-col gap-2 max-h-40 overflow-y-auto pr-2">
                  {result.sentence_analysis?.map((s, i) => (
                    <div key={i} className="bg-[#111] p-2 rounded flex justify-between text-xs items-center border border-[#222]">
                      <span className="truncate mr-4 text-gray-300">"{s.sentence}"</span>
                      <span className={`${s.ai_probability > 70 ? 'text-[#ff3366]' : 'text-[#00ff88]'}`}>{s.ai_probability}% AI</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const HumanizePage = ({ currentUser, apiKey, model, initialText = '', onDetectRequest }) => {
  const [text, setText] = useState(initialText);
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const handleHumanize = async () => {
    setError(''); setResult(''); setCopied(false);
    if (!text.trim()) return setError("Please enter text.");
    const words = getWordCount(text);
    if (currentUser.role === 'user' && words > 5000) {
      return setError("Word limit exceeded (5000). Please upgrade.");
    }
    if (!apiKey) return setError("API Key not set. Please go to Settings.");

    setLoading(true);
    const systemPrompt = `You are an expert text humanizer. Rewrite the given text to sound 100% human-written.
Rules:
- Preserve ALL meaning, facts, data, numbers exactly
- Keep word count within ±5% of original (CRITICAL: match original length)
- Use varied sentence structures, natural flow, occasional imperfections
- Avoid robotic transitions (Furthermore, Moreover, Additionally)
- Use contractions, colloquial phrases where appropriate
- Output ONLY the rewritten text. No explanations. No preamble.`;

    try {
      const res = await callGroq(systemPrompt, text, apiKey, 4000, model);
      setResult(res.trim());
      await window.storage.set(`history:${currentUser.email}:${Date.now()}`, {
        type: 'humanize',
        wordCount: words,
        aiPercent: 'N/A',
        date: new Date().toISOString(),
        textPreview: res.substring(0, 100) + '...'
      });
      // Update words scanned
      const userObj = await window.storage.get(`users:${currentUser.email}`);
      if(userObj) {
        userObj.value.wordsScanned = (userObj.value.wordsScanned || 0) + words;
        await window.storage.set(`users:${currentUser.email}`, userObj.value);
      }
    } catch (err) {
      setError("Humanization failed: " + err.message);
    }
    setLoading(false);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto h-full">
      <h2 className="text-2xl orbitron text-[#00ff88]">Text Humanizer</h2>
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 min-h-[400px]">
        <div className="glass p-4 rounded-lg flex flex-col gap-2 scan-container">
          <div className="flex justify-between items-center mb-2">
            <span className="orbitron text-gray-300">Original Text</span>
            <span className="text-xs text-gray-500">Words: {getWordCount(text)}</span>
          </div>
          <textarea 
            value={text} onChange={e => setText(e.target.value)}
            placeholder="Paste AI-generated text here..."
            className="flex-1 bg-[#111] border border-[#333] rounded p-4 focus:outline-none focus:border-[#00ff88] resize-none text-white"
          ></textarea>
          <button onClick={handleHumanize} disabled={loading} className="bg-[#00ff88] text-black font-bold py-3 rounded hover:bg-[#00cc6a] transition disabled:opacity-50 mt-2">
            {loading ? <span className="typewriter">✨ Humanizing text...</span> : 'Humanize Text'}
          </button>
          {error && <div className="text-[#ff3366] text-sm mt-2">{error}</div>}
        </div>

        <div className="animated-border p-[1px] h-full flex flex-col">
          <div className="glass p-4 rounded-lg flex flex-col gap-2 h-full">
            <div className="flex justify-between items-center mb-2">
              <span className="orbitron text-[#00ff88]">Humanized Output</span>
              {result && <span className="text-xs text-gray-500">Words: {getWordCount(result)}</span>}
            </div>
            <div className="flex-1 bg-[#0a0a0f] border border-[#222] rounded p-4 overflow-y-auto whitespace-pre-wrap text-gray-200">
              {result ? result : <span className="text-gray-600 italic">Result will appear here...</span>}
            </div>
            {result && (
              <div className="flex gap-2 mt-2">
                <button onClick={copyToClipboard} className="flex-1 flex items-center justify-center gap-2 border border-[#333] hover:border-[#00ff88] text-gray-300 py-2 rounded transition">
                  {copied ? <><Check size={18} /> Copied!</> : <><Copy size={18} /> Copy Text</>}
                </button>
                {onDetectRequest && (
                  <button onClick={() => onDetectRequest(result)} className="flex-1 flex items-center justify-center gap-2 border border-[#00ff88] text-[#00ff88] hover:bg-[#00ff88]/10 py-2 rounded transition">
                    <Shield size={18} /> Re-scan for AI
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const HistoryPage = ({ currentUser }) => {
  const [history, setHistory] = useState([]);

  useEffect(() => {
    const loadHistory = async () => {
      const keys = await window.storage.keys();
      const historyKeys = currentUser.role === 'admin' 
        ? keys.filter(k => k.startsWith('history:'))
        : keys.filter(k => k.startsWith(`history:${currentUser.email}:`));
      
      const items = [];
      for (let k of historyKeys) {
        const data = await window.storage.get(k);
        const [, email, timestamp] = k.split(':');
        items.push({ ...data.value, email, timestamp: parseInt(timestamp) });
      }
      setHistory(items.sort((a,b) => b.timestamp - a.timestamp));
    };
    loadHistory();
  }, [currentUser]);

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto">
      <h2 className="text-2xl orbitron text-[#00ff88]">Scan History</h2>
      <div className="glass rounded-lg overflow-hidden border border-[#333]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#111] text-gray-400 border-b border-[#333]">
            <tr>
              <th className="p-4">Date</th>
              {currentUser.role === 'admin' && <th className="p-4">User</th>}
              <th className="p-4">Type</th>
              <th className="p-4">Words</th>
              <th className="p-4">AI %</th>
              <th className="p-4">Preview</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h, i) => (
              <tr key={i} className="border-b border-[#222] hover:bg-[#111] transition">
                <td className="p-4 text-gray-300">{new Date(h.date).toLocaleString()}</td>
                {currentUser.role === 'admin' && <td className="p-4 text-gray-400">{h.email}</td>}
                <td className="p-4"><span className={`px-2 py-1 rounded text-xs ${h.type==='detection' ? 'bg-[#00ff88]/10 text-[#00ff88]' : 'bg-[#ff3366]/10 text-[#ff3366]'}`}>{h.type}</span></td>
                <td className="p-4 text-gray-300">{h.wordCount}</td>
                <td className="p-4 text-gray-300">{h.aiPercent}</td>
                <td className="p-4 text-gray-500 truncate max-w-xs">{h.textPreview}</td>
              </tr>
            ))}
            {history.length === 0 && <tr><td colSpan="6" className="p-8 text-center text-gray-500">No history found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const AdminPage = () => {
  const [users, setUsers] = useState([]);

  const loadUsers = async () => {
    const keys = await window.storage.keys();
    const userKeys = keys.filter(k => k.startsWith('users:'));
    const items = [];
    for (let k of userKeys) {
      const data = await window.storage.get(k);
      items.push(data.value);
    }
    setUsers(items);
  };

  useEffect(() => { loadUsers(); }, []);

  const toggleRole = async (email, currentRole) => {
    const key = `users:${email}`;
    const data = await window.storage.get(key);
    if (data) {
      data.value.role = currentRole === 'admin' ? 'user' : 'admin';
      await window.storage.set(key, data.value);
      loadUsers();
    }
  };

  const deleteUser = async (email) => {
    if(window.confirm(`Delete ${email}?`)) {
      await window.storage.remove(`users:${email}`);
      loadUsers();
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto">
      <h2 className="text-2xl orbitron text-[#ff3366]">User Management</h2>
      <div className="glass rounded-lg overflow-hidden border border-[#333]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#111] text-gray-400 border-b border-[#333]">
            <tr>
              <th className="p-4">Email</th>
              <th className="p-4">Role</th>
              <th className="p-4">Words Scanned</th>
              <th className="p-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u, i) => (
              <tr key={i} className="border-b border-[#222] hover:bg-[#111] transition">
                <td className="p-4 text-gray-300">{u.email}</td>
                <td className="p-4">
                  <span className={`px-2 py-1 rounded text-xs ${u.role==='admin' ? 'bg-[#ff3366]/20 text-[#ff3366]' : 'bg-gray-800 text-gray-300'}`}>{u.role}</span>
                </td>
                <td className="p-4 text-gray-300">{u.wordsScanned || 0}</td>
                <td className="p-4 text-right flex justify-end gap-2">
                  <button onClick={()=>toggleRole(u.email, u.role)} className="border border-[#444] hover:border-[#00ff88] text-xs px-2 py-1 rounded">Toggle Role</button>
                  <button onClick={()=>deleteUser(u.email)} className="bg-[#ff3366]/20 text-[#ff3366] hover:bg-[#ff3366] hover:text-white text-xs px-2 py-1 rounded">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const SettingsPage = ({ apiKey, setApiKey, model, setModel, isAdmin }) => {
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

  const saveGlobalKey = async () => {
    if(isAdmin) {
      await window.storage.set('config:groqKey', apiKey);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <h2 className="text-2xl orbitron text-[#00ff88]">Settings</h2>
      <div className="glass p-6 rounded-lg flex flex-col gap-4">
        <div>
          <label className="block text-gray-400 mb-2">Groq API Key</label>
          <div className="flex gap-2">
            <input 
              type={showKey ? "text" : "password"} 
              value={apiKey} 
              onChange={e => setApiKey(e.target.value)}
              className="flex-1 bg-[#111] border border-[#333] p-3 rounded focus:outline-none focus:border-[#00ff88] text-white"
              placeholder="gsk_..."
            />
            <button onClick={() => setShowKey(!showKey)} className="bg-[#222] px-4 rounded border border-[#333] hover:bg-[#333]">👁</button>
          </div>
          <p className="text-xs text-gray-500 mt-2">Get your free key at <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="text-[#00ff88] underline">console.groq.com/keys</a></p>
        </div>

        <div>
          <label className="block text-gray-400 mb-2">Model</label>
          <select value={model} onChange={e => setModel(e.target.value)} className="w-full bg-[#111] border border-[#333] p-3 rounded focus:outline-none focus:border-[#00ff88] text-white">
            <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile (Best)</option>
            <option value="mixtral-8x7b-32768">mixtral-8x7b-32768 (Fallback)</option>
            <option value="llama3-8b-8192">llama3-8b-8192 (Fastest)</option>
          </select>
        </div>

        {isAdmin && (
          <div className="mt-4 pt-4 border-t border-[#333]">
            <h3 className="text-lg text-[#ff3366] mb-2 orbitron">Admin Controls</h3>
            <button onClick={saveGlobalKey} className="bg-[#ff3366]/20 text-[#ff3366] border border-[#ff3366] py-2 px-4 rounded hover:bg-[#ff3366] hover:text-white transition">
              {saved ? 'Saved!' : 'Save Shared API Key for all users'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const Sidebar = ({ page, setPage, currentUser, setCurrentUser }) => {
  const navItems = [
    { id: 'detect', label: 'AI Detection', icon: <Shield size={18} /> },
    { id: 'humanize', label: 'Humanizer', icon: <Wand2 size={18} /> },
    { id: 'history', label: 'History', icon: <HistoryIcon size={18} /> },
  ];

  if (currentUser.role === 'admin') {
    navItems.push({ id: 'admin', label: 'Users', icon: <User size={18} /> });
  }
  
  navItems.push({ id: 'settings', label: 'Settings', icon: <Settings size={18} /> });

  return (
    <div className="w-64 bg-[#0a0a0f] border-r border-[#222] flex flex-col h-full z-10">
      <div className="p-6">
        <h1 className="text-xl orbitron text-[#00ff88] font-bold">GOD MODE</h1>
        <div className="text-xs text-gray-500 mt-1">Detection & Humanizer</div>
      </div>
      <div className="flex-1 px-4 flex flex-col gap-2 mt-4">
        {navItems.map(item => (
          <button 
            key={item.id} 
            onClick={() => setPage(item.id)}
            className={`flex items-center gap-3 p-3 rounded transition-all ${page === item.id ? 'bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/30' : 'text-gray-400 hover:bg-[#111] hover:text-white'}`}
          >
            {item.icon} {item.label}
          </button>
        ))}
      </div>
      <div className="p-4 border-t border-[#222]">
        <div className="flex items-center gap-3 mb-4 px-2">
          <div className="w-8 h-8 rounded-full bg-[#111] flex items-center justify-center border border-[#333] text-xs">
            {currentUser.email.substring(0,2).toUpperCase()}
          </div>
          <div className="flex flex-col overflow-hidden">
            <span className="text-sm truncate text-white">{currentUser.email}</span>
            <span className={`text-xs ${currentUser.role==='admin' ? 'text-[#ff3366]' : 'text-gray-500'}`}>{currentUser.role.toUpperCase()}</span>
          </div>
        </div>
        <button onClick={() => setCurrentUser(null)} className="w-full flex items-center justify-center gap-2 p-2 rounded text-gray-400 hover:text-[#ff3366] hover:bg-[#111] transition">
          <LogOut size={18} /> Logout
        </button>
      </div>
    </div>
  );
};

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [page, setPage] = useState('login');
  const [groqApiKey, setGroqApiKey] = useState('');
  const [model, setModel] = useState('llama-3.3-70b-versatile');
  const [loadingInit, setLoadingInit] = useState(true);
  const [transferText, setTransferText] = useState('');

  useEffect(() => {
    // Load PDF.js via script tag as requested
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    };
    document.head.appendChild(script);

    const init = async () => {
      const sharedKey = await window.storage.get('config:groqKey');
      if (sharedKey) setGroqApiKey(sharedKey.value);
      setLoadingInit(false);
    };
    init();
  }, []);

  const handleHumanizeRequest = (text) => {
    setTransferText(text);
    setPage('humanize');
  };

  const handleDetectRequest = (text) => {
    setTransferText(text);
    setPage('detect');
  };

  if (loadingInit) return <div className="h-screen flex items-center justify-center bg-[#0a0a0f] text-[#00ff88] orbitron">Initializing Secure Environment...</div>;

  if (!currentUser && (page !== 'login' && page !== 'signup')) {
    setPage('login');
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0a0f]">
      {currentUser && <Sidebar page={page} setPage={setPage} currentUser={currentUser} setCurrentUser={setCurrentUser} />}
      <main className="flex-1 overflow-y-auto p-8 relative">
        {!groqApiKey && currentUser && page !== 'settings' && (
          <div className="bg-[#ff3366]/20 border border-[#ff3366] text-[#ff3366] p-4 rounded-lg mb-6 flex justify-between items-center">
            <span>⚠️ Groq API Key is not configured. Scans will fail.</span>
            <button onClick={() => setPage('settings')} className="bg-[#ff3366] text-white px-4 py-1 rounded text-sm hover:bg-red-600">Configure</button>
          </div>
        )}
        
        {page === 'login' && <AuthPage setPage={setPage} setCurrentUser={setCurrentUser} isLogin={true} />}
        {page === 'signup' && <AuthPage setPage={setPage} setCurrentUser={setCurrentUser} isLogin={false} />}
        {page === 'detect' && <DetectPage currentUser={currentUser} apiKey={groqApiKey} model={model} onHumanizeRequest={handleHumanizeRequest} initialText={page==='detect' ? transferText : ''} />}
        {page === 'humanize' && <HumanizePage currentUser={currentUser} apiKey={groqApiKey} model={model} initialText={page==='humanize' ? transferText : ''} onDetectRequest={handleDetectRequest} />}
        {page === 'history' && <HistoryPage currentUser={currentUser} />}
        {page === 'admin' && currentUser?.role === 'admin' && <AdminPage />}
        {page === 'settings' && <SettingsPage apiKey={groqApiKey} setApiKey={setGroqApiKey} model={model} setModel={setModel} isAdmin={currentUser?.role === 'admin'} />}
      </main>
    </div>
  );
}
