import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BATCH_NAME, WALKTHROUGH_STAGES } from './batchWalkthroughData'
import './GlossaryScreen.css'

interface PlaceRow {
  place: string
  timing: string
  how: string
}

interface StageText {
  tab: string
  title: string
  where: string
  message: string
}

/**
 * 用語集の「精算バッチを例で詳しく見る」の中身(計画Issue #177、承認済みモックアップ④)。
 * 何のためにあるか → どう付けるか → 作成から完了までの流れ(旅行代を友人と折半する例を、ボタンで順に進める)
 * → 簿記の言葉では、の順。流れの段階を切り替えると、その操作でできる仕訳の表と、バッチの残高の表が変わる。
 */
export function SettlementBatchWalkthrough() {
  const { t } = useTranslation('help')
  const [stageIndex, setStageIndex] = useState(0)
  const stages = t('batch.flow.stages', { returnObjects: true }) as StageText[]
  const places = t('batch.how.rows', { returnObjects: true }) as PlaceRow[]
  const mistakes = t('batch.mistakes.items', { returnObjects: true }) as string[]
  const stage = WALKTHROUGH_STAGES[stageIndex]
  const text = stages[stageIndex]

  const batchTag = <span className="glossary__tag glossary__tag--blue">{BATCH_NAME}</span>

  return (
    <div className="glossary__detail-body">
      <h3 className="glossary__section-title">{t('batch.why.heading')}</h3>
      <p>{t('batch.why.intro')}</p>
      <div className="glossary__compare">
        <div className="glossary__def">
          <h4>
            <span className="glossary__tag glossary__tag--neutral">{t('batch.why.withoutTag')}</span>
          </h4>
          <p>{t('batch.why.withoutBody')}</p>
        </div>
        <div className="glossary__def">
          <h4>
            <span className="glossary__tag glossary__tag--blue">{t('batch.why.withTag')}</span>
          </h4>
          <p>{t('batch.why.withBody')}</p>
        </div>
      </div>
      <p className="glossary__muted">{t('batch.why.note')}</p>

      <h3 className="glossary__section-title">{t('batch.how.heading')}</h3>
      <div className="glossary__callout glossary__callout--ok">
        <b>{t('batch.how.conditionLead')}</b> {t('batch.how.conditionBody')}
      </div>
      <div className="glossary__box">
        <h4>{t('batch.how.tableTitle')}</h4>
        <div className="glossary__table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('batch.how.colPlace')}</th>
                <th>{t('batch.how.colTiming')}</th>
                <th>{t('batch.how.colHow')}</th>
              </tr>
            </thead>
            <tbody>
              {places.map((row) => (
                <tr key={row.place}>
                  <td className="glossary__nowrap">{row.place}</td>
                  <td>{row.timing}</td>
                  <td>{row.how}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="glossary__muted">{t('batch.how.note')}</p>

      <h3 className="glossary__section-title">{t('batch.flow.heading')}</h3>
      <p className="glossary__muted">{t('batch.flow.intro')}</p>
      <div className="glossary__stepper" role="group" aria-label={t('batch.flow.stagesLabel')}>
        {stages.map((item, index) => (
          <button
            key={item.tab}
            type="button"
            className="glossary__tab"
            aria-pressed={index === stageIndex}
            onClick={() => setStageIndex(index)}
          >
            {item.tab}
          </button>
        ))}
      </div>
      <div className="glossary__stage-meta">
        <span className="glossary__tag glossary__tag--neutral">{t('batch.flow.where', { where: text.where })}</span>
        <span className={`glossary__tag ${stage.settled ? 'glossary__tag--blue' : 'glossary__tag--orange'}`}>
          {stage.settled ? t('batch.flow.settled') : t('batch.flow.unsettled')}
        </span>
        <span className="glossary__strong">{text.title}</span>
      </div>
      <div className={`glossary__callout${stage.settled ? ' glossary__callout--ok' : ''}`} aria-live="polite">
        {text.message}
      </div>
      <div className="glossary__two-col">
        <div className="glossary__box">
          <h4>{t('batch.flow.journalTitle')}</h4>
          <div className="glossary__table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('batch.flow.colAccount')}</th>
                  <th>{t('batch.flow.colMember')}</th>
                  <th>{t('batch.flow.colBatch')}</th>
                  <th className="glossary__num">{t('batch.flow.colDebit')}</th>
                  <th className="glossary__num">{t('batch.flow.colCredit')}</th>
                </tr>
              </thead>
              <tbody>
                {stage.journal.map((row, index) => (
                  <tr key={`${stageIndex}-${index}`} className="glossary__row-new">
                    <td>{row.account}</td>
                    <td>{row.member}</td>
                    <td>
                      {row.batch === 'batch' && batchTag}
                      {row.batch === 'unassigned' && (
                        <span className="glossary__tag glossary__tag--orange">{t('batch.flow.unassigned')}</span>
                      )}
                    </td>
                    <td className="glossary__num">{row.debit}</td>
                    <td className="glossary__num">{row.credit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="glossary__box" data-testid="batch-balance">
          <h4>{t('batch.flow.balanceTitle')}</h4>
          <div className="glossary__table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('batch.flow.colAccount')}</th>
                  <th>{t('batch.flow.colMember')}</th>
                  <th className="glossary__num">{t('batch.flow.colBalance')}</th>
                </tr>
              </thead>
              <tbody>
                {stage.balance.map((row) => (
                  <tr key={row.account}>
                    <td>{row.account}</td>
                    <td>{row.member}</td>
                    <td className={`glossary__num${row.zero ? ' glossary__zero' : ''}`}>{row.balance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="glossary__exc">
        <div className="glossary__strong">{t('batch.mistakes.heading')}</div>
        <ul>
          {mistakes.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <h3 className="glossary__section-title">{t('batch.bookkeeping.heading')}</h3>
      <p>{t('batch.bookkeeping.intro')}</p>
      <ul>
        <li>
          <b>{t('batch.bookkeeping.receivable')}</b>
          {t('batch.bookkeeping.receivableNote')}
        </li>
        <li>
          <b>{t('batch.bookkeeping.payable')}</b>
          {t('batch.bookkeeping.payableNote')}
        </li>
      </ul>
      <p>{t('batch.bookkeeping.outro')}</p>

      <div className="glossary__compare">
        <div className="glossary__def">
          <h4>
            {t('batch.projectDiff.title')} <span className="glossary__tag glossary__tag--orange">{t('batch.projectDiff.tag')}</span>
          </h4>
          <p>{t('batch.projectDiff.body')}</p>
        </div>
        <div className="glossary__def">
          <h4>{t('batch.noTag.title')}</h4>
          <p>{t('batch.noTag.body')}</p>
        </div>
      </div>
    </div>
  )
}
