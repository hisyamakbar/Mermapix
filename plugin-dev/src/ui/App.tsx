import { useMemo, useRef, useState } from 'react'
import { buildRunItems, filterFixtures, type ThemeMode } from '../gridLayout.ts'
import type { DiagramReport, SandboxToUi, UiToSandbox } from '../protocol.ts'
import { loadFixtures, renderPayload } from './render.ts'

function send(msg: UiToSandbox): void {
  parent.postMessage({ pluginMessage: msg }, '*')
}

interface Pending {
  match: (m: SandboxToUi) => boolean
  resolve: (m: SandboxToUi) => void
  reject: (e: Error) => void
}

const num = (v: number | null | undefined) => (v === null || v === undefined ? '-' : String(v))

export default function App() {
  const fixtures = useMemo(loadFixtures, [])
  const [filter, setFilter] = useState('')
  const [mode, setMode] = useState<ThemeMode>('both')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, current: '' })
  const [reports, setReports] = useState<DiagramReport[]>([])
  const [status, setStatus] = useState('')
  const [problemsOnly, setProblemsOnly] = useState(false)
  const [pageInfo, setPageInfo] = useState<{ name: string; id: string; fileKey?: string } | null>(null)
  const cancelRef = useRef(false)
  const pendingRef = useRef<Pending | null>(null)

  const selected = useMemo(
    () => filterFixtures(fixtures.map((f) => f.name), filter),
    [fixtures, filter],
  )
  const items = useMemo(() => buildRunItems(selected, mode), [selected, mode])

  // One request in flight at a time: send a message and wait for the sandbox reply that matches.
  function request(msg: UiToSandbox, match: (m: SandboxToUi) => boolean): Promise<SandboxToUi> {
    return new Promise((resolve, reject) => {
      pendingRef.current = { match, resolve, reject }
      send(msg)
    })
  }

  // Registered once; routes sandbox replies to the pending request.
  useMemo(() => {
    window.onmessage = (e: MessageEvent) => {
      const m = e.data?.pluginMessage as SandboxToUi | undefined
      const p = pendingRef.current
      if (!m || !p) return
      if (m.type === 'run-error') {
        pendingRef.current = null
        p.reject(new Error(m.error))
      } else if (p.match(m)) {
        pendingRef.current = null
        p.resolve(m)
      }
    }
  }, [])

  async function runAll() {
    if (running || !items.length) return
    setRunning(true)
    cancelRef.current = false
    setReports([])
    setPageInfo(null)
    setProgress({ done: 0, total: items.length, current: 'Creating test page...' })
    const byName = new Map(fixtures.map((f) => [f.name, f.code]))
    try {
      setStatus('')
      await request({ type: 'run-begin', total: items.length }, (m) => m.type === 'run-ready')
      for (let i = 0; i < items.length; i++) {
        if (cancelRef.current) break
        const item = items[i]
        setProgress({ done: i, total: items.length, current: `${item.fixture} · ${item.theme}` })
        let svg: string | undefined
        let themeVariables: Record<string, any> | undefined
        let renderError: string | undefined
        try {
          const payload = await renderPayload(byName.get(item.fixture) ?? '', item.theme)
          svg = payload.svg
          themeVariables = payload.themeVariables
        } catch (err) {
          renderError = 'render: ' + (err instanceof Error ? err.message : String(err))
        }
        const reply = await request(
          {
            type: 'insert',
            key: item.key,
            fixture: item.fixture,
            theme: item.theme,
            row: item.row,
            col: item.col,
            svg,
            themeVariables,
            renderError,
          },
          (m) => m.type === 'inserted' && m.report.key === item.key,
        )
        if (reply.type === 'inserted') setReports((prev) => [...prev, reply.report])
      }
      setProgress((p) => ({ ...p, current: 'Laying out grid and writing audit...' }))
      const done = await request({ type: 'run-end' }, (m) => m.type === 'run-done')
      if (done.type === 'run-done') {
        setPageInfo({ name: done.pageName, id: done.pageId, fileKey: done.fileKey })
        const t = done.totals
        setStatus(
          `${cancelRef.current ? 'Cancelled. ' : ''}Done: ${t.diagrams} diagrams, ${t.failed} failed, ${t.withIssues} with issues.`,
        )
      }
      setProgress((p) => ({ ...p, done: items.length, current: '' }))
    } catch (err) {
      setStatus('Run failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setRunning(false)
    }
  }

  const shown = problemsOnly ? reports.filter((r) => !r.ok) : reports
  const nFailed = reports.filter((r) => r.error).length
  const nIssues = reports.filter((r) => !r.error && !r.ok).length
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  const link = pageInfo?.fileKey
    ? `https://www.figma.com/design/${pageInfo.fileKey}/?node-id=${pageInfo.id.replace(':', '-')}`
    : null

  return (
    <main className="tr-root">
      <header className="tr-head">
        <h1>Mermapix Test Runner</h1>
        <span className="tr-badge">dev only</span>
      </header>

      <section className="tr-controls">
        <label className="tr-field">
          <span>Fixture filter</span>
          <input
            type="text"
            value={filter}
            placeholder="e.g. erd, survey, 37  (empty = all)"
            onChange={(e) => setFilter(e.target.value)}
            disabled={running}
          />
        </label>
        <label className="tr-field tr-theme">
          <span>Theme</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as ThemeMode)} disabled={running}>
            <option value="both">Both (dark + light)</option>
            <option value="dark">Dark only</option>
            <option value="light">Light only</option>
          </select>
        </label>
        {running ? (
          <button type="button" className="tr-btn tr-btn-secondary" onClick={() => (cancelRef.current = true)}>
            Cancel
          </button>
        ) : (
          <button type="button" className="tr-btn" onClick={runAll} disabled={!items.length}>
            Run all
          </button>
        )}
      </section>

      <p className="tr-hint">
        {selected.length} of {fixtures.length} fixtures x {mode === 'both' ? 2 : 1} theme
        {mode === 'both' ? 's' : ''} = {items.length} diagrams. Creates a new page
        <b> Test Run &lt;date&gt;</b> in this file.
      </p>

      {(running || progress.total > 0) && (
        <section className="tr-progress" aria-live="polite">
          <div className="tr-bar">
            <div className="tr-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <span>
            {progress.done}/{progress.total} {progress.current && `· ${progress.current}`}
          </span>
        </section>
      )}

      {status && <p className="tr-status">{status}</p>}
      {pageInfo && (
        <p className="tr-hint">
          Page: <b>{pageInfo.name}</b> ({pageInfo.id}). {link ? <code>{link}</code> : 'Send the agent this file link and the page name.'}
        </p>
      )}

      {reports.length > 0 && (
        <section className="tr-results">
          <div className="tr-results-head">
            <b>
              {reports.length} done · {nFailed} failed · {nIssues} with issues
            </b>
            <label>
              <input
                type="checkbox"
                checked={problemsOnly}
                onChange={(e) => setProblemsOnly(e.target.checked)}
              />{' '}
              problems only
            </label>
          </div>
          <div className="tr-table-wrap">
            <table className="tr-table">
              <thead>
                <tr>
                  <th>Diagram</th>
                  <th title="duplicateStacks">dup</th>
                  <th title="looseShapes">loose</th>
                  <th title="unconvertedTables">tbl</th>
                  <th title="overflowingText">ovf</th>
                  <th title="content outside root frame">crop</th>
                  <th title="TEXT nodes / SVG text elements">text</th>
                  <th title="near-black / near-white boxes">box</th>
                  <th title="unnamedLayers (informational)">unn</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const m = r.metrics
                  const bad = (v: number | null | undefined) => (v ? 'tr-bad' : undefined)
                  return (
                    <tr
                      key={r.key}
                      className={r.error ? 'tr-row-fail' : r.ok ? undefined : 'tr-row-warn'}
                      onClick={() => send({ type: 'focus', key: r.key })}
                      title={r.error ?? r.issues.join(' ')}
                    >
                      <td>
                        {r.fixture} · {r.theme}
                        {r.error && <div className="tr-err">{r.error}</div>}
                      </td>
                      <td className={bad(m?.duplicateStacks)}>{num(m?.duplicateStacks)}</td>
                      <td className={bad(m?.looseShapes)}>{num(m?.looseShapes)}</td>
                      <td className={bad(m?.unconvertedTables)}>{num(m?.unconvertedTables)}</td>
                      <td className={bad(m?.overflowingText)}>{num(m?.overflowingText)}</td>
                      <td className={bad(m?.contentOverflow)}>{num(m?.contentOverflow)}</td>
                      <td className={bad(m?.textsLost)}>
                        {m ? `${m.textsFound}/${num(m.textsExpected)}` : '-'}
                      </td>
                      <td className={bad(m?.blackBoxes)}>{num(m?.blackBoxes)}</td>
                      <td>{num(m?.unnamedLayers)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  )
}
