import { useState, useEffect } from 'react'
import './App.css'

const VERDICTS = ['repair', 'replace', 'reuse', 'recycle']
const CATEGORIES = ['Furniture', 'Small appliance', 'Clothing and textiles', 'Electronics', 'Tools', 'Other']

// Safe localStorage helpers (some browsers block storage)
const get = (k, d) => {
  try { return JSON.parse(window.localStorage.getItem(k)) ?? d } catch { return d }
}
const put = (k, v) => {
  try { window.localStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ }
}

// Shrinks a photo to max 1024px and returns it as base64 JPEG text
function shrink(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const s = Math.min(1, 1024 / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = img.width * s
      c.height = img.height * s
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(img.src)
      resolve(c.toDataURL('image/jpeg', 0.85).split(',')[1])
    }
    img.onerror = () => reject(new Error('Could not read that image. Try a JPG or PNG.'))
    img.src = URL.createObjectURL(file)
  })
}

async function analyze(file, category, description) {
  const image = file ? await shrink(file) : null
  let r
  try {
    r = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, category, description }),
    })
  } catch {
    throw new Error('Could not reach the server.')
  }
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Request failed (' + r.status + ')')
  return j
}

export default function App() {
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [desc, setDesc] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState(null)
  const [history, setHistory] = useState(() => get('ff_hist', []))
  useEffect(() => { put('ff_hist', history) }, [history])

  useEffect(() => {
    if (!file) { setPreviewUrl(''); return }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const handleSubmit = async e => {
    e.preventDefault()
    setError('')
    const text = desc.trim()
    if (!file && !text) { setError("Add a photo or describe what's broken."); return }
    setLoading(true)
    try {
      const d = await analyze(file, category, text)
      d.id = Date.now()
      d.outcome = 'pending'
      setReport(d)
      setHistory(h => [d, ...h].slice(0, 100))
    } catch (x) {
      setError(x.message)
    } finally {
      setLoading(false)
    }
  }

  const setOutcome = outcome =>
    setHistory(h => h.map(x => (x.id === report.id ? { ...x, outcome } : x)))

  const fixed = history.filter(x => x.outcome === 'fixed')
  const savedMoney = fixed.reduce((s, x) => s + Math.max(0, x.est_replace_cost - x.est_repair_cost), 0)
  const currentOutcome = report ? history.find(x => x.id === report.id)?.outcome : null

  return (
    <main>
      <header>
        <h1>FixFirst</h1>
        <p>Snap a photo of what broke. Get a verdict: repair it, replace it, reuse it, or recycle it.</p>
      </header>

      <div className="grid">
        <section className="panel">
          <form onSubmit={handleSubmit}>
            <label htmlFor="image">Photo of the item</label>
            <input
              type="file"
              id="image"
              accept="image/*"
              onChange={e => setFile(e.target.files[0] || null)}
            />
            {previewUrl && <img id="preview" src={previewUrl} alt="Selected item preview" />}

            <label htmlFor="category">Category</label>
            <select id="category" value={category} onChange={e => setCategory(e.target.value)}>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>

            <label htmlFor="description">What's wrong? (optional)</label>
            <textarea
              id="description"
              placeholder="The back leg wobbles when I sit down."
              value={desc}
              onChange={e => setDesc(e.target.value)}
            />

            <p>
              <button id="go" type="submit" disabled={loading}>
                {loading ? 'Analyzing…' : 'Get repair report'}
              </button>
            </p>
            <p className="err" role="alert">{error}</p>
          </form>
        </section>

        <section className="panel" aria-live="polite">
          {!report ? (
            <p className="empty">Your repair report will show up here.</p>
          ) : (
            <div className="report">
              <span className={`tag ${VERDICTS.includes(report.verdict) ? report.verdict : ''}`}>
                {report.verdict}
              </span>
              <h2>{report.item_name}: {report.likely_issue}</h2>
              <p className="conf">Confidence: {report.confidence}. {report.verdict_reason}</p>

              {report.safety_flag && (
                <div className="banner">
                  Call a professional. {report.safety_note || 'This problem is risky to fix yourself.'}
                </div>
              )}

              <dl>
                <dt>Check first</dt><dd>{report.what_to_check_first}</dd>
                <dt>Difficulty</dt><dd>{report.difficulty}</dd>
                <dt>Tools</dt><dd>{report.tools.join(', ') || 'None'}</dd>
                <dt>Repair cost</dt><dd>about ${Math.round(report.est_repair_cost)} CAD</dd>
                <dt>Replace cost</dt><dd>about ${Math.round(report.est_replace_cost)} CAD</dd>
              </dl>

              {report.steps.length > 0 && (
                <ol>{report.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
              )}

              <div className="outcome">
                {currentOutcome === 'pending' ? (
                  <>
                    <span>What happened?</span>
                    <button className="ghost" onClick={() => setOutcome('fixed')}>I fixed it</button>
                    <button className="ghost" onClick={() => setOutcome('replaced')}>I replaced it</button>
                    <button className="ghost" onClick={() => setOutcome('gave_up')}>I gave up</button>
                  </>
                ) : (
                  <span>Saved. Thanks!</span>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="panel impact">
        <h2>Your impact</h2>
        <div className="stats">
          <div className="stat"><b>{history.length}</b><span>items checked</span></div>
          <div className="stat"><b>{fixed.length}</b><span>items fixed</span></div>
          <div className="stat"><b>${Math.round(savedMoney)}</b><span>saved vs. replacing</span></div>
        </div>
        <h3>Recent items</h3>
        <ul className="hist">
          {history.length ? (
            history.slice(0, 10).map(x => (
              <li key={x.id}>
                <span>{x.item_name}<br /><small>{x.likely_issue}</small></span>
                <small>{x.verdict} · {x.outcome}</small>
              </li>
            ))
          ) : (
            <li className="empty">No items yet. Check your first one.</li>
          )}
        </ul>
      </section>
    </main>
  )
}
