import { addDays, parseTime, zonedTimeToUtc } from './dates'
import { activityOccurrences, isDone, isPlanned, occKey, occurrencesOn, type DataIndex } from './occurrences'
import type { StreakInfo } from './streaks'
import { STREAK_MILESTONES } from './streaks'
import type { Activity, DateKey, ID, NotifyTone, Occurrence } from './types'

/**
 * Motivational notification texts + the push plan. Pure and deterministic: the same state on
 * two devices yields the same plan (texts vary by day/activity, not by randomness).
 */

type Lang = 'de' | 'en'
type Pools = Record<NotifyTone, string[]>
type Texts = Record<Lang, Record<string, Pools>>

const T: Texts = {
  de: {
    reminderTitle: {
      intense: ['🔥 {a} – jetzt!', '⚡ Zeit für {a}', '💪 {a} wartet auf dich', '🚀 Los geht’s: {a}', '🎯 {a}. Heute. Jetzt.'],
      motivating: ['Zeit für {a}', '{a} steht an', 'Bereit für {a}?'],
      gentle: ['Erinnerung: {a}', '{a}'],
    },
    reminderStreak: {
      intense: [
        'Tag {next} deiner Serie steht auf dem Spiel. {target} – mehr braucht’s nicht. Zieh’s durch!',
        '{s} Mal in Folge. Du hörst jetzt nicht auf. {target}, dann gehört der Haken dir.',
        'Deine Serie lebt von dir: {s} → {next}. Gib ihr Futter.',
        'Champions verhandeln nicht mit der Couch. {target} {a}. Jetzt.',
        '{s} Tage Disziplin wirft man nicht weg. Mach {next} draus!',
        'Dein zukünftiges Ich applaudiert schon. {target} – leg los.',
        'Andere reden, du lieferst. Serie {s}, heute wird’s {next}.',
      ],
      motivating: ['Deine {s}er-Serie freut sich auf Nummer {next}.', '{target} – du schaffst das. Serie: {s}.', 'Weiter so: {s} in Folge. Heute die {next}?'],
      gentle: ['Wenn es gerade passt: {target}. Deine Serie steht bei {s}.', 'Ein kleiner Schritt für heute: {target}.'],
    },
    reminderFresh: {
      intense: [
        'Jede große Serie fängt mit Tag 1 an. Heute ist deiner.',
        'Der schwerste Schritt ist der erste. {target} – mehr nicht.',
        'Neustart? Perfekt. Die besten Comebacks beginnen genau jetzt.',
        '5 Minuten Anfang schlagen 0 Minuten Perfektion. Los!',
        'Du musst nicht motiviert sein. Du musst nur anfangen. {target}.',
      ],
      motivating: ['Heute legst du den Grundstein: {target}.', 'Fang klein an – {target} reicht völlig.', 'Ein Haken heute, und die Serie startet.'],
      gentle: ['Wenn du magst: {target}.', 'Heute steht {a} an.'],
    },
    reminderMilestone: {
      intense: [
        'Noch dieser eine Termin und du knackst die {next}er-Serie! 🏆',
        'Meilenstein in Reichweite: {next} in Folge. Das lässt du dir nicht nehmen!',
        '{next}er-Serie wartet. Nur noch {target} trennt dich davon.',
      ],
      motivating: ['Gleich geschafft: Heute wird’s die {next}er-Serie!', 'Noch einmal {a} – dann {next} in Folge.'],
      gentle: ['Heute könntest du {next} in Folge erreichen.', 'Bald {next} in Folge.'],
    },
    morningTitle: {
      intense: ['☀️ Guten Morgen{name}!', '⚡ Neuer Tag, neue Siege{name}', '🔥 Auf geht’s{name}!'],
      motivating: ['Guten Morgen{name}', 'Dein Tag{name}'],
      gentle: ['Guten Morgen{name}', 'Heute geplant'],
    },
    morningBody: {
      intense: [
        '{n} Missionen heute. Starte mit {first} und nimm den Rest mit Momentum mit.',
        '{n} Dinge stehen an – und du hast jedes einzelne drauf.',
        'Der Tag gehört dir. {n} Termine, beginnend mit {first}. Zeig, was du kannst.',
        'Heute ist kein Tag für „vielleicht“. {n} Termine – erst {first}, dann der Rest.',
      ],
      motivating: ['{n} Termine heute. Fang mit {first} an.', 'Schöner Plan für heute: {n} Termine.'],
      gentle: ['Heute geplant: {n}. Hab einen schönen Tag.', '{n} Termine heute – ganz in deinem Tempo.'],
    },
    morningStreak: {
      intense: ['Heute baust du weiter an deiner {best}er-Serie bei {ba}. {n} Termine. Keine Ausreden.', '{best} in Folge bei {ba} – heute wird die Zahl größer. {n} Termine warten.'],
      motivating: ['Heute: {n} Termine. Deine beste Serie: {best} bei {ba}.'],
      gentle: ['{n} Termine heute. {ba} läuft schon {best} Mal in Folge.'],
    },
    morningXp: {
      intense: ['Nur noch {xp} XP bis Level {lvl}. Heute holst du sie dir – {n} Termine.'],
      motivating: ['{xp} XP bis Level {lvl}. {n} Termine heute.'],
      gentle: ['{n} Termine heute. Level {lvl} ist nah.'],
    },
    morningComeback: {
      intense: [
        'Gestern lief nicht alles? Egal. Champions verpassen nie zweimal. {n} Termine heute.',
        'Ein schlechter Tag ist kein Trend. Heute drehst du’s: {n} Termine.',
      ],
      motivating: ['Neuer Tag, neue Chance: {n} Termine heute.', 'Gestern ist vorbei – heute zählt. {n} Termine.'],
      gentle: ['Heute ist ein neuer Tag. {n} Termine geplant.', 'Kein Druck – heute stehen {n} Termine an.'],
    },
    eveningTitle: {
      intense: ['⏰ Letzte Chance heute', '🔥 Endspurt!', '💥 Noch nicht vorbei'],
      motivating: ['Endspurt?', 'Noch offen heute'],
      gentle: ['Noch offen', 'Abend-Check'],
    },
    eveningRisk: {
      intense: [
        'Deine {rs}er-Serie bei {ra} hängt am seidenen Faden. Rette sie – jetzt!',
        '{rs} Tage Arbeit. Lass sie heute nicht sterben. {ra} wartet.',
        'Noch {open} offen. Deine {rs}er-Serie bei {ra} zählt auf dich.',
      ],
      motivating: ['Deine {rs}er-Serie bei {ra} wartet noch auf heute.', 'Noch {open} offen – {ra} hält deine {rs}er-Serie.'],
      gentle: ['{ra} ist heute noch offen (Serie: {rs}).', 'Noch {open} offen, wenn es passt.'],
    },
    eveningOpen: {
      intense: [
        'Noch {open} offen. 10 Minuten entscheiden, ob du morgen stolz bist.',
        'Der Tag ist noch nicht vorbei. {names} – du kannst das noch reißen.',
        'Aufgeben ist keine Option. {open} offen – du bist näher dran, als du denkst.',
        'Nicht perfekt, aber dran bleiben: Schnapp dir wenigstens {first}.',
      ],
      motivating: ['Noch {open} offen – ein kurzer Endspurt?', '{names} ist noch offen. Packst du’s noch?'],
      gentle: ['Noch {open} offen. Morgen ist auch ein Tag – aber vielleicht passt es ja noch.', 'Offen: {names}.'],
    },
    celebrate: {
      intense: ['🔥 {next}er-Serie bei {a}! Unaufhaltsam.', '💪 {a} erledigt. Serie {next} – du bist im Flow!', '🚀 {next} in Folge. Weiter, weiter, weiter!'],
      motivating: ['{a} erledigt – Serie {next}.', 'Stark! {next} in Folge bei {a}.'],
      gentle: ['{a} erledigt.', '{a} erledigt – schön.'],
    },
    celebrateMilestone: {
      intense: ['🏆 MEILENSTEIN: {next}er-Serie bei {a}! Legendär.', '🏆 {next} in Folge! Das schaffen die wenigsten.'],
      motivating: ['🏆 {next}er-Serie bei {a}! Großartig.'],
      gentle: ['{next} in Folge bei {a}. Schön!'],
    },
  },
  en: {
    reminderTitle: {
      intense: ['🔥 {a} – now!', '⚡ Time for {a}', '💪 {a} is waiting', '🚀 Let’s go: {a}', '🎯 {a}. Today. Now.'],
      motivating: ['Time for {a}', '{a} is up', 'Ready for {a}?'],
      gentle: ['Reminder: {a}', '{a}'],
    },
    reminderStreak: {
      intense: [
        'Day {next} of your streak is on the line. {target} – that’s all it takes. Do it!',
        '{s} in a row. You don’t stop now. {target}, and the checkmark is yours.',
        'Your streak lives on you: {s} → {next}. Feed it.',
        'Champions don’t negotiate with the couch. {target} {a}. Now.',
        '{s} days of discipline are not to be thrown away. Make it {next}!',
      ],
      motivating: ['Your {s}-streak is looking forward to number {next}.', '{target} – you’ve got this. Streak: {s}.'],
      gentle: ['If it fits right now: {target}. Your streak: {s}.', 'One small step for today: {target}.'],
    },
    reminderFresh: {
      intense: ['Every great streak starts with day 1. Today is yours.', 'The hardest step is the first. {target} – nothing more.', '5 minutes of starting beat 0 minutes of perfect. Go!'],
      motivating: ['Today you lay the foundation: {target}.', 'Start small – {target} is plenty.'],
      gentle: ['If you like: {target}.', '{a} is planned today.'],
    },
    reminderMilestone: {
      intense: ['One more and you crack the {next}-streak! 🏆', 'Milestone in reach: {next} in a row. Don’t let it slip!'],
      motivating: ['Almost there: today could be your {next}-streak!'],
      gentle: ['Today you could reach {next} in a row.'],
    },
    morningTitle: {
      intense: ['☀️ Good morning{name}!', '⚡ New day, new wins{name}', '🔥 Let’s go{name}!'],
      motivating: ['Good morning{name}', 'Your day{name}'],
      gentle: ['Good morning{name}', 'Planned today'],
    },
    morningBody: {
      intense: ['{n} missions today. Start with {first} and ride the momentum.', '{n} things are planned – and you can handle every single one.'],
      motivating: ['{n} items today. Start with {first}.'],
      gentle: ['Planned today: {n}. Have a nice day.', '{n} items today – at your own pace.'],
    },
    morningStreak: {
      intense: ['Today you keep building your {best}-streak on {ba}. {n} items. No excuses.'],
      motivating: ['Today: {n} items. Best streak: {best} on {ba}.'],
      gentle: ['{n} items today. {ba} runs {best} in a row.'],
    },
    morningXp: {
      intense: ['Only {xp} XP to level {lvl}. Today you take them – {n} items.'],
      motivating: ['{xp} XP to level {lvl}. {n} items today.'],
      gentle: ['{n} items today. Level {lvl} is close.'],
    },
    morningComeback: {
      intense: ['Yesterday didn’t go to plan? Champions never miss twice. {n} items today.'],
      motivating: ['New day, new chance: {n} items today.'],
      gentle: ['Today is a new day. {n} items planned.'],
    },
    eveningTitle: {
      intense: ['⏰ Last chance today', '🔥 Final sprint!', '💥 Not over yet'],
      motivating: ['Final sprint?', 'Still open today'],
      gentle: ['Still open', 'Evening check'],
    },
    eveningRisk: {
      intense: ['Your {rs}-streak on {ra} hangs by a thread. Save it – now!', '{rs} days of work. Don’t let them die today. {ra} is waiting.'],
      motivating: ['Your {rs}-streak on {ra} is still waiting for today.'],
      gentle: ['{ra} is still open today (streak: {rs}).'],
    },
    eveningOpen: {
      intense: ['{open} still open. 10 minutes decide whether you’re proud tomorrow.', 'The day isn’t over. {names} – you can still pull it off.', 'Giving up is not an option. {open} open – you’re closer than you think.'],
      motivating: ['{open} still open – quick final sprint?'],
      gentle: ['{open} still open. Tomorrow is another day – but maybe it still fits.'],
    },
    celebrate: {
      intense: ['🔥 {next}-streak on {a}! Unstoppable.', '💪 {a} done. Streak {next} – you’re in the flow!'],
      motivating: ['{a} done – streak {next}.'],
      gentle: ['{a} done.'],
    },
    celebrateMilestone: {
      intense: ['🏆 MILESTONE: {next}-streak on {a}! Legendary.'],
      motivating: ['🏆 {next}-streak on {a}! Great.'],
      gentle: ['{next} in a row on {a}. Nice!'],
    },
  },
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ''))
}

