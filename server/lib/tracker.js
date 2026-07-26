// /api/tracker — outreach tracker endpoints (manual one-tap logging; Groove
// has no API so this is the system of record for daily activity counts).
// Every mutation responds with the full refreshed summary so the dashboard
// never needs a follow-up GET.
import express from 'express'
import { readStore, logActivity, undoActivity, summarize } from './trackerStore.js'

export const trackerRouter = express.Router()

trackerRouter.get('/', async (_req, res) => {
  try {
    res.json(summarize(await readStore()))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

trackerRouter.post('/activity', async (req, res) => {
  const { type, outcome, contactId } = req.body ?? {}
  try {
    const activity = await logActivity({ type, outcome, contactId })
    res.status(201).json({ activity, ...summarize(await readStore()) })
  } catch (err) {
    if (err.code === 'bad-input') return res.status(400).json({ error: err.message })
    res.status(500).json({ error: err.message })
  }
})

trackerRouter.delete('/activity/:id', async (req, res) => {
  try {
    const removed = await undoActivity(req.params.id)
    if (!removed) return res.status(404).json({ error: 'no such activity' })
    res.json({ removed, ...summarize(await readStore()) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})
