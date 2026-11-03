import { Award, BarChart3, ChevronRight, NotebookText, Settings } from 'lucide-react'
import { Bar } from '../components/Progress'
import { levelTitleKey } from '../domain/gamification'
import { useI18n } from '../i18n'
import { useAppData } from '../state/AppData'
import { href } from '../state/router'

/** Mobile hub for the sections that do not fit into the bottom navigation. */
export function MorePage() {
  const { t } = useI18n()
  const { game } = useAppData()
  const items = [
    { to: '/stats', icon: BarChart3, label: t('nav.stats') },
    { to: '/review', icon: NotebookText, label: t('nav.review') },
    { to: '/achievements', icon: Award, label: t('nav.achievements') },
    { to: '/settings', icon: Settings, label: t('nav.settings') },
  ]
  return (
    <div className="page page-narrow">
      <header className="page-head">
        <h1 className="page-title">{t('nav.more')}</h1>
      </header>
      <a className="sidebar-level" href={href('/achievements')} style={{ display: 'block', marginBottom: 16 }}>
        <div className="eyebrow">{t(levelTitleKey(game.level.level))}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', margin: '2px 0 8px' }}>
          <strong>{t('ach.level', { level: game.level.level })}</strong>
          <span className="subtle small num">{game.level.intoLevel}/{game.level.span} XP</span>
        </div>
        <Bar value={game.level.progress} />
      </a>
      <ul className="more-list surface">
        {items.map((i) => (
          <li key={i.to}>
            <a href={href(i.to)}>
              <i.icon size={20} aria-hidden />
              <span>{i.label}</span>
              <ChevronRight size={18} className="subtle" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
