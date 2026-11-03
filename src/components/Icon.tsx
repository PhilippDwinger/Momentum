import {
  Apple,
  Bed,
  Bike,
  BookOpen,
  Brain,
  Briefcase,
  CalendarCheck,
  CalendarRange,
  Camera,
  CheckCheck,
  CircleCheck,
  Code,
  Coffee,
  Crown,
  Dog,
  Dumbbell,
  Flame,
  Flower2,
  Footprints,
  GlassWater,
  GraduationCap,
  Guitar,
  Heart,
  HeartPulse,
  House,
  Languages,
  Laptop,
  LayoutList,
  Leaf,
  ListTodo,
  Mail,
  Medal,
  Moon,
  Mountain,
  Music,
  NotebookPen,
  Palette,
  PenLine,
  PhoneOff,
  PiggyBank,
  Pill,
  Rocket,
  RotateCcw,
  Salad,
  Shapes,
  Smile,
  Sparkles,
  Sprout,
  Star,
  StretchHorizontal,
  Sun,
  Sunrise,
  Tag,
  Target,
  Timer,
  Trees,
  Trophy,
  Users,
  Wallet,
  Waves,
  type LucideIcon,
} from 'lucide-react'
import type { CSSProperties } from 'react'
import type { ColorKey } from '../domain/types'

export const ICONS: Record<string, LucideIcon> = {
  'circle-check': CircleCheck,
  languages: Languages,
  dumbbell: Dumbbell,
  'book-open': BookOpen,
  code: Code,
  'graduation-cap': GraduationCap,
  'heart-pulse': HeartPulse,
  'stretch-horizontal': StretchHorizontal,
  footprints: Footprints,
  bike: Bike,
  waves: Waves,
  'glass-water': GlassWater,
  apple: Apple,
  salad: Salad,
  pill: Pill,
  moon: Moon,
  bed: Bed,
  sun: Sun,
  sunrise: Sunrise,
  leaf: Leaf,
  brain: Brain,
  music: Music,
  guitar: Guitar,
  palette: Palette,
  'pen-line': PenLine,
  'notebook-pen': NotebookPen,
  camera: Camera,
  rocket: Rocket,
  target: Target,
  'list-todo': ListTodo,
  laptop: Laptop,
  briefcase: Briefcase,
  mail: Mail,
  wallet: Wallet,
  'piggy-bank': PiggyBank,
  sprout: Sprout,
  flower: Flower2,
  trees: Trees,
  mountain: Mountain,
  dog: Dog,
  house: House,
  coffee: Coffee,
  'phone-off': PhoneOff,
  timer: Timer,
  users: Users,
  heart: Heart,
  smile: Smile,
  sparkles: Sparkles,
  star: Star,
  flame: Flame,
  trophy: Trophy,
  medal: Medal,
  crown: Crown,
  shapes: Shapes,
  'calendar-check': CalendarCheck,
  'calendar-range': CalendarRange,
  'check-check': CheckCheck,
  'rotate-ccw': RotateCcw,
  'layout-list': LayoutList,
  tag: Tag,
}

/** Icons offered in the activity editor. */
export const ACTIVITY_ICON_CHOICES = [
  'circle-check', 'languages', 'dumbbell', 'book-open', 'code', 'graduation-cap', 'heart-pulse', 'stretch-horizontal',
  'footprints', 'bike', 'waves', 'glass-water', 'apple', 'salad', 'pill', 'moon', 'bed', 'sunrise', 'leaf', 'brain',
  'music', 'guitar', 'palette', 'pen-line', 'notebook-pen', 'camera', 'rocket', 'target', 'list-todo', 'laptop',
  'briefcase', 'mail', 'wallet', 'piggy-bank', 'sprout', 'flower', 'trees', 'mountain', 'dog', 'house', 'coffee',
  'phone-off', 'timer', 'users', 'heart', 'smile', 'sparkles', 'star',
]

export function NamedIcon({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  const Cmp = ICONS[name] ?? CircleCheck
  return <Cmp size={size} className={className} aria-hidden strokeWidth={2} />
}

export const colorVar = (c: ColorKey | string | undefined) => `var(--c-${c ?? 'slate'})`
export const acStyle = (c: ColorKey | string | undefined): CSSProperties => ({ ['--ac' as string]: colorVar(c) }) as CSSProperties

export function ActivityIcon({
  icon,
  color,
  size = 'md',
}: {
  icon: string
  color: ColorKey | string
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  const px = { sm: 16, md: 20, lg: 28, xl: 34 }[size]
  return (
    <span className={`a-icon ${size === 'md' ? '' : size}`} style={acStyle(color)} aria-hidden>
      {icon.startsWith('i:') ? <NamedIcon name={icon.slice(2)} size={px} /> : <span>{icon}</span>}
    </span>
  )
}

/** Brand mark: a rising arc made of three steps. */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="18" fill="var(--accent)" />
      <path d="M16 44 L28 32 L36 38 L48 22" fill="none" stroke="var(--on-accent)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="48" cy="22" r="4.5" fill="var(--on-accent)" />
    </svg>
  )
}
