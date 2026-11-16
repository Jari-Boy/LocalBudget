import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ACCOUNT_TEMPLATE_KEYS,
  ACCOUNT_TEMPLATES,
  CASH_ACCOUNT_NAME,
  findTemplateAdditions,
  type AccountTemplateKey,
} from '../../domain/onboarding/accountTemplates'
import './onboarding.css'

export type SetupStorageChoice = 'indexeddb' | 'folder'

export interface SetupValues {
  memberName: string
  template: AccountTemplateKey
  /** 保存先に選んだ空のフォルダ。ブラウザ内なら null */
  folder: FileSystemDirectoryHandle | null
}

/** 選んだフォルダ。hasExistingDataは、すでにLocalBudgetのデータ(DBファイル)があるか */
export interface FolderChoice {
  handle: FileSystemDirectoryHandle
  name: string
  hasExistingData: boolean
}

export interface SetupScreenProps {
  /** フォルダへの保存に対応しているブラウザか(対応していなければ選べない) */
  folderSupported: boolean
  /** 確定中(ボタンを押せなくする) */
  submitting: boolean
  /** 確定に失敗したときのメッセージ */
  error: string | null
  /** 「フォルダに保存」を選んだ時点でフォルダを選ばせる。取りやめたらnull。失敗は例外 */
  onChooseFolder: () => Promise<FolderChoice | null>
  /** すでにデータがあるフォルダを、上書きせずそのまま読み込む(成功すると再読み込みされる)。失敗は例外 */
  onLoadFolder: (folder: FileSystemDirectoryHandle) => Promise<void>
  onSubmit: (values: SetupValues) => void
  onBack: () => void
}

/** どのテンプレートでも常に入るシステム管理の科目と、自分で登録する科目の例(プレビュー用) */
const SYSTEM_ASSET = ['未収金(精算バッチ)']
const SYSTEM_LIABILITY = ['未払金(精算バッチ)']
const SYSTEM_EQUITY = ['初期残高']
const SYSTEM_REVENUE = ['雑収入']
const SYSTEM_EXPENSE = ['雑損失', '残高調整']
const EXAMPLE_ASSET = ['普通預金', '電子マネー', '証券口座']
const EXAMPLE_LIABILITY = ['クレジットカード', 'ローン']

/**
 * 初期設定画面(計画Issue #177、承認済みモックアップ②)。世帯メンバーの名前(必須)・保存先・
 * 科目テンプレートを1画面で決める。テンプレートを選ぶと、入る科目を資産・負債・純資産・収益・費用の
 * 5区分のプレビューに出す(テンプレートで入る/システム管理で常に入る/自分で登録する、を見分けられる)。
 * 名前が空の間は「この設定で始める」を押せない。
 * 「フォルダに保存」を選ぶと、その場でフォルダを選ぶ。選んだフォルダにすでにデータがあるときは、上書きせず、
 * 「このデータを読み込む」か「別のフォルダを選ぶ」かを選ばせる(読み込む場合は、名前・テンプレートは使わない)。
 * 空のフォルダを選んだときだけ、「この設定で始める」で今の設定をそのフォルダへ保存できる。
 */
