import 'dotenv/config'
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const KEY = process.env.GEMINI_API_KEY
const MODEL = process.env.GEMINI_MODEL
const PORT = process.env.PORT

const SYSTEM = `You are a household repair assistant. Analyze the photo and description.
Return ONLY valid JSON with these keys: item_name, likely_issue, confidence (low|medium|high), what_to_check_first, difficulty (beginner|intermediate|pro), tools (list of strings), steps (list of strings, max 6), est_repair_cost (number), est_replace_cost (number), verdict (repair|replace|reuse|recycle), verdict_reason, safety_flag (true|false), safety_note.
Rules: If the problem involves mains electricity, gas, structural load, or chemicals, set safety_flag true, leave steps empty, and recommend a professional. If unsure, say so and lower the confidence. Costs are rough estimates in CAD, as plain numbers.`

const app = express()
app.use(express.json({ limit: '8mb' }))

const hits = new Map()
const LIMIT = 20 // requests
const WINDOW = 60_000 // per minute
function rateLimit(req, res, next) {
  const now = Date.now()
  const rec = hits.get(req.ip)
  if (!rec || now > rec.reset) {
    hits.set(req.ip, { count: 1, reset: now + WINDOW })
    return next()
  }
  if (++rec.count > LIMIT) return res.status(429).json({ error: 'Too many requests. Please wait a minute.' })
  next()
}

app.post('/api/analyze', rateLimit, async (req, res) => {
  try {
    if (!KEY) return res.status(500).json({ error: 'Server is missing GEMINI_API_KEY.' })

    const { image, category, description } = req.body || {}
    const desc = String(description || '').slice(0, 1000).trim()
    const cat = String(category || 'Other').slice(0, 60)
    if (!image && !desc) return res.status(400).json({ error: "Add a photo or describe what's broken." })

    const parts = []
    if (image) parts.push({ inlineData: { mimeType: 'image/jpeg', data: String(image) } })
    parts.push({ text: `Category: ${cat}\nProblem description: ${desc || 'none given'}` })

    const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.3, maxOutputTokens: 8192 },
        }),
      }
    )
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return res.status(502).json({ error: 'Gemini error: ' + (j.error?.message || r.status) })
    if (j.promptFeedback?.blockReason)
      return res.status(422).json({ error: `Gemini blocked this request (${j.promptFeedback.blockReason}). Try a different photo.` })

    const cand = j.candidates?.[0]
    let t = (cand?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('')
    const a = t.indexOf('{'), z = t.lastIndexOf('}')
    if (a >= 0 && z > a) t = t.slice(a, z + 1)
    if (!t)
      return res.status(502).json({ error: `Gemini returned no answer (reason: ${cand?.finishReason || 'unknown'}). Try again or use a clearer photo.` })

    let d
    try { d = JSON.parse(t) } catch { return res.status(502).json({ error: 'Gemini sent an unreadable answer. Try again.' }) }

    d.est_repair_cost = Number(d.est_repair_cost) || 0
    d.est_replace_cost = Number(d.est_replace_cost) || 0
    d.safety_flag = String(d.safety_flag).toLowerCase() === 'true'
    d.tools = d.tools || []
    d.steps = d.safety_flag ? [] : d.steps || []
    res.json(d)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Something went wrong on the server.' })
  }
})

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.use((req, res) => res.sendFile(path.join(dist, 'index.html')))
}

app.listen(PORT, () => console.log(`FixFirst server running on http://localhost:${PORT}`))