export function pick(lang: Lang, pool: string, tone: NotifyTone, seed: string, vars: Record<string, string | number>): string {
  const list = T[lang][pool]?.[tone] ?? T[lang][pool]?.motivating ?? ['']
  return fill(list[hash(seed) % list.length], vars)
}

export interface TextHelpers {
  lang: Lang
  /** e.g. "15 min", "10 Seiten" */
  amount: (a: Activity, value: number) => string
}

/** Text for the in-app completion toast. */
export function celebrationText(lang: Lang, tone: NotifyTone, activity: Activity, newStreak: number, seed: string): string {
  const milestone = STREAK_MILESTONES.includes(newStreak)
  if (newStreak < 2) return pick(lang, 'celebrate', 'gentle', seed, { a: activity.name, next: newStreak })
  return pick(lang, milestone ? 'celebrateMilestone' : 'celebrate', tone, seed, { a: activity.name, next: newStreak })
}

// ---------------------------------------------------------------------------
// Push plan
// ---------------------------------------------------------------------------

export interface PlanItem {
  id: string
  /** epoch ms (UTC) */
  at: number
  title: string
  body: string
  tag: string
  url: string
  kind: 'reminder' | 'morning' | 'evening'
  occKey?: string
}

export interface PlanInput {
  index: DataIndex
  streaks: Map<ID, StreakInfo>
  now: Date
  today: DateKey
  timeZone: string
  lang: Lang
  helpers: TextHelpers
  xpToNext: number
  nextLevel: number
  horizonDays?: number
}

