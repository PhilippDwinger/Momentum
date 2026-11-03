import type { ActivityKind, ColorKey, RecurrenceRule } from './types'

type L = { de: string; en: string }

export interface TemplateItem {
  name: L
  description?: L
  icon: string
  color: ColorKey
  category: string // built-in category key
  kind: ActivityKind
  target: number
  unit?: L
  rule: RecurrenceRule
  time?: string
  durationMinutes?: number
}

export interface Template {
  id: string
  icon: string
  title: L
  subtitle: L
  items: TemplateItem[]
}

const daily: RecurrenceRule = { freq: 'daily', interval: 1 }
const weekdays: RecurrenceRule = { freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] }
const monWedFri: RecurrenceRule = { freq: 'weekly', interval: 1, weekdays: [1, 3, 5] }

export const TEMPLATES: Template[] = [
  {
    id: 'morning',
    icon: 'sunrise',
    title: { de: 'Morgenroutine', en: 'Morning routine' },
    subtitle: { de: 'Wasser, Dehnen, Tagesplan', en: 'Water, stretching, daily plan' },
    items: [
      { name: { de: 'Glas Wasser', en: 'Glass of water' }, icon: 'i:glass-water', color: 'sky', category: 'health', kind: 'check', target: 1, rule: daily, time: '07:00' },
      { name: { de: 'Dehnen', en: 'Stretching' }, icon: 'i:stretch-horizontal', color: 'teal', category: 'fitness', kind: 'duration', target: 10, rule: daily, time: '07:10' },
      { name: { de: 'Tag planen', en: 'Plan the day' }, icon: 'i:list-todo', color: 'indigo', category: 'productivity', kind: 'check', target: 1, rule: weekdays, time: '07:30', durationMinutes: 5 },
    ],
  },
  {
    id: 'evening',
    icon: 'moon',
    title: { de: 'Abendroutine', en: 'Evening routine' },
    subtitle: { de: 'Lesen, Tagebuch, früh ins Bett', en: 'Reading, journaling, early night' },
    items: [
      { name: { de: 'Lesen', en: 'Reading' }, icon: 'i:book-open', color: 'amber', category: 'learning', kind: 'count', target: 10, unit: { de: 'Seiten', en: 'pages' }, rule: daily, time: '21:00' },
      { name: { de: 'Tagebuch', en: 'Journaling' }, icon: 'i:notebook-pen', color: 'violet', category: 'lifestyle', kind: 'check', target: 1, rule: daily, time: '21:30', durationMinutes: 5 },
      { name: { de: 'Bildschirmfrei ab 22 Uhr', en: 'Screens off at 10 pm' }, icon: 'i:moon', color: 'slate', category: 'health', kind: 'check', target: 1, rule: daily, time: '22:00' },
    ],
  },
  {
    id: 'study',
    icon: 'graduation-cap',
    title: { de: 'Lerneinheit', en: 'Study session' },
    subtitle: { de: '45 Minuten konzentriert, werktags', en: '45 focused minutes on weekdays' },
    items: [
      { name: { de: 'Lerneinheit', en: 'Study session' }, icon: 'i:graduation-cap', color: 'blue', category: 'learning', kind: 'duration', target: 45, rule: weekdays, time: '18:00' },
    ],
  },
  {
    id: 'gym',
    icon: 'dumbbell',
    title: { de: 'Training', en: 'Gym session' },
    subtitle: { de: 'Mo, Mi, Fr – ein Workout', en: 'Mon, Wed, Fri – one workout' },
    items: [
      { name: { de: 'Training', en: 'Workout' }, icon: 'i:dumbbell', color: 'ember', category: 'fitness', kind: 'check', target: 1, rule: monWedFri, time: '18:30', durationMinutes: 60 },
    ],
  },
  {
    id: 'language',
    icon: 'languages',
    title: { de: 'Sprache lernen', en: 'Language learning' },
    subtitle: { de: '15 Minuten täglich, z. B. Japanisch', en: '15 minutes a day, e.g. Japanese' },
    items: [
      { name: { de: 'Japanisch', en: 'Japanese' }, icon: 'i:languages', color: 'pink', category: 'learning', kind: 'duration', target: 15, rule: daily, time: '19:30' },
    ],
  },
  {
    id: 'coding',
    icon: 'code',
    title: { de: 'Programmieren üben', en: 'Practice programming' },
    subtitle: { de: '30 Minuten an Werktagen', en: '30 minutes on weekdays' },
    items: [
      { name: { de: 'Programmieren', en: 'Programming' }, icon: 'i:code', color: 'green', category: 'projects', kind: 'duration', target: 30, rule: weekdays },
    ],
  },
  {
    id: 'mindful',
    icon: 'leaf',
    title: { de: 'Achtsamkeit', en: 'Mindfulness' },
    subtitle: { de: 'Meditation und Spaziergang', en: 'Meditation and a walk' },
    items: [
      { name: { de: 'Meditation', en: 'Meditation' }, icon: 'i:leaf', color: 'lime', category: 'health', kind: 'duration', target: 10, rule: daily, time: '08:00' },
      { name: { de: 'Spaziergang', en: 'Walk' }, icon: 'i:footprints', color: 'green', category: 'lifestyle', kind: 'custom', target: 3, unit: { de: 'km', en: 'km' }, rule: { freq: 'weekly', interval: 1, weekdays: [2, 4, 6] } },
    ],
  },
  {
    id: 'water',
    icon: 'glass-water',
    title: { de: 'Genug trinken', en: 'Hydration' },
    subtitle: { de: '8 Gläser am Tag', en: '8 glasses a day' },
    items: [
      { name: { de: 'Wasser trinken', en: 'Drink water' }, icon: 'i:glass-water', color: 'sky', category: 'health', kind: 'count', target: 8, unit: { de: 'Gläser', en: 'glasses' }, rule: daily },
    ],
  },
]
