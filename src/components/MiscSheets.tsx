import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { createActivity, deleteCategory, saveCategory } from '../data/actions'
import { applyImport } from '../data/exportImport'
import type { ParsedImport } from '../data/importParse'
import { setPrefs } from '../state/prefs'
import { TEMPLATES, type Template } from '../domain/templates'
import { COLOR_KEYS, type Category, type ColorKey } from '../domain/types'
import { useI18n } from '../i18n'
import { useAppData } from '../state/AppData'
import { useToast } from '../state/toast'
import { useUI } from '../state/uiContext'
import { ActivityIcon, NamedIcon, acStyle } from './Icon'
import { Modal } from './Modal'

export function TemplatesSheet({ onClose }: { onClose: () => void }) {
  const { t, lang, describeRule, amount } = useI18n()
  const { index, today } = useAppData()
  const toast = useToast()
  const ui = useUI()
  const [busy, setBusy] = useState(false)

  async function addAll(tpl: Template) {
    setBusy(true)
    try {
      let idx = index
      for (const item of tpl.items) {
        const cat = `cat_${item.category}`
        const created = await createActivity(
          {
            name: item.name[lang],
            description: item.description?.[lang] ?? '',
            icon: item.icon,
            color: item.color,
            categoryId: idx.categoryById.has(cat) ? cat : null,
            kind: item.kind,
            unit: item.unit?.[lang] ?? '',
            startDate: today,
            endDate: null,
            rule: item.rule,
            target: item.target,
            time: item.time ?? null,
            durationMinutes: item.durationMinutes ?? null,
            reminderTime: null,
            partialCounts: false,
            notes: '',
          },
          idx,
        )
        idx = { ...idx, activities: [...idx.activities, created] }
      }
      toast({ message: t('activities.templateAdded', { name: tpl.title[lang] }) })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={t('activities.templates')} onClose={onClose} size="wide">
      <p className="muted" style={{ marginBottom: 16 }}>{t('activities.templatesText')}</p>
      <div className="template-grid">
        {TEMPLATES.map((tpl) => (
          <article key={tpl.id} className="template-card">
            <header>
              <span className="a-icon" style={acStyle(tpl.items[0].color)}>
                <NamedIcon name={tpl.icon} size={20} />
              </span>
              <div>
                <h3>{tpl.title[lang]}</h3>
                <p className="subtle small">{tpl.subtitle[lang]}</p>
              </div>
            </header>
            <ul>
              {tpl.items.map((it, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className="template-item"
                    onClick={() => {
                      onClose()
                      ui.open({ type: 'editor', template: it })
                    }}
                    title={t('common.edit')}
                  >
                    <ActivityIcon icon={it.icon} color={it.color} size="sm" />
                    <span>
                      <strong>{it.name[lang]}</strong>
                      <span className="subtle tiny">
                        {describeRule(it.rule, today)}
                        {it.kind !== 'check' ? ` · ${amount({ kind: it.kind, unit: it.unit?.[lang] ?? '' }, it.target)}` : ''}
                        {it.time ? ` · ${it.time}` : ''}
                      </span>
                    </span>
                    <Pencil size={14} className="subtle" />
                  </button>
                </li>
              ))}
            </ul>
            <button className="btn btn-sm" onClick={() => void addAll(tpl)} disabled={busy}>
              <Plus size={15} /> {t('activities.templateAdd', { count: tpl.items.length })}
            </button>
          </article>
        ))}
      </div>
    </Modal>
  )
}

export function CategoriesSheet({ onClose }: { onClose: () => void }) {
  const { t, categoryName } = useI18n()
  const { index } = useAppData()
  const ui = useUI()
  const [editing, setEditing] = useState<Partial<Category> | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState<ColorKey>('blue')

  const start = (c?: Category) => {
    setEditing(c ?? {})
    setName(c ? categoryName(c) : '')
    setColor(c?.color ?? 'blue')
  }
  const save = async () => {
    if (!name.trim() || !editing) return
    await saveCategory({ ...editing, name, color, icon: editing.icon ?? 'i:tag' }, index)
    setEditing(null)
  }
  const counts = new Map<string, number>()
  for (const a of index.activities) if (a.categoryId) counts.set(a.categoryId, (counts.get(a.categoryId) ?? 0) + 1)

  return (
    <Modal title={t('activities.categories')} onClose={onClose} size="narrow">
      <ul className="cat-list">
        {index.categories.map((c) => (
          <li key={c.id} style={acStyle(c.color)}>
            <span className="dot" />
            <span className="cat-name">{categoryName(c)}</span>
            <span className="subtle small">{counts.get(c.id) ?? 0}</span>
            <button className="icon-btn" onClick={() => start(c)} aria-label={t('common.edit')}>
              <Pencil size={16} />
            </button>
            <button
              className="icon-btn"
              aria-label={t('common.delete')}
              onClick={async () => {
                if (await ui.confirm({ title: categoryName(c), message: t('activities.deleteCategory'), confirmLabel: t('common.delete'), danger: true })) {
                  await deleteCategory(c, index)
                }
              }}
            >
              <Trash2 size={16} />
            </button>
          </li>
        ))}
      </ul>
      {editing ? (
        <form
          className="cat-form"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('activities.categoryName')} maxLength={40} data-autofocus aria-label={t('activities.categoryName')} />
          <div className="swatches">
            {COLOR_KEYS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} style={acStyle(c)} onClick={() => setColor(c)} />
            ))}
          </div>
          <div className="input-group" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-sm btn-primary" disabled={!name.trim()}>
              {t('common.save')}
            </button>
          </div>
        </form>
      ) : (
        <button className="btn btn-sm" onClick={() => start()} style={{ marginTop: 12 }}>
          <Plus size={15} /> {t('activities.newCategory')}
        </button>
      )}
    </Modal>
  )
}