function nextMilestone(s: number): number | null {
  return STREAK_MILESTONES.find((m) => m > s) ?? null
}

/** Expected streak if every planned occurrence of the activity before `day` gets done. */
function expectedStreak(index: DataIndex, a: Activity, streak: StreakInfo | undefined, today: DateKey, day: DateKey): number {
  let s = streak?.current ?? 0
  if (day <= today) return s
  for (const o of activityOccurrences(index, a, today, addDays(day, -1))) {
    if (!isPlanned(o)) continue
    if (o.date === today && isDone(o)) continue // already counted in current
    s++
  }
  return s
}

export function buildNotificationPlan(input: PlanInput): PlanItem[] {
  const { index, streaks, now, today, timeZone, lang, helpers } = input
  const settings = index.settings
  const tone = settings.notifyTone || 'intense'
  const name = settings.name.trim() ? `, ${settings.name.trim()}` : ''
  const nowMs = now.getTime()
  const items: PlanItem[] = []
  const horizon = input.horizonDays ?? 3

  for (let i = 0; i < horizon; i++) {
    const day = addDays(today, i)
    const occs = occurrencesOn(index, day).filter(isPlanned)
    const open = occs.filter((o) => !isDone(o))

    // per-activity reminders
    for (const o of open) {
      const a = index.activityById.get(o.activityId)
      const minutes = parseTime(a?.reminderTime)
      if (!a || minutes === null) continue
      const at = zonedTimeToUtc(day, minutes, timeZone)
      if (at <= nowMs) continue
      const s = expectedStreak(index, a, streaks.get(a.id), today, day)
      const next = s + 1
      const target = a.kind === 'check' ? (a.durationMinutes ? helpers.amount({ ...a, kind: 'duration' }, a.durationMinutes) : '1×') : helpers.amount(a, o.target)
      const vars = { a: a.name, s, next, target }
      const seed = `${day}|${o.key}`
      const pool = nextMilestone(s) === next ? 'reminderMilestone' : s >= 2 ? 'reminderStreak' : 'reminderFresh'
      items.push({
        id: `${day}:r:${o.key}`,
        at,
        title: pick(lang, 'reminderTitle', tone, seed, vars),
        body: pick(lang, pool, tone, seed, vars),
        tag: `occ-${o.key}`,
        url: `./#/today?d=${day}`,
        kind: 'reminder',
        occKey: occKey(o.activityId, o.originalDate),
      })
    }

    if (occs.length === 0) continue
    const firstName = (list: Occurrence[]) => index.activityById.get(list[0]?.activityId)?.name ?? ''
    let best = { n: 0, name: '' }
    for (const o of occs) {
      const s = streaks.get(o.activityId)?.current ?? 0
      if (s > best.n) best = { n: s, name: index.activityById.get(o.activityId)?.name ?? '' }
    }

    // morning kick-off
    const morning = parseTime(settings.notifyMorning)
    if (morning !== null && open.length > 0) {
      const at = zonedTimeToUtc(day, morning, timeZone)
      if (at > nowMs) {
        const yesterday = occurrencesOn(index, addDays(day, -1)).filter(isPlanned)
        const missedYesterday = day === addDays(today, 1) || day === today ? yesterday.some((o) => !isDone(o) && o.date < today) : false
        const vars = { n: open.length, first: firstName(open), best: best.n, ba: best.name, xp: input.xpToNext, lvl: input.nextLevel, name }
        const seed = `${day}|morning`
        const variant = hash(seed) % 3
        const pool = missedYesterday
          ? 'morningComeback'
          : variant === 0 && best.n >= 3
            ? 'morningStreak'
            : variant === 1 && input.xpToNext <= 100
              ? 'morningXp'
              : 'morningBody'
        const body = pick(lang, pool, tone, seed, vars)
        items.push({ id: `${day}:m`, at, title: pick(lang, 'morningTitle', tone, seed, vars), body, tag: `morning-${day}`, url: `./#/today?d=${day}`, kind: 'morning' })
      }
    }

    // evening rescue (today: only if something is open right now; later days: assume open)
    const evening = parseTime(settings.notifyEvening)
    if (evening !== null && open.length > 0) {
      const at = zonedTimeToUtc(day, evening, timeZone)
      if (at > nowMs) {
        let risk = { n: 0, name: '' }
        for (const o of open) {
          const a = index.activityById.get(o.activityId)
          const s = a ? expectedStreak(index, a, streaks.get(a.id), today, day) : 0
          if (s > risk.n) risk = { n: s, name: a?.name ?? '' }
        }
        const names = open.slice(0, 3).map((o) => index.activityById.get(o.activityId)?.name ?? '').join(', ')
        const vars = { open: open.length, names, first: firstName(open), rs: risk.n, ra: risk.name }
        const seed = `${day}|evening`
        items.push({
          id: `${day}:e`,
          at,
          title: pick(lang, 'eveningTitle', tone, seed, vars),
          body: pick(lang, risk.n >= 2 ? 'eveningRisk' : 'eveningOpen', tone, seed, vars),
          tag: `evening-${day}`,
          url: `./#/today?d=${day}`,
          kind: 'evening',
        })
      }
    }
  }
  return items.sort((x, y) => x.at - y.at)
}
