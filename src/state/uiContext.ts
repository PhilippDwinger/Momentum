import { createContext, useContext } from 'react'
import type { ParsedImport } from '../data/importParse'
import type { TemplateItem } from '../domain/templates'
import type { DateKey, ID } from '../domain/types'

export type OverlaySpec =
  | { type: 'editor'; activityId?: ID; date?: DateKey; scopeFrom?: DateKey; template?: TemplateItem }
  | { type: 'occurrence'; activityId: ID; originalDate: DateKey }
  | { type: 'log'; activityId: ID; originalDate: DateKey }
  | { type: 'move'; activityId: ID; originalDate: DateKey }
  | { type: 'occEdit'; activityId: ID; originalDate: DateKey }
  | { type: 'templates' }
  | { type: 'categories' }
  | { type: 'shortcuts' }
  | { type: 'syncChoice' }
  | { type: 'conflicts' }
  | { type: 'import'; parsed: ParsedImport }
  | { type: 'confirm'; title: string; message: string; confirmLabel: string; danger?: boolean; resolve: (ok: boolean) => void }

export type Overlay = OverlaySpec & { id: number }

export interface UIApi {
  open: (spec: OverlaySpec) => number
  close: (id: number) => void
  confirm: (opts: { title: string; message: string; confirmLabel: string; danger?: boolean }) => Promise<boolean>
}

export const UIContext = createContext<UIApi>({
  open: () => 0,
  close: () => {},
  confirm: async () => false,
})

export const useUI = () => useContext(UIContext)
