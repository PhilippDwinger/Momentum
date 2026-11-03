import { Lock } from 'lucide-react'
import { NamedIcon } from '../components/Icon'
import { Bar, ProgressRing } from '../components/Progress'
import { ChallengeList } from '../components/Widgets'
import { startOfWeek } from '../domain/dates'
import { levelThreshold, levelTitleKey } from '../domain/gamification'
import { useI18n } from '../i18n'
import { useAppData } from '../state/AppData'

export function AchievementsPage() {
  const { game, today } = useAppData()
  const { t, fmt } = useI18n()
  const { level } = game
  const unlocked = game.achievements.filter((a) => a.unlockedAt).length
  const sorted = [...game.achievements].sort((a, b) => (a.unlockedAt ? 0 : 1) - (b.unlockedAt ? 0 : 1))

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <div>
          <p className="eyebrow">{t('ach.unlockedCount', { count: unlocked, total: game.achievements.length })}</p>
          <h1 className="page-title">{t('ach.title')}</h1>
        </div>
      </header>

      <section className="level-card surface">
        <ProgressRing value={level.progress} size={96} stroke={8}>
          <span className="level-num num">{level.level}</span>
        </ProgressRing>
        <div className="level-text">
          <p className="eyebrow">{t(levelTitleKey(level.level))}</p>
          <h2 className="display">{t('ach.level', { level: level.level })}</h2>
          <p className="muted num">{t('ach.xp', { xp: game.xp })} · {t('ach.toNext', { xp: levelThreshold(level.level + 1) - level.xp, level: level.level + 1 })}</p>
          <Bar value={level.progress} />
        </div>
      </section>
      <p className="subtle small" style={{ marginTop: 10 }}>{t('ach.howXp')}</p>

      <section className="section">
        <h2 className="section-title">{t('ach.challenges')}</h2>
        <div className="surface panel">
          <ChallengeList week={startOfWeek(today, 1)} />
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">{t('ach.badges')}</h2>
        <ul className="badge-grid">
          {sorted.map((a) => (
            <li key={a.id} className={`badge-card${a.unlockedAt ? ' unlocked' : ''}`}>
              <span className="badge-icon" aria-hidden>
                {a.unlockedAt ? <NamedIcon name={a.icon} size={24} /> : <Lock size={20} />}
              </span>
              <strong>{t(`ach.${a.id}.name`)}</strong>
              <span className="subtle small">{t(`ach.${a.id}.desc`)}</span>
              {a.unlockedAt ? (
                <span className="badge success">{t('ach.unlocked', { date: fmt.short(a.unlockedAt) })}</span>
              ) : (
                <span className="badge-progress">
                  <Bar value={a.progress.value / a.progress.goal} />
                  <span className="subtle tiny num">{t('ach.progress', { value: a.progress.value, goal: a.progress.goal })}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
