// /api/tracker — outreach tracker endpoints (manual one-tap logging; Groove
// has no API so this is the system of record for daily activity counts).
// Every mutation responds with the full refreshed summary so the dashboard
// never needs a follow-up GET.
import express from 'express'
import {
  readStore,
  logActivity,
  undoActivity,
  summarize,
  addAccount,
  patchAccount,
  removeAccount,
  addContact,
  patchContact,
  removeContact,
  watchContact,
} from './trackerStore.js'
import { hookAngles } from './plays.js'

export const trackerRouter = express.Router()

const fail = (res, err) =>
  res.status(err.code === 'bad-input' ? 400 : 500).json({ error: err.message })

const withSummary = async (extra) => ({ ...extra, ...summarize(await readStore()) })

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
    res.status(201).json(await withSummary({ activity }))
  } catch (err) {
    fail(res, err)
  }
})

trackerRouter.delete('/activity/:id', async (req, res) => {
  try {
    const removed = await undoActivity(req.params.id)
    if (!removed) return res.status(404).json({ error: 'no such activity' })
    res.json(await withSummary({ removed }))
  } catch (err) {
    fail(res, err)
  }
})

// Hook-angle offers for one contact (the ⚡ popover): plays whose triggers
// fire for this account, hook templates filled with real dossier facts.
// Read-only and instant — no LLM call, no paid tools.
trackerRouter.get('/hook-angles/:contactId', async (req, res) => {
  try {
    const store = await readStore()
    const contact = store.contacts.find((c) => c.id === req.params.contactId)
    if (!contact) return res.status(404).json({ error: 'no such contact' })
    const account = store.accounts.find((a) => a.id === contact.accountId) ?? null
    res.json(await hookAngles(contact, account))
  } catch (err) {
    fail(res, err)
  }
})

// Contact-first watchlist add (Activity page search): watch an existing
// tracker contact by id, or pull a Groove-mirror contact in by sfContactId —
// account + contact rows are created on the fly if this is the person's
// first appearance in the working layer.
trackerRouter.post('/watch', async (req, res) => {
  const { contactId, sfContactId } = req.body ?? {}
  try {
    const contact = await watchContact({ contactId, sfContactId })
    res.status(201).json(await withSummary({ contact }))
  } catch (err) {
    fail(res, err)
  }
})

// ---------- Accounts (working layer — SF stays system-of-record) ----------

trackerRouter.post('/accounts', async (req, res) => {
  try {
    const { account, existed } = await addAccount(req.body ?? {})
    res.status(existed ? 200 : 201).json(await withSummary({ account, existed }))
  } catch (err) {
    fail(res, err)
  }
})

trackerRouter.patch('/accounts/:id', async (req, res) => {
  try {
    const account = await patchAccount(req.params.id, req.body ?? {})
    if (!account) return res.status(404).json({ error: 'no such tracker account' })
    res.json(await withSummary({ account }))
  } catch (err) {
    fail(res, err)
  }
})

trackerRouter.delete('/accounts/:id', async (req, res) => {
  try {
    const removed = await removeAccount(req.params.id)
    if (!removed) return res.status(404).json({ error: 'no such tracker account' })
    res.json(await withSummary({ removed }))
  } catch (err) {
    fail(res, err)
  }
})

// ---------- Contacts ----------

trackerRouter.post('/contacts', async (req, res) => {
  try {
    const contact = await addContact(req.body ?? {})
    res.status(201).json(await withSummary({ contact }))
  } catch (err) {
    fail(res, err)
  }
})

trackerRouter.patch('/contacts/:id', async (req, res) => {
  try {
    const contact = await patchContact(req.params.id, req.body ?? {})
    if (!contact) return res.status(404).json({ error: 'no such contact' })
    res.json(await withSummary({ contact }))
  } catch (err) {
    fail(res, err)
  }
})

trackerRouter.delete('/contacts/:id', async (req, res) => {
  try {
    const removed = await removeContact(req.params.id)
    if (!removed) return res.status(404).json({ error: 'no such contact' })
    res.json(await withSummary({ removed }))
  } catch (err) {
    fail(res, err)
  }
})
