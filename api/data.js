import { fetchSheetData } from '../scripts/sheet-data.mjs'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, message: 'Method not allowed' })
    return
  }

  try {
    const data = await fetchSheetData()
    res.setHeader('Cache-Control', 'no-store, max-age=0')
    res.status(200).json({ ok: true, ...data })
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error?.message || 'Nepodarilo se nacist data z Google Sheetu',
    })
  }
}