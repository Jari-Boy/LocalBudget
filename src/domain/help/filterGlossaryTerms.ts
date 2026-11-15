/**
 * 用語集の1項目(計画Issue #177)。文言は表示言語ごとの辞書(locales/ja/help.json)から組み立てて渡す。
 * categoryは区分のタブの識別子(GLOSSARY_CATEGORIES)。
 */
export interface GlossaryEntry {
  id: string
  category: string
  term: string
  description: string
  /** 簿記の言葉での言い換え。無い用語もある */
  bookkeeping?: string
}

export interface GlossaryFilter {
  /** 検索語が空のときに出す区分 */
  category: string
  query: string
}

/**
 * 用語集の絞り込み。検索語が空(空白のみを含む)なら選んだ区分の用語だけを、検索語があるときは
 * 区分に関わらず全区分から、用語名・説明・簿記での言い換えのいずれかに含まれる用語を返す。
 * 大文字小文字と、検索語の前後の空白は無視する。並びは元の順を保つ。
 */
export function filterGlossaryTerms(entries: readonly GlossaryEntry[], filter: GlossaryFilter): GlossaryEntry[] {
  const query = filter.query.trim().toLowerCase()
  if (query === '') return entries.filter((entry) => entry.category === filter.category)

  return entries.filter((entry) =>
    [entry.term, entry.description, entry.bookkeeping ?? ''].some((text) => text.toLowerCase().includes(query)),
  )
}