export function SetupScreen({
  folderSupported,
  submitting,
  error,
  onChooseFolder,
  onLoadFolder,
  onSubmit,
  onBack,
}: SetupScreenProps) {
  const { t } = useTranslation('onboarding')
  const [name, setName] = useState('')
  const [touched, setTouched] = useState(false)
  const [storage, setStorage] = useState<SetupStorageChoice>('indexeddb')
  const [template, setTemplate] = useState<AccountTemplateKey>('standard')
  /** 保存先に選んだ空のフォルダ */
  const [folder, setFolder] = useState<FolderChoice | null>(null)
  /** 選んだが、すでにデータがあったフォルダ(読み込むか、選び直すかを選ばせる) */
  const [existing, setExisting] = useState<FolderChoice | null>(null)
  const [folderError, setFolderError] = useState<string | null>(null)
  const [folderBusy, setFolderBusy] = useState(false)

  /** フォルダを選ぶ。取りやめたときは、何も選んでいなければブラウザ内に戻す */
  async function chooseFolder() {
    setFolderError(null)
    setFolderBusy(true)
    try {
      const choice = await onChooseFolder()
      if (choice === null) {
        if (folder === null && existing === null) setStorage('indexeddb')
        return
      }
      setStorage('folder')
      if (choice.hasExistingData) {
        setExisting(choice)
        setFolder(null)
      } else {
        setFolder(choice)
        setExisting(null)
      }
    } catch {
      setFolderError(t('setup.storage.folder.pickFailed'))
      if (folder === null && existing === null) setStorage('indexeddb')
    } finally {
      setFolderBusy(false)
    }
  }

  function chooseBrowserStorage() {
    setStorage('indexeddb')
    setFolder(null)
    setExisting(null)
    setFolderError(null)
  }

  async function loadExisting(target: FolderChoice) {
    setFolderError(null)
    setFolderBusy(true)
    try {
      await onLoadFolder(target.handle)
    } catch {
      setFolderError(t('setup.storage.existing.loadFailed'))
      setFolderBusy(false)
    }
  }

  const folderMissing = storage === 'folder' && folder === null
  const trimmed = name.trim()
  const nameMissing = trimmed === ''
  const additions = findTemplateAdditions(template)
  const selected = ACCOUNT_TEMPLATES[template]

  return (
    <div className="onboarding">
      <section className="onboarding__card onboarding__card--wide">
        <div>
          <h2>{t('setup.name.heading')}</h2>
          <p className="onboarding__sub">{t('setup.name.description')}</p>
          <div className="onboarding__name-field">
            <input
              type="text"
              className="onboarding__input"
              aria-label={t('setup.name.heading')}
              aria-invalid={touched && nameMissing}
              aria-describedby="onboarding-name-hint"
              maxLength={20}
              autoComplete="off"
              placeholder={t('setup.name.placeholder')}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => setTouched(true)}
            />
            {touched && nameMissing && (
              <p id="onboarding-name-hint" className="onboarding__error">
                {t('setup.name.required')}
              </p>
            )}
            <p className="onboarding__muted">{t('setup.name.note')}</p>
          </div>
        </div>

        <div>
          <h2>{t('setup.storage.heading')}</h2>
          <p className="onboarding__sub">{t('setup.storage.description')}</p>
          <div className="onboarding__choices onboarding__choices--2" role="radiogroup" aria-label={t('setup.storage.groupLabel')}>
            <Choice
              checked={storage === 'indexeddb'}
              title={t('setup.storage.browser.title')}
              description={t('setup.storage.browser.description')}
              tag={t('setup.storage.browser.tag')}
              tagClass="blue"
              onSelect={chooseBrowserStorage}
            />
            <Choice
              checked={storage === 'folder'}
              disabled={!folderSupported || folderBusy}
              title={t('setup.storage.folder.title')}
              description={folderSupported ? t('setup.storage.folder.description') : t('setup.storage.folder.unsupported')}
              tag={t('setup.storage.folder.tag')}
              tagClass="purple"
              onSelect={() => {
                if (storage !== 'folder') void chooseFolder()
              }}
            />
          </div>

          {folder && (
            <div className="onboarding__folder">
              <p>{t('setup.storage.folder.picked', { name: folder.name })}</p>
              <button type="button" className="onboarding__button" disabled={folderBusy} onClick={() => void chooseFolder()}>
                {t('setup.storage.folder.rechoose')}
              </button>
            </div>
          )}

          {existing && (
            <div className="onboarding__folder onboarding__folder--existing">
              <p>{t('setup.storage.existing.message')}</p>
              <p className="onboarding__muted">{t('setup.storage.folder.picked', { name: existing.name })}</p>
              <div className="onboarding__actions">
                <button
                  type="button"
                  className="onboarding__button onboarding__button--primary"
                  disabled={folderBusy}
                  onClick={() => void loadExisting(existing)}
                >
                  {t('setup.storage.existing.load')}
                </button>
                <button type="button" className="onboarding__button" disabled={folderBusy} onClick={() => void chooseFolder()}>
                  {t('setup.storage.existing.other')}
                </button>
              </div>
            </div>
          )}

          {folderError && (
            <div role="alert" className="onboarding__error-box">
              {folderError}
            </div>
          )}
        </div>

        <div>
          <h2>{t('setup.template.heading')}</h2>
          <p className="onboarding__sub">{t('setup.template.description')}</p>
          <div className="onboarding__choices onboarding__choices--3" role="radiogroup" aria-label={t('setup.template.groupLabel')}>
            {ACCOUNT_TEMPLATE_KEYS.map((key) => (
              <Choice
                key={key}
                checked={template === key}
                title={t(`setup.template.${key}.title`)}
                description={t(`setup.template.${key}.description`)}
                tag={t('setup.template.count', {
                  revenue: ACCOUNT_TEMPLATES[key].revenue.length,
                  expense: ACCOUNT_TEMPLATES[key].expense.length,
                })}
                tagClass="neutral"
                onSelect={() => setTemplate(key)}
              />
            ))}
          </div>

          <div className="onboarding__preview" data-testid="template-preview" aria-live="polite">
            <div className="onboarding__preview-grid">
              <PreviewGroup title={t('setup.preview.asset')} tag={t('setup.preview.assetTag')} tagClass="purple">
                <Chip>{CASH_ACCOUNT_NAME}</Chip>
                {SYSTEM_ASSET.map((n) => (
                  <Chip key={n} kind="sys">{n}</Chip>
                ))}
                {EXAMPLE_ASSET.map((n) => (
                  <Chip key={n} kind="eg">{n}</Chip>
                ))}
              </PreviewGroup>
              <PreviewGroup title={t('setup.preview.liability')} tag={t('setup.preview.liabilityTag')} tagClass="purple">
                {SYSTEM_LIABILITY.map((n) => (
                  <Chip key={n} kind="sys">{n}</Chip>
                ))}
                {EXAMPLE_LIABILITY.map((n) => (
                  <Chip key={n} kind="eg">{n}</Chip>
                ))}
              </PreviewGroup>
              <PreviewGroup title={t('setup.preview.equity')} tag={t('setup.preview.equityTag')} tagClass="neutral">
                {SYSTEM_EQUITY.map((n) => (
                  <Chip key={n} kind="sys">{n}</Chip>
                ))}
              </PreviewGroup>
              <div />
              <PreviewGroup title={t('setup.preview.revenue')} tag={t('setup.preview.templateTag')} tagClass="blue">
                {selected.revenue.map((n) => (
                  <Chip key={n} kind={additions.includes(n) ? 'add' : undefined}>{n}</Chip>
                ))}
                {SYSTEM_REVENUE.map((n) => (
                  <Chip key={n} kind="sys">{n}</Chip>
                ))}
              </PreviewGroup>
              <PreviewGroup title={t('setup.preview.expense')} tag={t('setup.preview.templateTag')} tagClass="blue">
                {selected.expense.map((n) => (
                  <Chip key={n} kind={additions.includes(n) ? 'add' : undefined}>{n}</Chip>
                ))}
                {SYSTEM_EXPENSE.map((n) => (
                  <Chip key={n} kind="sys">{n}</Chip>
                ))}
              </PreviewGroup>
            </div>
            <div className="onboarding__legend" aria-label={t('setup.preview.legend')}>
              <span><Chip>{t('setup.preview.chipStandard')}</Chip> {t('setup.preview.legendStandard')}</span>
              <span><Chip kind="add">{t('setup.preview.chipAdded')}</Chip> {t('setup.preview.legendAdded')}</span>
              <span><Chip kind="sys">{t('setup.preview.chipFixed')}</Chip> {t('setup.preview.legendSystem')}</span>
              <span><Chip kind="eg">{t('setup.preview.chipExample')}</Chip> {t('setup.preview.legendExample')}</span>
            </div>
            <p className="onboarding__sys">{t('setup.preview.note')}</p>
          </div>
        </div>

        {error && (
          <div role="alert" className="onboarding__error-box">
            {error}
          </div>
        )}
        <div className="onboarding__actions">
          <button
            type="button"
            className="onboarding__button onboarding__button--primary"
            disabled={nameMissing || submitting || folderMissing}
            onClick={() => onSubmit({ memberName: trimmed, template, folder: folder?.handle ?? null })}
          >
            {t('setup.submit')}
          </button>
          <button type="button" className="onboarding__button" disabled={submitting} onClick={onBack}>
            {t('setup.back')}
          </button>
          {submitting ? (
            <span className="onboarding__muted">{t('setup.saving')}</span>
          ) : (
            (nameMissing || folderMissing) && (
              <span className="onboarding__muted">{nameMissing ? t('setup.needName') : t('setup.needFolder')}</span>
            )
          )}
        </div>
      </section>
    </div>
  )
}

