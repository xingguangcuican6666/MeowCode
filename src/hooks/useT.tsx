/**
 * React bindings for the message catalog. The catalog itself lives in
 * ../lib/i18n.ts, which stays React-free on purpose: the WebUI server imports it
 * to serve /api/i18n, and a React import there would drag the whole UI runtime
 * into the server's dependency graph. Anything that needs a hook comes here.
 */
import { createContext, useContext } from 'react'
import { detectLang, translate, type Lang, type MessageKey, type Params } from '../lib/i18n'

const LangContext = createContext<Lang>(detectLang())

export const LangProvider = LangContext.Provider

/** The active language from the nearest <LangProvider> above. */
export function useLang(): Lang { return useContext(LangContext) }

/** A translator bound to the active language; re-renders on a language switch. */
export function useT(): (key: MessageKey, params?: Params) => string {
  const lang = useLang()
  return (key, params) => translate(lang, key, params)
}