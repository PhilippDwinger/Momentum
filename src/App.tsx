import { useEffect } from 'react'
import { Award, BarChart3, CalendarDays, CircleEllipsis, House, LayoutList, NotebookText, Plus, Settings, WifiOff } from 'lucide-react'
import { BrandMark } from './components/Icon'
import { Bar } from './components/Progress'
import { levelTitleKey } from './domain/gamification'
import { useHotkeys, useOnline } from './hooks/hooks'
import { usePwa } from './hooks/usePwa'
import { useReminders } from './hooks/useReminders'
import { useI18n } from './i18n'
import { AchievementsPage } from './pages/AchievementsPage'
import { ActivitiesPage } from './pages/ActivitiesPage'
import { ActivityDetailPage } from './pages/ActivityDetailPage'
import { CalendarPage } from './pages/CalendarPage'
import { MorePage } from './pages/MorePage'
import { ReviewPage } from './pages/ReviewPage'
import { SettingsPage } from './pages/SettingsPage'
import { StatsPage } from './pages/StatsPage'
import { TodayPage } from './pages/TodayPage'
import { useAppData } from './state/AppData'
import { href, navigate, useRoute } from './state/router'
import { useToast } from './state/toast'
import { useUI } from './state/uiContext'

const NAV = [
  { path: '/today', key: 'nav.today', icon: House },
  { path: '/calendar', key: 'nav.calendar', icon: CalendarDays },
  { path: '/activities', key: 'nav.activities', icon: LayoutList },
  { path: '/stats', key: 'nav.stats', icon: BarChart3 },
  { path: '/review', key: 'nav.review', icon: NotebookText },
  { path: '/achievements', key: 'nav.achievements', icon: Award },
  { path: '/settings', key: 'nav.settings', icon: Settings },
] as const

export default function App() {
  const route = useRoute()
  const { t } = useI18n()
  const data = useAppData()
  const ui = useUI()
  const toast = useToast()
  const pwa = usePwa()
  const online = useOnline()
  useReminders(data)

  const section = `/${route.segments[0] ?? 'today'}`
  const activeNav = section === '/activity' ? '/activities' : section

  useHotkeys({
    n: () => ui.open({ type: 'editor' }),
    t: () => navigate('/today'),
    '?': () => ui.open({ type: 'shortcuts' }),
    ...Object.fromEntries(NAV.map((n, i) => [String(i + 1), () => navigate(n.path)])),
  })

  const { needRefresh, update } = pwa
  useEffect(() => {
    if (needRefresh && update) {
      toast({ message: t('toast.updateReady'), tone: 'info', duration: 30000, action: { label: t('toast.update'), run: () => void update() } })
    }
  }, [needRefresh, update, toast, t])

  useEffect(() => {
    const title = NAV.find((n) => n.path === activeNav)
    document.title = title && activeNav !== '/today' ? `${t(title.key)} · Momentum` : 'Momentum'
    window.scrollTo({ top: 0 })
  }, [activeNav, t])

  let page
  switch (section) {
    case '/calendar':
      page = <CalendarPage />
      break
    case '/activities':
      page = <ActivitiesPage />
      break
    case '/activity':
      page = <ActivityDetailPage id={route.segments[1] ?? ''} />
      break
    case '/stats':
      page = <StatsPage />
      break
    case '/review':
      page = <ReviewPage />
      break
    case '/achievements':
      page = <AchievementsPage />
      break
    case '/settings':
      page = <SettingsPage />
      break
    case '/more':
      page = <MorePage />
      break
    default:
      page = <TodayPage />
  }

  const { level } = data.game
  const mobileMore = ['/review', '/achievements', '/settings', '/more'].includes(activeNav)

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Navigation">
        <a className="brand" href={href('/today')}>
          <BrandMark />
          <span className="brand-name">Momentum</span>
        </a>
        <div className="sidebar-new">
          <button className="btn btn-primary btn-block" onClick={() => ui.open({ type: 'editor' })} title={`${t('shortcuts.new')} (N)`}>
            <Plus size={18} /> <span className="btn-label">{t('editor.new')}</span>
          </button>
        </div>
        <nav aria-label="Hauptnavigation" style={{ display: 'grid', gap: 2 }}>
          {NAV.map((n, i) => (
            <a key={n.path} className="nav-item" href={href(n.path)} aria-current={activeNav === n.path ? 'page' : undefined} title={t(n.key)}>
              <n.icon size={19} aria-hidden />
              <span className="nav-label">{t(n.key)}</span>
              <kbd aria-hidden>{i + 1}</kbd>
            </a>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <a className="sidebar-level" href={href('/achievements')}>
          <div className="eyebrow" style={{ marginBottom: 2 }}>{t(levelTitleKey(level.level))}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <strong>{t('ach.level', { level: level.level })}</strong>
            <span className="subtle small num">{level.intoLevel}/{level.span} XP</span>
          </div>
          <Bar value={level.progress} />
        </a>
      </aside>

      <main className="main" id="main">
        {!online && (
          <div className="offline-pill badge warning" role="status" title={t('pwa.offline')}>
            <WifiOff size={12} aria-hidden /> Offline
          </div>
        )}
        {page}
      </main>

      <nav className="bottom-nav" aria-label="Navigation">
        <a href={href('/today')} aria-current={activeNav === '/today' ? 'page' : undefined}>
          <House size={22} aria-hidden />
          {t('nav.today')}
        </a>
        <a href={href('/calendar')} aria-current={activeNav === '/calendar' ? 'page' : undefined}>
          <CalendarDays size={22} aria-hidden />
          {t('nav.calendar')}
        </a>
        <button onClick={() => ui.open({ type: 'editor', date: section === '/calendar' ? route.query.get('d') ?? undefined : undefined })} aria-label={t('editor.new')}>
          <span className="fab" style={{ display: 'grid', placeItems: 'center' }}>
            <Plus size={26} aria-hidden />
          </span>
        </button>
        <a href={href('/activities')} aria-current={activeNav === '/activities' ? 'page' : undefined}>
          <LayoutList size={22} aria-hidden />
          {t('nav.activities')}
        </a>
        <a href={href('/more')} aria-current={mobileMore || activeNav === '/stats' ? 'page' : undefined}>
          <CircleEllipsis size={22} aria-hidden />
          {t('nav.more')}
        </a>
      </nav>
    </div>
  )
}
