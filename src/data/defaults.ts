import type { Category, ColorKey, UserSettings } from '../domain/types'

export const SETTINGS_ID = 'settings'

export const DEFAULT_SETTINGS: UserSettings = {
  id: SETTINGS_ID,
  createdAt: 0,
  updatedAt: 0,
  version: '',
  deletedAt: null,
  name: '',
  dayStartHour: 0,
  weekStartsOn: 1,
  streakProtection: true,
  overloadThreshold: 5,
  showMotivation: true,
}

/** Built-in categories use deterministic ids so that seeding on two devices converges. */
export const BUILTIN_CATEGORIES: { builtin: string; color: ColorKey; icon: string }[] = [
  { builtin: 'health', color: 'green', icon: 'i:heart-pulse' },
  { builtin: 'learning', color: 'blue', icon: 'i:graduation-cap' },
  { builtin: 'fitness', color: 'ember', icon: 'i:dumbbell' },
  { builtin: 'projects', color: 'violet', icon: 'i:rocket' },
  { builtin: 'lifestyle', color: 'amber', icon: 'i:sprout' },
  { builtin: 'productivity', color: 'indigo', icon: 'i:target' },
]

export const builtinCategoryId = (key: string) => `cat_${key}`

export function builtinCategoryRecords(): Omit<Category, 'createdAt' | 'updatedAt' | 'version' | 'deletedAt'>[] {
  return BUILTIN_CATEGORIES.map((c, i) => ({
    id: builtinCategoryId(c.builtin),
    name: '',
    builtin: c.builtin,
    color: c.color,
    icon: c.icon,
    sortOrder: i,
  }))
}