interface ChoiceProps {
  checked: boolean
  disabled?: boolean
  title: string
  description: string
  tag: string
  tagClass: 'blue' | 'purple' | 'neutral'
  onSelect: () => void
}

/** ラジオの選択肢(カード型のボタン) */
function Choice({ checked, disabled, title, description, tag, tagClass, onSelect }: ChoiceProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      className="onboarding__choice"
      onClick={onSelect}
    >
      <b>{title}</b>
      <span>{description}</span>
      <span className={`onboarding__tag onboarding__tag--${tagClass}`}>{tag}</span>
    </button>
  )
}

function PreviewGroup({
  title,
  tag,
  tagClass,
  children,
}: {
  title: string
  tag: string
  tagClass: 'blue' | 'purple' | 'neutral'
  children: React.ReactNode
}) {
  return (
    <div>
      <h3>
        {title} <span className={`onboarding__tag onboarding__tag--${tagClass}`}>{tag}</span>
      </h3>
      <div className="onboarding__chips">{children}</div>
    </div>
  )
}

function Chip({ kind, children }: { kind?: 'add' | 'sys' | 'eg'; children: React.ReactNode }) {
  return <span className={`onboarding__chip${kind ? ` onboarding__chip--${kind}` : ''}`}>{children}</span>
}