export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const rows: [string[], string][] = [
    [['N'], t('shortcuts.new')],
    [['T'], t('shortcuts.today')],
    [['←', '→'], t('shortcuts.prevNext')],
    [['1', '…', '7'], t('shortcuts.nav')],
    [['/'], t('shortcuts.search')],
    [['?'], t('shortcuts.help')],
    [['Esc'], t('shortcuts.close')],
  ]
  return (
    <Modal title={t('shortcuts.title')} onClose={onClose} size="narrow">
      <dl className="shortcut-list">
        {rows.map(([keys, label]) => (
          <div key={label}>
            <dt>
              {keys.map((k) => (
                <span key={k} className="kbd">
                  {k}
                </span>
              ))}
            </dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  )
}

export function ImportSheet({ parsed, onClose }: { parsed: ParsedImport; onClose: () => void }) {
  const { t, fmt } = useI18n()
  const toast = useToast()
  const ui = useUI()
  const [busy, setBusy] = useState(false)
  const run = async (mode: 'merge' | 'replace') => {
    if (mode === 'replace') {
      const ok = await ui.confirm({ title: t('settings.importReplace'), message: t('settings.importReplaceConfirm'), confirmLabel: t('settings.importReplace'), danger: true })
      if (!ok) return
    }
    setBusy(true)
    try {
      const n = await applyImport(parsed, mode)
      // re-baseline achievements/level silently – imported history is not a new unlock
      setPrefs({ seenAchievements: null, lastLevel: null })
      toast({ message: t('settings.importDone', { count: n }) })
      onClose()
    } catch (e) {
      toast({ message: t('toast.error', { message: e instanceof Error ? e.message : String(e) }), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={t('settings.importTitle')} onClose={onClose} size="narrow">
      <p>{t('settings.importSummary', { activities: parsed.counts.activities, entries: parsed.counts.entries, categories: parsed.counts.categories })}</p>
      {parsed.exportedAt && <p className="subtle small">{t('settings.importFrom', { date: fmt.longYear(parsed.exportedAt.slice(0, 10)) })}</p>}
      {parsed.invalid > 0 && <p className="small" style={{ color: 'var(--warning)' }}>{t('settings.importInvalid', { count: parsed.invalid })}</p>}
      <div className="scope-options" style={{ marginTop: 16 }}>
        <button className="scope-option" onClick={() => void run('merge')} disabled={busy}>
          <strong>{t('settings.importMerge')}</strong>
          <span>{t('settings.importMergeHint')}</span>
        </button>
        <button className="scope-option danger" onClick={() => void run('replace')} disabled={busy}>
          <strong>{t('settings.importReplace')}</strong>
          <span>{t('settings.importReplaceHint')}</span>
        </button>
      </div>
    </Modal>
  )
}
