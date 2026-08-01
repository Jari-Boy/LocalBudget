/**
 * db.worker.tsがDB初期化・Comlink.expose完了後にpostMessageする合図。Comlink自身の
 * メッセージ(idを持つ)とは別チャネルとして扱われ、Comlink側のリスナーはidを持たない
 * このメッセージを無視する(node_modules/comlink実装のid有無チェックによる)。
 */
export const WORKER_READY_MESSAGE = { type: 'worker-ready' } as const
