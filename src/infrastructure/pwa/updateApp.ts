const WAIT_FOR_INSTALL_MS = 10_000

export interface UpdateAppDeps {
  /** 本番はnavigator.serviceWorker。Service Workerが使えない環境ではundefined */
  container: ServiceWorkerContainer | undefined
  /** 本番はwindow.location.reload */
  reload: () => void
}

/**
 * アプリを最新にして再読み込みする(計画Issue #42。ダウングレード検知の「アプリを更新する」)。
 * Service Workerの更新を確認し、新しいものが入れば有効化(SKIP_WAITING)して、切り替わり(controllerchange)で
 * 再読み込みする。新しいものが無い・確認できない・使えない場合は、そのまま再読み込みする。
 * 自動更新ではなく、利用者が押したときだけ呼ぶ(docs/architecture.md 7章。DB書き込み中の強制リロードを避ける方針)。
 */
export async function updateApp({ container, reload }: UpdateAppDeps): Promise<void> {
  try {
    const registration = await container?.getRegistration()
    if (container === undefined || registration === undefined) {
      reload()
      return
    }
    await registration.update()
    const waiting = registration.waiting ?? (await waitForInstalled(registration))
    if (waiting === null) {
      reload()
      return
    }
    container.addEventListener('controllerchange', reload, { once: true })
    waiting.postMessage({ type: 'SKIP_WAITING' })
  } catch {
    reload()
  }
}

/** 取得中の新しいService Workerがあれば、待機状態になるまで待つ(上限あり)。無ければnull */
function waitForInstalled(registration: ServiceWorkerRegistration): Promise<ServiceWorker | null> {
  const installing = registration.installing
  if (installing === null) return Promise.resolve(null)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), WAIT_FOR_INSTALL_MS)
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed') {
        clearTimeout(timer)
        resolve(registration.waiting)
      } else if (installing.state === 'redundant') {
        clearTimeout(timer)
        resolve(null)
      }
    })
  })
}
